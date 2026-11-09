import https from 'node:https'

import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

import { recordAiUsage } from '@/lib/ai-usage'
import { isProviderTimeoutError, providerConnectionError, providerTimeoutError, providerTimeoutMsFromEnv } from '@/lib/ai-providers'

const BYESU_CHAT_URL = 'https://byesu.com/v1/chat/completions'
const BYESU_MODELS_URL = 'https://byesu.com/v1/models'
/**
 * Тяжёлая карточка (десятки тысяч токенов промпта и справочников) у
 * `…-flash-high` считает рассуждения минутами: замер на реальной выгрузке дал
 * 127–152 с на один товар. Прежние 120 с обрывали такой запрос, а ошибка
 * выглядела как «не удалось подключиться».
 */
const BYESU_DEFAULT_TIMEOUT_MS = 300_000
const BYESU_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export function byesuTimeoutMs() {
  return providerTimeoutMsFromEnv('BYESU_TIMEOUT_MS', BYESU_DEFAULT_TIMEOUT_MS)
}

/**
 * Разбирает отказ `fetch` к BYESU по структуре, а не по тексту.
 * `AbortSignal.timeout` бросает DOMException с `name = TimeoutError` и
 * legacy-кодом 23, поэтому прежнее «(23)» означало тайм-аут запроса, а не
 * отказ соединения; реальные сетевые коды лежат в `error.cause.code`.
 */
export function byesuRequestError(error: any, timeoutMs = byesuTimeoutMs()) {
  const causeCode = error?.cause?.code
  if (isProviderTimeoutError(error) || causeCode === 'UND_ERR_HEADERS_TIMEOUT' || causeCode === 'UND_ERR_BODY_TIMEOUT') {
    return providerTimeoutError('BYESU', timeoutMs, error)
  }
  return providerConnectionError('BYESU', error)
}

type ByesuPayload = Record<string, any>

/**
 * Прокси для BYESU. С сервера админки крупные тела запросов (contact sheets с
 * картинками) до byesu.com по HTTP/1.1 не доходят: соединение рвётся через
 * 10–30 с, тогда как `curl --http2` и тот же запрос через прокси проходят с
 * первого раза (проверено на 300 КБ и 1 МБ). Прокси необязателен: без
 * `BYESU_PROXY_URL` запросы идут напрямую, как раньше.
 */
function createByesuAgent() {
  const rawProxyUrl = process.env.BYESU_PROXY_URL?.trim()
  if (!rawProxyUrl) return undefined
  let proxyUrl: URL
  try {
    proxyUrl = new URL(rawProxyUrl)
  } catch {
    throw new Error('BYESU_PROXY_URL имеет неверный формат')
  }
  if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
    return new HttpsProxyAgent(proxyUrl)
  }
  if (['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(proxyUrl.protocol)) {
    return new SocksProxyAgent(proxyUrl)
  }
  throw new Error('BYESU_PROXY_URL поддерживает только HTTP(S) и SOCKS-прокси')
}

function postByesuJson(
  target: string,
  apiKey: string,
  body: string,
  agent: ReturnType<typeof createByesuAgent>,
): Promise<{ status: number; contentLength: number; text: string }> {
  return new Promise((resolve, reject) => {
    const timeoutMs = byesuTimeoutMs()
    const request = https.request(new URL(target), {
      method: 'POST',
      agent,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      let receivedBytes = 0
      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > BYESU_MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Ответ BYESU превышает допустимый размер'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        resolve({
          status: response.statusCode || 0,
          contentLength: Number(response.headers['content-length'] || 0),
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy(providerTimeoutError('BYESU', timeoutMs))
    })
    request.on('error', (error: Error) => {
      reject(isProviderTimeoutError(error) ? error : byesuRequestError(error))
    })
    request.end(body)
  })
}

export type ByesuModelGroup = 'gemini' | 'openai' | 'claude' | 'grok'

export type ByesuModelOption = {
  value: string
  label: string
  group: ByesuModelGroup
}

/**
 * Группа модели у BYESU. Ключи выдаются отдельно на семейство моделей, поэтому
 * имя модели определяет, какой ключ нужен: `gemini…` — Gemini Business,
 * `claude…` — Claude, `grok…` — Grok (xAI), остальное — OpenAI Codex.
 */
export function byesuModelGroup(model: unknown): ByesuModelGroup {
  const value = String(model || '').trim().toLowerCase()
  if (value.startsWith('gemini')) return 'gemini'
  if (value.startsWith('claude')) return 'claude'
  if (value.startsWith('grok')) return 'grok'
  return 'openai'
}

const BYESU_GROUP_ENV: Record<ByesuModelGroup, string> = {
  gemini: 'BYESU_GEMINI_API_KEY',
  openai: 'BYESU_OPENAI_API_KEY',
  claude: 'BYESU_CLAUDE_API_KEY',
  grok: 'BYESU_GROK_API_KEY',
}

const BYESU_GROUP_LABEL: Record<ByesuModelGroup, string> = {
  gemini: 'Gemini Business',
  openai: 'OpenAI Codex',
  claude: 'Claude',
  grok: 'Grok',
}

/** Имя переменной окружения с ключом группы — для подсказок в интерфейсе и ошибках. */
export function byesuApiKeyEnvName(group: ByesuModelGroup) {
  return BYESU_GROUP_ENV[group]
}

export function byesuGroupLabel(group: ByesuModelGroup) {
  return BYESU_GROUP_LABEL[group]
}

function legacyByesuGroup(): ByesuModelGroup {
  const configured = process.env.BYESU_API_GROUP?.trim().toLowerCase()
  return configured === 'gemini' || configured === 'claude' || configured === 'grok' ? configured : 'openai'
}

export function byesuApiKeyStatus() {
  const legacyGroup = legacyByesuGroup()
  const legacyKey = process.env.BYESU_API_KEY?.trim()
  return {
    gemini: Boolean(process.env.BYESU_GEMINI_API_KEY?.trim() || (legacyGroup === 'gemini' && legacyKey)),
    openai: Boolean(process.env.BYESU_OPENAI_API_KEY?.trim() || (legacyGroup === 'openai' && legacyKey)),
    claude: Boolean(process.env.BYESU_CLAUDE_API_KEY?.trim() || (legacyGroup === 'claude' && legacyKey)),
    grok: Boolean(process.env.BYESU_GROK_API_KEY?.trim() || (legacyGroup === 'grok' && legacyKey)),
    legacy: Boolean(legacyKey),
  }
}

function byesuApiKey(model: unknown) {
  const group = byesuModelGroup(model)
  return { apiKey: byesuGroupApiKey(group), group }
}

function byesuGroupApiKey(group: ByesuModelGroup) {
  const direct = process.env[BYESU_GROUP_ENV[group]]?.trim()
  if (direct) return direct

  const legacyKey = process.env.BYESU_API_KEY?.trim()
  return legacyByesuGroup() === group ? legacyKey : undefined
}

function modelLabel(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

async function fetchByesuModels(group: ByesuModelGroup, apiKey: string): Promise<ByesuModelOption[]> {
  const response = await fetch(BYESU_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!response.ok) return []

  const payload = await response.json().catch(() => null)
  const models = Array.isArray(payload?.data) ? payload.data : []
  return models
    .map((model: any) => String(model?.id || '').trim())
    .filter(Boolean)
    .map((value: string) => ({ value, label: modelLabel(value), group }))
}

export async function getByesuModels(): Promise<ByesuModelOption[]> {
  const groups: ByesuModelGroup[] = ['gemini', 'openai', 'claude', 'grok']
  const results = await Promise.all(groups.map(async (group) => {
    const apiKey = byesuGroupApiKey(group)
    if (!apiKey) return []
    try {
      return await fetchByesuModels(group, apiKey)
    } catch {
      return []
    }
  }))

  const unique = new Map<string, ByesuModelOption>()
  results.flat().forEach((model) => unique.set(`${model.group}:${model.value}`, model))
  return Array.from(unique.values()).sort((left, right) => left.group.localeCompare(right.group) || left.value.localeCompare(right.value))
}

export async function byesuChatCompletion(
  requestBody: Record<string, any>,
  connection: { baseUrl?: string; apiKey?: string } = {},
): Promise<ByesuPayload> {
  const legacy = byesuApiKey(requestBody.model)
  const apiKey = connection.apiKey?.trim() || legacy.apiKey
  const group = legacy.group
  if (!apiKey) {
    throw new Error(`${BYESU_GROUP_ENV[group]} не задан для группы ${BYESU_GROUP_LABEL[group]}`)
  }

  const target = connection.baseUrl?.trim()
    ? `${connection.baseUrl.replace(/\/+$/, '')}/chat/completions`
    : BYESU_CHAT_URL
  const startedAt = Date.now()
  try {
    const payload = await sendByesuRequest(target, apiKey, requestBody)
    recordAiUsage({ target, protocol: 'openai', model: requestBody.model, payload, startedAt })
    return payload
  } catch (error) {
    recordAiUsage({ target, protocol: 'openai', model: requestBody.model, error, startedAt })
    throw error
  }
}

async function sendByesuRequest(target: string, apiKey: string, requestBody: Record<string, any>): Promise<ByesuPayload> {
  const agent = createByesuAgent()
  const response = await postByesuJson(target, apiKey, JSON.stringify(requestBody), agent)

  if (response.contentLength > BYESU_MAX_RESPONSE_BYTES) {
    throw new Error('Ответ BYESU превышает допустимый размер')
  }
  const raw = response.text
  if (Buffer.byteLength(raw) > BYESU_MAX_RESPONSE_BYTES) {
    throw new Error('Ответ BYESU превышает допустимый размер')
  }

  let payload: ByesuPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`BYESU вернул некорректный JSON (${response.status})`)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(String(payload?.error?.message || `BYESU error ${response.status}`))
  }
  return payload
}

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
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(byesuTimeoutMs()),
  }).catch((error: any) => {
    throw byesuRequestError(error)
  })

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > BYESU_MAX_RESPONSE_BYTES) {
    throw new Error('Ответ BYESU превышает допустимый размер')
  }
  const raw = await response.text()
  if (Buffer.byteLength(raw) > BYESU_MAX_RESPONSE_BYTES) {
    throw new Error('Ответ BYESU превышает допустимый размер')
  }

  let payload: ByesuPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`BYESU вернул некорректный JSON (${response.status})`)
  }
  if (!response.ok) {
    throw new Error(String(payload?.error?.message || `BYESU error ${response.status}`))
  }
  return payload
}

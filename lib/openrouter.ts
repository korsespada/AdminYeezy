import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { isProviderTimeoutError, providerConnectionError, providerTimeoutError, providerTimeoutMsFromEnv } from '@/lib/ai-providers'
import { recordAiUsage } from '@/lib/ai-usage'

const OPENROUTER_CHAT_URL = new URL('https://openrouter.ai/api/v1/chat/completions')
/**
 * Тяжёлая карточка может считаться минутами (замер на реальной выгрузке:
 * 127–152 с), поэтому 120 с обрывали такие запросы и выдавали это за отказ
 * соединения.
 */
const OPENROUTER_DEFAULT_TIMEOUT_MS = 300_000
const OPENROUTER_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export function openRouterTimeoutMs() {
  return providerTimeoutMsFromEnv('OPENROUTER_TIMEOUT_MS', OPENROUTER_DEFAULT_TIMEOUT_MS)
}

type OpenRouterPayload = Record<string, any>

/**
 * Прокси для OpenAI-совместимых шлюзов. Провайдер «BYESU GEMINI» заведён как
 * `kind=openrouter` с адресом `https://byesu.com/v1`, поэтому его запросы идут
 * этим клиентом, а не `byesuChatCompletion`: без прокси крупные тела с
 * картинками рвутся (`ECONNRESET`) и товар висит до таймаута. Для byesu.com
 * берём `BYESU_PROXY_URL`, для остальных — `OPENROUTER_PROXY_URL`.
 */
function createOpenRouterAgent(hostname = '') {
  const host = hostname.toLowerCase()
  const isByesu = host === 'byesu.com' || host.endsWith('.byesu.com')
  const envName = isByesu ? 'BYESU_PROXY_URL' : 'OPENROUTER_PROXY_URL'
  const rawProxyUrl = (isByesu ? process.env.BYESU_PROXY_URL?.trim() : '') || process.env.OPENROUTER_PROXY_URL?.trim()
  if (!rawProxyUrl) return undefined

  let proxyUrl: URL
  try {
    proxyUrl = new URL(rawProxyUrl)
  } catch {
    throw new Error(`${envName} имеет неверный формат`)
  }

  if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
    return new HttpsProxyAgent(proxyUrl)
  }
  if (['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(proxyUrl.protocol)) {
    return new SocksProxyAgent(proxyUrl)
  }
  throw new Error(`${envName} поддерживает только HTTP(S) и SOCKS-прокси`)
}

/**
 * Клиент OpenAI-совместимый: им же ходят в BYESU и другие шлюзы с собственным
 * адресом. В ошибках называем реальный хост, а не всегда «OpenRouter».
 */
export function openRouterProviderLabel(target: URL) {
  const host = target.hostname.toLowerCase()
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai') ? 'OpenRouter' : host
}

function openRouterError(payload: OpenRouterPayload, statusCode: number, label: string) {
  const message = payload?.error?.message
  return new Error(message ? String(message) : `${label}: ошибка ${statusCode}`)
}

export async function openRouterChatCompletion(
  requestBody: Record<string, any>,
  extraHeaders: Record<string, string> = {},
  connection: { baseUrl?: string; apiKey?: string } = {},
): Promise<OpenRouterPayload> {
  const apiKey = connection.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY не задан')

  const body = JSON.stringify(requestBody)
  const target = connection.baseUrl?.trim()
    ? new URL(`${connection.baseUrl.replace(/\/+$/, '')}/chat/completions`)
    : OPENROUTER_CHAT_URL
  const agent = createOpenRouterAgent(target.hostname)
  const label = openRouterProviderLabel(target)
  const startedAt = Date.now()

  // Каждый ответ и каждая неудача пишутся в учёт расхода ИИ.
  return sendOpenRouterRequest(target, body, apiKey, agent, extraHeaders, label).then(
    (payload) => {
      recordAiUsage({ target, protocol: 'openai', model: requestBody.model, payload, startedAt })
      return payload
    },
    (error) => {
      recordAiUsage({ target, protocol: 'openai', model: requestBody.model, error, startedAt })
      throw error
    },
  )
}

function sendOpenRouterRequest(
  target: URL,
  body: string,
  apiKey: string,
  agent: ReturnType<typeof createOpenRouterAgent>,
  extraHeaders: Record<string, string>,
  label: string,
): Promise<OpenRouterPayload> {
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: 'POST',
      agent,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    }, (response) => {
      const chunks: Buffer[] = []
      let receivedBytes = 0

      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > OPENROUTER_MAX_RESPONSE_BYTES) {
          request.destroy(new Error(`Ответ ${label} превышает допустимый размер`))
          return
        }
        chunks.push(chunk)
      })

      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let payload: OpenRouterPayload = {}
        try {
          payload = raw ? JSON.parse(raw) : {}
        } catch {
          reject(new Error(`${label} вернул некорректный JSON (${response.statusCode || 0})`))
          return
        }

        const statusCode = response.statusCode || 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(openRouterError(payload, statusCode, label))
          return
        }
        resolve(payload)
      })
    })

    request.setTimeout(openRouterTimeoutMs(), () => {
      request.destroy(providerTimeoutError(label, openRouterTimeoutMs()))
    })
    request.on('error', (error: NodeJS.ErrnoException) => {
      // Тайм-аут сохраняем как тайм-аут: раньше он подменялся сообщением об
      // отказе соединения, и batch AI не повторял такой запрос.
      if (isProviderTimeoutError(error)) {
        reject(error)
        return
      }
      reject(providerConnectionError(label, error))
    })
    request.end(body)
  })
}

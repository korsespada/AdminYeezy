import https from 'node:https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

const OPENROUTER_CHAT_URL = new URL('https://openrouter.ai/api/v1/chat/completions')
const OPENROUTER_TIMEOUT_MS = 120_000
const OPENROUTER_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type OpenRouterPayload = Record<string, any>

function createOpenRouterAgent() {
  const rawProxyUrl = process.env.OPENROUTER_PROXY_URL?.trim()
  if (!rawProxyUrl) return undefined

  let proxyUrl: URL
  try {
    proxyUrl = new URL(rawProxyUrl)
  } catch {
    throw new Error('OPENROUTER_PROXY_URL имеет неверный формат')
  }

  if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
    return new HttpsProxyAgent(proxyUrl)
  }
  if (['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(proxyUrl.protocol)) {
    return new SocksProxyAgent(proxyUrl)
  }
  throw new Error('OPENROUTER_PROXY_URL поддерживает только HTTP(S) и SOCKS-прокси')
}

function openRouterError(payload: OpenRouterPayload, statusCode: number) {
  const message = payload?.error?.message
  return new Error(message ? String(message) : `OpenRouter error ${statusCode}`)
}

export async function openRouterChatCompletion(
  requestBody: Record<string, any>,
  extraHeaders: Record<string, string> = {},
): Promise<OpenRouterPayload> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY не задан')

  const body = JSON.stringify(requestBody)
  const agent = createOpenRouterAgent()

  return new Promise((resolve, reject) => {
    const request = https.request(OPENROUTER_CHAT_URL, {
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
          request.destroy(new Error('Ответ OpenRouter превышает допустимый размер'))
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
          reject(new Error(`OpenRouter вернул некорректный JSON (${response.statusCode || 0})`))
          return
        }

        const statusCode = response.statusCode || 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(openRouterError(payload, statusCode))
          return
        }
        resolve(payload)
      })
    })

    request.setTimeout(OPENROUTER_TIMEOUT_MS, () => {
      request.destroy(new Error('OpenRouter не ответил за 120 секунд'))
    })
    request.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code ? ` (${error.code})` : ''
      reject(new Error(`Не удалось подключиться к OpenRouter${code}`))
    })
    request.end(body)
  })
}

import { providerMessagesUrl } from '@/lib/ai-providers'

const ANTHROPIC_TIMEOUT_MS = 120_000
const ANTHROPIC_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type AnthropicPayload = Record<string, any>

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isAgentRouter(baseUrl: string) {
  const hostname = providerHost(baseUrl)
  return hostname === 'agentrouter.org' || hostname.endsWith('.agentrouter.org')
}

function anthropicError(payload: AnthropicPayload, status: number) {
  const message = payload?.error?.message || payload?.message
  return new Error(message ? String(message) : `Anthropic error ${status}`)
}

function headers(baseUrl: string, apiKey: string) {
  const result: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': apiKey,
  }
  if (isAgentRouter(baseUrl)) {
    result['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24,redact-thinking-2026-02-12'
    result['anthropic-dangerous-direct-browser-access'] = 'true'
    result['X-Stainless-Retry-Count'] = '0'
    result['X-Stainless-Timeout'] = '120'
    result['X-Stainless-Lang'] = 'js'
    result['X-Stainless-Package-Version'] = '0.76.0'
    result['X-Stainless-OS'] = 'Linux'
    result['X-Stainless-Arch'] = 'x64'
    result['X-Stainless-Runtime'] = 'node'
    result['X-Stainless-Runtime-Version'] = process.versions.node
    result['accept-encoding'] = 'gzip, deflate, br, zstd'
    result['User-Agent'] = 'claude-cli/2.1.158 (external, sdk-cli)'
    result['x-app'] = 'cli'
  }
  return result
}

export async function anthropicMessagesCompletion(
  requestBody: Record<string, any>,
  connection: { baseUrl?: string; apiKey?: string } = {},
): Promise<AnthropicPayload> {
  const apiKey = connection.apiKey?.trim()
  if (!apiKey) throw new Error('API-ключ Anthropic не задан')
  const baseUrl = connection.baseUrl?.trim() || 'https://api.anthropic.com'
  const response = await fetch(providerMessagesUrl(baseUrl), {
    method: 'POST',
    headers: headers(baseUrl, apiKey),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  }).catch((error: NodeJS.ErrnoException) => {
    const code = error.code ? ` (${error.code})` : ''
    throw new Error(`Не удалось подключиться к Anthropic${code}`)
  })

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > ANTHROPIC_MAX_RESPONSE_BYTES) throw new Error('Ответ Anthropic превышает допустимый размер')
  const raw = await response.text()
  if (Buffer.byteLength(raw) > ANTHROPIC_MAX_RESPONSE_BYTES) throw new Error('Ответ Anthropic превышает допустимый размер')

  let payload: AnthropicPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`Anthropic вернул некорректный JSON (${response.status})`)
  }
  if (!response.ok) throw anthropicError(payload, response.status)
  return payload
}

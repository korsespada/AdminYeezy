import crypto from 'node:crypto'

export type AiProviderKind = 'openrouter' | 'byesu'
export type AiProviderProtocol = 'openai' | 'anthropic'

export type AiProviderRecord = {
  id: string
  name: string
  kind: AiProviderKind
  baseUrl: string
  model: string
  models: Array<{ value: string; label: string }>
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

function encryptionKey() {
  const raw = process.env.AI_PROVIDER_ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new Error('AI_PROVIDER_ENCRYPTION_KEY не задан. Добавьте секрет для шифрования API-ключей.')
  }
  return crypto.createHash('sha256').update(raw).digest()
}

export function encryptProviderApiKey(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptProviderApiKey(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split(':')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('API-ключ провайдера повреждён')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function defaultProviderBaseUrl(kind: AiProviderKind) {
  return kind === 'byesu' ? 'https://byesu.com/v1' : 'https://openrouter.ai/api/v1'
}

export function normalizeProviderBaseUrl(value: unknown, kind?: AiProviderKind) {
  const raw = String(value || '').trim() || (kind ? defaultProviderBaseUrl(kind) : '')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Base URL имеет неверный формат')
  }
  if (parsed.protocol !== 'https:') throw new Error('Base URL должен начинаться с https://')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Base URL не должен содержать логин, пароль, query-параметры или hash')
  let pathname = parsed.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/(?:chat\/completions|models)$/i, '')
  return `${parsed.origin}${pathname}`
}

export function providerProtocol(baseUrl: string): AiProviderProtocol {
  try {
    const parsed = new URL(baseUrl)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname === 'agentrouter.org' || hostname.endsWith('.agentrouter.org')) return 'anthropic'
    if (hostname === 'anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic'
    if (parsed.pathname.split('/').some((part) => part.toLowerCase() === 'messages')) return 'anthropic'
  } catch {
    // Invalid URLs are reported by normalizeProviderBaseUrl before a request starts.
  }
  return 'openai'
}

export function providerModelsUrl(baseUrl: string) {
  const normalized = String(baseUrl).replace(/\/+$/, '')
  return `${normalized.replace(/\/messages$/i, '')}/models`
}

export function providerChatUrl(baseUrl: string) {
  return `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`
}

export function providerMessagesUrl(baseUrl: string) {
  const normalized = String(baseUrl).replace(/\/+$/, '')
  const path = providerProtocol(normalized) === 'anthropic' && /agentrouter\.org$/i.test(new URL(normalized).hostname)
    ? `${normalized}/messages?beta=true`
    : `${normalized}/messages`
  if (/\/messages(?:\?beta=true)?$/i.test(normalized)) return normalized
  if (/\/v1$/i.test(normalized)) return path
  if (/anthropic\.com$/i.test(new URL(normalized).hostname)) return `${normalized}/v1/messages`
  if (/agentrouter\.org$/i.test(new URL(normalized).hostname)) return `${normalized}/v1/messages?beta=true`
  return path
}

export async function fetchProviderModels(baseUrl: string, apiKey: string) {
  const response = await fetch(providerModelsUrl(baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(payload?.error?.message || payload?.error || `Провайдер вернул HTTP ${response.status}`))
  }
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  const unique = new Map<string, { value: string; label: string }>()
  for (const row of rows) {
    const value = String(typeof row === 'string' ? row : row?.id || row?.name || '').trim()
    if (!value) continue
    unique.set(value, { value, label: value })
  }
  return [...unique.values()].sort((left, right) => left.value.localeCompare(right.value))
}

/**
 * Тяжёлая карточка считается минутами: замер на реальной выгрузке дал 127–152 с
 * на товар, поэтому провайдерские тайм-ауты держим около 300 с и разрешаем
 * переопределять переменной окружения.
 */
export function providerTimeoutMsFromEnv(name: string, fallbackMs: number) {
  const configured = Number(process.env[name] || fallbackMs)
  return Number.isFinite(configured) && configured >= 10_000 ? configured : fallbackMs
}

/**
 * Провайдер не ответил вовремя. `AbortSignal.timeout` бросает DOMException с
 * `name = TimeoutError` и legacy-кодом 23, поэтому структурный признак
 * сохраняется: batch AI решает по нему, повторять запрос или нет.
 */
export function providerTimeoutError(label: string, timeoutMs: number, cause?: unknown) {
  const error = new Error(`${label} не ответил за ${Math.round(timeoutMs / 1000)} с (тайм-аут запроса)`)
  error.name = 'TimeoutError'
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause
  return error
}

export function isProviderTimeoutError(error: unknown) {
  const record = error as { name?: unknown; code?: unknown } | null
  return record?.name === 'TimeoutError' || record?.code === 23
}

/** Обрыв соединения: настоящий сетевой код лежит в `cause.code` у fetch. */
export function providerConnectionError(label: string, error: unknown) {
  const record = error as { code?: unknown; cause?: { code?: unknown } } | null
  const causeCode = record?.cause?.code
  const code = typeof causeCode === 'string' ? causeCode : typeof record?.code === 'string' ? record.code : ''
  const wrapped = new Error(code ? `Не удалось подключиться к ${label} (${code})` : `Не удалось подключиться к ${label}`)
  if (code) (wrapped as Error & { code?: string }).code = code
  ;(wrapped as Error & { cause?: unknown }).cause = error
  return wrapped
}

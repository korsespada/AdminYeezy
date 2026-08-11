import crypto from 'node:crypto'

export type AiProviderKind = 'openrouter' | 'byesu'

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

export function providerModelsUrl(baseUrl: string) {
  return `${String(baseUrl).replace(/\/+$/, '')}/models`
}

export function providerChatUrl(baseUrl: string) {
  return `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`
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

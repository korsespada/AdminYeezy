const BYESU_CHAT_URL = 'https://byesu.com/v1/chat/completions'
const BYESU_MODELS_URL = 'https://byesu.com/v1/models'
const BYESU_TIMEOUT_MS = 120_000
const BYESU_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type ByesuPayload = Record<string, any>

export type ByesuModelGroup = 'gemini' | 'openai'

export type ByesuModelOption = {
  value: string
  label: string
  group: ByesuModelGroup
}

export function byesuModelGroup(model: unknown): ByesuModelGroup {
  return String(model || '').trim().toLowerCase().startsWith('gemini') ? 'gemini' : 'openai'
}

export function byesuApiKeyStatus() {
  const legacyGroup = process.env.BYESU_API_GROUP?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai'
  const legacyKey = process.env.BYESU_API_KEY?.trim()
  return {
    gemini: Boolean(process.env.BYESU_GEMINI_API_KEY?.trim() || (legacyGroup === 'gemini' && legacyKey)),
    openai: Boolean(process.env.BYESU_OPENAI_API_KEY?.trim() || (legacyGroup === 'openai' && legacyKey)),
    legacy: Boolean(legacyKey),
  }
}

function byesuApiKey(model: unknown) {
  const group = byesuModelGroup(model)
  const direct = group === 'gemini'
    ? process.env.BYESU_GEMINI_API_KEY?.trim()
    : process.env.BYESU_OPENAI_API_KEY?.trim()
  if (direct) return { apiKey: direct, group }

  const legacyGroup = process.env.BYESU_API_GROUP?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai'
  const legacyKey = process.env.BYESU_API_KEY?.trim()
  return { apiKey: legacyGroup === group ? legacyKey : undefined, group }
}

function byesuGroupApiKey(group: ByesuModelGroup) {
  const direct = group === 'gemini'
    ? process.env.BYESU_GEMINI_API_KEY?.trim()
    : process.env.BYESU_OPENAI_API_KEY?.trim()
  if (direct) return direct

  const legacyGroup = process.env.BYESU_API_GROUP?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai'
  const legacyKey = process.env.BYESU_API_KEY?.trim()
  return legacyGroup === group ? legacyKey : undefined
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
  const groups: ByesuModelGroup[] = ['gemini', 'openai']
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

export async function byesuChatCompletion(requestBody: Record<string, any>): Promise<ByesuPayload> {
  const { apiKey, group } = byesuApiKey(requestBody.model)
  if (!apiKey) {
    throw new Error(group === 'gemini'
      ? 'BYESU_GEMINI_API_KEY не задан для группы Gemini Business'
      : 'BYESU_OPENAI_API_KEY не задан для группы OpenAI Codex')
  }

  const response = await fetch(BYESU_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(BYESU_TIMEOUT_MS),
  }).catch((error: NodeJS.ErrnoException) => {
    const code = error.code ? ` (${error.code})` : ''
    throw new Error(`Не удалось подключиться к BYESU${code}`)
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

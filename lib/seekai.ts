const SEEKAI_CHAT_URL = 'https://seekai.cc/v1/chat/completions'
const SEEKAI_TIMEOUT_MS = 120_000
const SEEKAI_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type SeekAiPayload = Record<string, any>

export function seekaiApiKeyStatus() {
  return Boolean(process.env.SEEKAI_API_KEY?.trim())
}

export async function seekaiChatCompletion(requestBody: Record<string, any>): Promise<SeekAiPayload> {
  const apiKey = process.env.SEEKAI_API_KEY?.trim()
  if (!apiKey) throw new Error('SEEKAI_API_KEY не задан в окружении AdminYeezy')

  const response = await fetch(SEEKAI_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(SEEKAI_TIMEOUT_MS),
  }).catch((error: NodeJS.ErrnoException) => {
    const code = error.code ? ` (${error.code})` : ''
    throw new Error(`Не удалось подключиться к SeekAI${code}`)
  })

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > SEEKAI_MAX_RESPONSE_BYTES) throw new Error('Ответ SeekAI превышает допустимый размер')
  const raw = await response.text()
  if (Buffer.byteLength(raw) > SEEKAI_MAX_RESPONSE_BYTES) throw new Error('Ответ SeekAI превышает допустимый размер')

  let payload: SeekAiPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`SeekAI вернул некорректный JSON (${response.status})`)
  }
  if (!response.ok) throw new Error(String(payload?.error?.message || `SeekAI error ${response.status}`))
  return payload
}

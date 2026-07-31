const BYESU_CHAT_URL = 'https://byesu.com/v1/chat/completions'
const BYESU_TIMEOUT_MS = 120_000
const BYESU_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type ByesuPayload = Record<string, any>

export async function byesuChatCompletion(requestBody: Record<string, any>): Promise<ByesuPayload> {
  const apiKey = process.env.BYESU_API_KEY?.trim()
  if (!apiKey) throw new Error('BYESU_API_KEY не задан')

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

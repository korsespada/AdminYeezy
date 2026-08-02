const STEPFUN_CHAT_URL = 'https://api.stepfun.ai/step_plan/v1/chat/completions'
const STEPFUN_TIMEOUT_MS = 120_000
const STEPFUN_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

type StepFunPayload = Record<string, any>

export function stepfunApiKeyStatus() {
  return Boolean(process.env.STEPFUN_API_KEY?.trim())
}

export async function stepfunChatCompletion(requestBody: Record<string, any>): Promise<StepFunPayload> {
  const apiKey = process.env.STEPFUN_API_KEY?.trim()
  if (!apiKey) throw new Error('STEPFUN_API_KEY не задан в окружении AdminYeezy')

  const response = await fetch(STEPFUN_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(STEPFUN_TIMEOUT_MS),
  }).catch((error: NodeJS.ErrnoException) => {
    const code = error.code ? ` (${error.code})` : ''
    throw new Error(`Не удалось подключиться к StepFun${code}`)
  })

  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > STEPFUN_MAX_RESPONSE_BYTES) throw new Error('Ответ StepFun превышает допустимый размер')
  const raw = await response.text()
  if (Buffer.byteLength(raw) > STEPFUN_MAX_RESPONSE_BYTES) throw new Error('Ответ StepFun превышает допустимый размер')

  let payload: StepFunPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`StepFun вернул некорректный JSON (${response.status})`)
  }
  if (!response.ok) throw new Error(String(payload?.error?.message || `StepFun error ${response.status}`))
  return payload
}

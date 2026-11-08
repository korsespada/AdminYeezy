/**
 * Размышления модели (reasoning/thinking). Модуль без серверных зависимостей:
 * его использует и форма «Настроек ИИ» в браузере.
 */
export type AiReasoningMode = 'default' | 'disabled'

export function normalizeReasoningMode(value: unknown): AiReasoningMode {
  return value === 'disabled' ? 'disabled' : 'default'
}

function providerHostname(baseUrl: unknown) {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Отключать размышления умеют не все совместимые API, а лишний параметр
 * другой шлюз может отклонить. Поэтому выключатель есть только там, где
 * параметр известен: DeepSeek (`thinking`) и OpenRouter (`reasoning`).
 */
export function supportsReasoningToggle(baseUrl: unknown) {
  const host = providerHostname(baseUrl)
  return hostMatches(host, 'api.deepseek.com') || hostMatches(host, 'openrouter.ai')
}

export function reasoningRequestParams(baseUrl: unknown, mode: unknown): Record<string, unknown> {
  if (normalizeReasoningMode(mode) !== 'disabled') return {}
  const host = providerHostname(baseUrl)
  if (hostMatches(host, 'api.deepseek.com')) return { thinking: { type: 'disabled' } }
  if (hostMatches(host, 'openrouter.ai')) return { reasoning: { enabled: false } }
  return {}
}

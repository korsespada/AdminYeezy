/**
 * Размышления модели (reasoning/thinking). Модуль без серверных зависимостей:
 * его использует и форма «Настроек ИИ» в браузере.
 *
 * `default` — параметр не передаётся, работает умолчание провайдера
 * (у DeepSeek это размышления уровня high). `disabled` — без размышлений.
 * `low`/`high`/`max` — явный уровень размышлений.
 */
export type AiReasoningMode = 'default' | 'disabled' | 'low' | 'high' | 'max'

export const AI_REASONING_MODES: Array<{ value: AiReasoningMode; label: string }> = [
  { value: 'default', label: 'По умолчанию провайдера' },
  { value: 'disabled', label: 'Без размышлений' },
  { value: 'low', label: 'Размышления: low' },
  { value: 'high', label: 'Размышления: high' },
  { value: 'max', label: 'Размышления: max' },
]

export function normalizeReasoningMode(value: unknown): AiReasoningMode {
  return value === 'disabled' || value === 'low' || value === 'high' || value === 'max' ? value : 'default'
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
 * Управлять размышлениями умеют не все совместимые API, а лишний параметр
 * другой шлюз может отклонить. Поэтому выбор режима есть только там, где
 * параметры известны: DeepSeek (`thinking`, `reasoning_effort`) и OpenRouter
 * (`reasoning`).
 */
export function supportsReasoningToggle(baseUrl: unknown) {
  const host = providerHostname(baseUrl)
  return hostMatches(host, 'api.deepseek.com') || hostMatches(host, 'openrouter.ai')
}

export function reasoningRequestParams(baseUrl: unknown, mode: unknown): Record<string, unknown> {
  const reasoning = normalizeReasoningMode(mode)
  if (reasoning === 'default') return {}
  const host = providerHostname(baseUrl)
  if (hostMatches(host, 'api.deepseek.com')) {
    if (reasoning === 'disabled') return { thinking: { type: 'disabled' } }
    return { thinking: { type: 'enabled' }, reasoning_effort: reasoning }
  }
  if (hostMatches(host, 'openrouter.ai')) {
    if (reasoning === 'disabled') return { reasoning: { enabled: false } }
    // У OpenRouter нет уровня max: самый высокий общий уровень — high.
    return { reasoning: { effort: reasoning === 'max' ? 'high' : reasoning } }
  }
  return {}
}

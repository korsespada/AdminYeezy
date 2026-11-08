/**
 * Учёт расхода ИИ: разбор `usage` из ответов провайдеров и расчёт стоимости.
 *
 * Модуль без доступа к БД, чтобы его можно было проверять тестами. Цены — в
 * долларах США за 1 млн токенов, как их публикуют провайдеры.
 */

export type AiModelPrice = {
  /** Входные токены без кэша (cache miss). */
  input: number
  /** Входные токены из кэша (cache hit). */
  cachedInput: number
  output: number
  /** Запись в кэш (Anthropic `cache_creation_input_tokens`); по умолчанию как input. */
  cacheWrite?: number
}

export type AiPricingTable = Record<string, AiModelPrice>

export type AiUsageTokens = {
  promptTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  completionTokens: number
  reasoningTokens: number
  /** Стоимость, которую вернул сам провайдер (OpenRouter `usage.cost`). */
  providerCostUsd: number | null
}

export type AiPricePeriod = 'peak' | 'offpeak' | null

const DEEPSEEK_HOSTS = ['api.deepseek.com']

/**
 * Опубликованные цены DeepSeek в часы пик (USD за 1 млн токенов). Вне пика
 * всё вдвое дешевле. Устаревшие имена flash обслуживаются той же моделью.
 */
const DEEPSEEK_PEAK_PRICES: AiPricingTable = {
  'deepseek-flash': { input: 0.30, cachedInput: 0.006, output: 1.20 },
  'deepseek-v4-flash': { input: 0.30, cachedInput: 0.006, output: 1.20 },
  'deepseek-v4-flash-vision-exp': { input: 0.30, cachedInput: 0.006, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
}

function count(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

export function normalizeModelName(model: unknown) {
  return String(model || '').trim().toLowerCase()
}

/** Токены из ответа OpenAI-совместимого API (OpenRouter, BYESU, DeepSeek и др.). */
export function openAiCompatibleUsage(payload: any): AiUsageTokens | null {
  const usage = payload?.usage
  if (!usage || typeof usage !== 'object') return null
  const cachedTokens = count(usage.prompt_cache_hit_tokens) || count(usage.prompt_tokens_details?.cached_tokens)
  const cost = Number(usage.cost)
  return {
    promptTokens: count(usage.prompt_tokens),
    cachedTokens,
    cacheWriteTokens: count(usage.prompt_tokens_details?.cache_write_tokens),
    completionTokens: count(usage.completion_tokens),
    reasoningTokens: count(usage.completion_tokens_details?.reasoning_tokens),
    providerCostUsd: Number.isFinite(cost) && cost >= 0 && usage.cost !== null && usage.cost !== undefined ? cost : null,
  }
}

/** Токены из ответа Anthropic Messages API: input_tokens не включает кэш. */
export function anthropicUsage(payload: any): AiUsageTokens | null {
  const usage = payload?.usage
  if (!usage || typeof usage !== 'object') return null
  const input = count(usage.input_tokens)
  const cachedTokens = count(usage.cache_read_input_tokens)
  const cacheWriteTokens = count(usage.cache_creation_input_tokens)
  return {
    promptTokens: input + cachedTokens + cacheWriteTokens,
    cachedTokens,
    cacheWriteTokens,
    completionTokens: count(usage.output_tokens),
    reasoningTokens: 0,
    providerCostUsd: null,
  }
}

/**
 * Пиковые часы DeepSeek: будни 01:00–04:00 и 06:00–10:00 UTC. Китайские
 * праздники (тоже вне пика) не учитываются: в праздник оценка будет завышена.
 */
export function isDeepSeekPeak(date: Date) {
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

function isDeepSeekHost(host: string) {
  const normalized = host.toLowerCase()
  return DEEPSEEK_HOSTS.some((item) => normalized === item || normalized.endsWith(`.${item}`))
}

/**
 * Цена модели: сначала ручная цена из настроек провайдера, затем встроенный
 * прайс DeepSeek с учётом пика. Без цены стоимость не считается.
 */
export function resolveModelPrice(input: {
  host: string
  model: string
  customPricing?: AiPricingTable | null
  at?: Date
}): { price: AiModelPrice; period: AiPricePeriod; source: 'custom' | 'builtin' } | null {
  const model = normalizeModelName(input.model)
  const custom = input.customPricing?.[model] || input.customPricing?.[input.model]
  if (custom && isValidPrice(custom)) return { price: custom, period: null, source: 'custom' }
  if (isDeepSeekHost(input.host)) {
    const peak = DEEPSEEK_PEAK_PRICES[model]
    if (!peak) return null
    const isPeak = isDeepSeekPeak(input.at || new Date())
    const factor = isPeak ? 1 : 0.5
    return {
      price: {
        input: peak.input * factor,
        cachedInput: peak.cachedInput * factor,
        output: peak.output * factor,
      },
      period: isPeak ? 'peak' : 'offpeak',
      source: 'builtin',
    }
  }
  return null
}

export function isValidPrice(value: unknown): value is AiModelPrice {
  const price = value as AiModelPrice
  return Boolean(price)
    && [price.input, price.cachedInput, price.output].every((item) => Number.isFinite(Number(item)) && Number(item) >= 0)
}

/** Стоимость запроса в USD по токенам и цене за 1 млн. */
export function usageCostUsd(tokens: AiUsageTokens, price: AiModelPrice) {
  const uncached = Math.max(0, tokens.promptTokens - tokens.cachedTokens - tokens.cacheWriteTokens)
  const cost = (
    uncached * Number(price.input)
    + tokens.cachedTokens * Number(price.cachedInput)
    + tokens.cacheWriteTokens * Number(price.cacheWrite ?? price.input)
    + tokens.completionTokens * Number(price.output)
  ) / 1_000_000
  return Math.round(cost * 1e8) / 1e8
}

export function normalizePricingTable(value: unknown): AiPricingTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const table: AiPricingTable = {}
  for (const [model, price] of Object.entries(value as Record<string, unknown>)) {
    if (!model.trim() || !isValidPrice(price)) continue
    const typed = price as AiModelPrice
    table[normalizeModelName(model)] = {
      input: Number(typed.input),
      cachedInput: Number(typed.cachedInput),
      output: Number(typed.output),
      ...(typed.cacheWrite !== undefined && Number.isFinite(Number(typed.cacheWrite)) ? { cacheWrite: Number(typed.cacheWrite) } : {}),
    }
  }
  return table
}

/** Встроенная цена для подсказки в форме провайдера (в пик). */
export function builtinPeakPrice(host: string, model: string): AiModelPrice | null {
  if (!isDeepSeekHost(host)) return null
  return DEEPSEEK_PEAK_PRICES[normalizeModelName(model)] || null
}

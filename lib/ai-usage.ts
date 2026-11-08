import { AsyncLocalStorage } from 'node:async_hooks'
import {
  anthropicUsage,
  normalizeModelName,
  normalizePricingTable,
  openAiCompatibleUsage,
  resolveModelPrice,
  usageCostUsd,
  type AiPricingTable,
} from '@/lib/ai-usage-pricing'

/**
 * Контекст расхода ИИ: к какой выгрузке, запуску и товару относится запрос.
 *
 * Транспорты (OpenAI-совместимый, Anthropic, BYESU) записывают каждый ответ
 * модели в `ai_usage_events`, а этот контекст подставляет, откуда пришёл
 * запрос. Вложенные контексты дополняют внешний.
 */
export type AiUsageContext = {
  feature?: string
  batchId?: string | null
  runId?: string | null
  itemId?: string | null
  productId?: number | null
  supplierId?: number | null
  providerId?: string | null
}

export type AiUsageFeature =
  | 'batch_ai'
  | 'card_updates'
  | 'chromoff'
  | 'david_studio'
  | 'measurement_templates'
  | 'ai_process'
  | 'provider_test'
  | 'other'

const storage = new AsyncLocalStorage<AiUsageContext>()

export function withAiUsageContext<T>(context: AiUsageContext, run: () => T): T {
  const parent = storage.getStore() || {}
  return storage.run({ ...parent, ...stripEmpty(context) }, run)
}

export function currentAiUsageContext(): AiUsageContext {
  return storage.getStore() || {}
}

function stripEmpty(context: AiUsageContext) {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined)) as AiUsageContext
}

type ProviderPricingRow = { id: string; host: string; pricing: AiPricingTable }

let providerPricingCache: { loadedAt: number; rows: ProviderPricingRow[] } | null = null
const PROVIDER_PRICING_TTL_MS = 60_000

export function resetAiProviderPricingCache() {
  providerPricingCache = null
}

async function providerPricingRows(query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>) {
  if (providerPricingCache && Date.now() - providerPricingCache.loadedAt < PROVIDER_PRICING_TTL_MS) {
    return providerPricingCache.rows
  }
  const result = await query('SELECT id, base_url, pricing FROM ai_providers')
  const rows = result.rows.map((row) => ({
    id: String(row.id),
    host: hostOf(row.base_url),
    pricing: normalizePricingTable(row.pricing),
  }))
  providerPricingCache = { loadedAt: Date.now(), rows }
  return rows
}

function hostOf(value: unknown) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function errorText(error: unknown) {
  return String((error as Error)?.message || error || '').slice(0, 500)
}

/**
 * Записывает один запрос к модели. Ошибка записи не должна ломать обработку,
 * поэтому всё глотается с предупреждением в лог. В тестах запись отключена.
 */
export function recordAiUsage(input: {
  target: URL | string
  protocol: 'openai' | 'anthropic'
  model: unknown
  payload?: any
  error?: unknown
  startedAt: number
}) {
  if (process.env.NODE_ENV === 'test') return
  if (!process.env.SCRAPING_DATABASE_URL && !process.env.DATABASE_URL) return
  const context = currentAiUsageContext()
  const finishedAt = new Date()
  void writeAiUsage(input, context, finishedAt).catch((error) => {
    console.warn('AI usage: не удалось записать расход', errorText(error))
  })
}

async function writeAiUsage(
  input: Parameters<typeof recordAiUsage>[0],
  context: AiUsageContext,
  finishedAt: Date,
) {
  const { scrapingQuery } = await import('@/lib/db')
  const host = hostOf(input.target)
  const model = normalizeModelName(input.payload?.model || input.model)
  const tokens = input.error
    ? null
    : input.protocol === 'anthropic' ? anthropicUsage(input.payload) : openAiCompatibleUsage(input.payload)

  const providers = await providerPricingRows(scrapingQuery).catch(() => [] as ProviderPricingRow[])
  const provider = providers.find((row) => context.providerId && row.id === context.providerId)
    || providers.find((row) => row.host && row.host === host)
  const requestedModel = normalizeModelName(input.model)
  const price = resolveModelPrice({ host, model: requestedModel || model, customPricing: provider?.pricing, at: finishedAt })
    || (model !== requestedModel ? resolveModelPrice({ host, model, customPricing: provider?.pricing, at: finishedAt }) : null)

  let costUsd: number | null = null
  let costSource: string | null = null
  if (tokens?.providerCostUsd !== null && tokens?.providerCostUsd !== undefined) {
    costUsd = tokens.providerCostUsd
    costSource = 'provider'
  } else if (tokens && price) {
    costUsd = usageCostUsd(tokens, price.price)
    costSource = price.source
  }

  await scrapingQuery(`
    INSERT INTO ai_usage_events(
      feature,batch_id,run_id,item_id,product_id,supplier_id,provider_id,provider_host,model,
      prompt_tokens,cached_tokens,cache_write_tokens,completion_tokens,reasoning_tokens,
      cost_usd,cost_source,price_period,duration_ms,success,error,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
  `, [
    context.feature || 'other',
    context.batchId || null,
    context.runId || null,
    context.itemId || null,
    Number.isFinite(Number(context.productId)) && context.productId ? Number(context.productId) : null,
    Number.isFinite(Number(context.supplierId)) && context.supplierId ? Number(context.supplierId) : null,
    provider?.id || context.providerId || null,
    host || null,
    (requestedModel || model || '').slice(0, 200) || null,
    tokens?.promptTokens || 0,
    tokens?.cachedTokens || 0,
    tokens?.cacheWriteTokens || 0,
    tokens?.completionTokens || 0,
    tokens?.reasoningTokens || 0,
    costUsd,
    costSource,
    price?.period || null,
    Math.max(0, finishedAt.getTime() - input.startedAt),
    !input.error,
    input.error ? errorText(input.error) : null,
    finishedAt,
  ])
}

'use server'

import { requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'

export type AiUsageTotals = {
  requests: number
  failed: number
  promptTokens: number
  cachedTokens: number
  completionTokens: number
  reasoningTokens: number
  costUsd: number
  /** Успешные запросы без известной цены: их стоимость не попала в сумму. */
  unpriced: number
  products: number
  avgDurationMs: number
}

export type AiUsageBatchRow = AiUsageTotals & {
  batchId: string
  batchName: string
  supplierName: string
  lastAt: string
}

export type AiUsageSupplierRow = AiUsageTotals & { supplierId: number | null; supplierName: string; batches: number }
export type AiUsageModelRow = AiUsageTotals & { host: string; model: string }
export type AiUsageFeatureRow = AiUsageTotals & { feature: string }
export type AiUsageDayRow = { day: string; requests: number; costUsd: number; promptTokens: number; completionTokens: number }

export type AiUsageReport = {
  periodDays: number | null
  totals: AiUsageTotals & { peakCostUsd: number; offpeakCostUsd: number }
  batches: AiUsageBatchRow[]
  suppliers: AiUsageSupplierRow[]
  models: AiUsageModelRow[]
  features: AiUsageFeatureRow[]
  days: AiUsageDayRow[]
}

const TOTALS_SQL = `
  COUNT(*)::int AS requests,
  COUNT(*) FILTER (WHERE NOT e.success)::int AS failed,
  COALESCE(SUM(e.prompt_tokens), 0)::bigint AS prompt_tokens,
  COALESCE(SUM(e.cached_tokens), 0)::bigint AS cached_tokens,
  COALESCE(SUM(e.completion_tokens), 0)::bigint AS completion_tokens,
  COALESCE(SUM(e.reasoning_tokens), 0)::bigint AS reasoning_tokens,
  COALESCE(SUM(e.cost_usd), 0)::float8 AS cost_usd,
  COUNT(*) FILTER (WHERE e.success AND e.cost_usd IS NULL)::int AS unpriced,
  COUNT(DISTINCT (e.batch_id, e.product_id)) FILTER (WHERE e.product_id IS NOT NULL)::int AS products,
  COALESCE(AVG(e.duration_ms) FILTER (WHERE e.success), 0)::float8 AS avg_duration_ms
`

function totals(row: any): AiUsageTotals {
  return {
    requests: Number(row?.requests || 0),
    failed: Number(row?.failed || 0),
    promptTokens: Number(row?.prompt_tokens || 0),
    cachedTokens: Number(row?.cached_tokens || 0),
    completionTokens: Number(row?.completion_tokens || 0),
    reasoningTokens: Number(row?.reasoning_tokens || 0),
    costUsd: Number(row?.cost_usd || 0),
    unpriced: Number(row?.unpriced || 0),
    products: Number(row?.products || 0),
    avgDurationMs: Number(row?.avg_duration_ms || 0),
  }
}

/** Сводка расхода ИИ за период (`days = null` — за всё время). */
export async function getAiUsageAction(days: number | null = 30) {
  await requireAdmin()
  const periodDays = days && Number.isFinite(days) && days > 0 ? Math.min(3650, Math.round(days)) : null
  const where = periodDays ? `e.created_at >= NOW() - ($1::int * INTERVAL '1 day')` : 'TRUE'
  const params = periodDays ? [periodDays] : []
  try {
    const [summary, batches, suppliers, models, features, daily] = await Promise.all([
      scrapingQuery(`
        SELECT ${TOTALS_SQL},
          COALESCE(SUM(e.cost_usd) FILTER (WHERE e.price_period = 'peak'), 0)::float8 AS peak_cost_usd,
          COALESCE(SUM(e.cost_usd) FILTER (WHERE e.price_period = 'offpeak'), 0)::float8 AS offpeak_cost_usd
        FROM ai_usage_events e WHERE ${where}
      `, params),
      scrapingQuery(`
        SELECT e.batch_id, MAX(b.name) AS batch_name, MAX(s.name) AS supplier_name, MAX(e.created_at) AS last_at, ${TOTALS_SQL}
        FROM ai_usage_events e
        LEFT JOIN scraping_batches b ON b.id = e.batch_id
        LEFT JOIN suppliers s ON s.id = COALESCE(e.supplier_id, b.supplier_id)
        WHERE e.batch_id IS NOT NULL AND ${where}
        GROUP BY e.batch_id
        ORDER BY MAX(e.created_at) DESC
        LIMIT 200
      `, params),
      scrapingQuery(`
        SELECT COALESCE(e.supplier_id, b.supplier_id) AS supplier_id, MAX(s.name) AS supplier_name,
          COUNT(DISTINCT e.batch_id)::int AS batches, ${TOTALS_SQL}
        FROM ai_usage_events e
        LEFT JOIN scraping_batches b ON b.id = e.batch_id
        LEFT JOIN suppliers s ON s.id = COALESCE(e.supplier_id, b.supplier_id)
        WHERE e.feature = 'batch_ai' AND ${where}
        GROUP BY COALESCE(e.supplier_id, b.supplier_id)
        ORDER BY SUM(e.cost_usd) DESC NULLS LAST
      `, params),
      scrapingQuery(`
        SELECT COALESCE(e.provider_host, '') AS host, COALESCE(e.model, '') AS model, ${TOTALS_SQL}
        FROM ai_usage_events e WHERE ${where}
        GROUP BY 1, 2
        ORDER BY SUM(e.cost_usd) DESC NULLS LAST, COUNT(*) DESC
      `, params),
      scrapingQuery(`
        SELECT e.feature, ${TOTALS_SQL}
        FROM ai_usage_events e WHERE ${where}
        GROUP BY e.feature
        ORDER BY SUM(e.cost_usd) DESC NULLS LAST, COUNT(*) DESC
      `, params),
      scrapingQuery(`
        SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM-DD') AS day,
          COUNT(*)::int AS requests,
          COALESCE(SUM(e.cost_usd), 0)::float8 AS cost_usd,
          COALESCE(SUM(e.prompt_tokens), 0)::bigint AS prompt_tokens,
          COALESCE(SUM(e.completion_tokens), 0)::bigint AS completion_tokens
        FROM ai_usage_events e WHERE ${where}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 90
      `, params),
    ])
    const summaryRow = summary.rows[0] || {}
    const report: AiUsageReport = {
      periodDays,
      totals: {
        ...totals(summaryRow),
        peakCostUsd: Number(summaryRow.peak_cost_usd || 0),
        offpeakCostUsd: Number(summaryRow.offpeak_cost_usd || 0),
      },
      batches: batches.rows.map((row) => ({
        ...totals(row),
        batchId: String(row.batch_id),
        batchName: String(row.batch_name || row.batch_id),
        supplierName: String(row.supplier_name || '—'),
        lastAt: new Date(row.last_at).toISOString(),
      })),
      suppliers: suppliers.rows.map((row) => ({
        ...totals(row),
        supplierId: row.supplier_id === null ? null : Number(row.supplier_id),
        supplierName: String(row.supplier_name || 'Без поставщика'),
        batches: Number(row.batches || 0),
      })),
      models: models.rows.map((row) => ({ ...totals(row), host: String(row.host || ''), model: String(row.model || '') })),
      features: features.rows.map((row) => ({ ...totals(row), feature: String(row.feature || 'other') })),
      days: daily.rows.map((row) => ({
        day: String(row.day),
        requests: Number(row.requests || 0),
        costUsd: Number(row.cost_usd || 0),
        promptTokens: Number(row.prompt_tokens || 0),
        completionTokens: Number(row.completion_tokens || 0),
      })).reverse(),
    }
    return { success: true as const, data: report }
  } catch (error: any) {
    return { success: false as const, error: error.message || 'Не удалось прочитать расход ИИ' }
  }
}

import { scrapingQuery } from '@/lib/db'
import { loadBatchAiSettingsCore } from '@/lib/batch-ai-settings'
import { runProductCardAi } from '@/lib/product-card-ai'
import { findProductCardPreset } from '@/lib/product-card-presets'
import { resolveCardSupplierPrompt } from '@/lib/product-card-suppliers'
import {
  cardUpdateCounts,
  markCardUpdateAiFailed,
  requeueFailedCardAi,
  saveCardUpdateAi,
  selectPendingCardUpdatesForAi,
} from '@/lib/product-card-updates'

/**
 * Фоновый прогон ИИ по всем карточкам поставщика.
 *
 * Прогон живёт в супервизоре (`instrumentation.ts`), а не в запросе: обработка
 * двух тысяч карточек занимает часы, поэтому вкладку можно закрыть, а после
 * рестарта контейнера прогон поднимется сам. Прогресс идёт через таблицу
 * `product_card_ai_runs`, строки берутся порциями из очереди.
 */

export const CARD_AI_RUN_STALE_SECONDS = 180
const CARD_AI_MAX_MINUTES = 12 * 60

export interface CardAiRun {
  supplier_id: string
  status: string
  batch_size: number
  processed: number
  failed: number
  model: string | null
  started_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
  last_error: string | null
}

export async function getCardAiRun(supplierId: string) {
  const result = await scrapingQuery<CardAiRun>(
    `SELECT supplier_id, status, batch_size, processed, failed, model, started_at, heartbeat_at, finished_at, last_error
     FROM product_card_ai_runs WHERE supplier_id = $1`,
    [supplierId],
  )
  return result.rows[0] || null
}

/** Прогон числится активным, только если цикл недавно подавал признаки жизни. */
export async function isCardAiRunActive(supplierId: string) {
  const result = await scrapingQuery<{ active: boolean }>(
    `SELECT (status = 'running' AND heartbeat_at > NOW() - ($2 || ' seconds')::interval) AS active
     FROM product_card_ai_runs WHERE supplier_id = $1`,
    [supplierId, String(CARD_AI_RUN_STALE_SECONDS)],
  )
  return Boolean(result.rows[0]?.active)
}

export async function listRunningCardAiRuns() {
  const result = await scrapingQuery<{ supplier_id: string }>(
    `SELECT supplier_id FROM product_card_ai_runs WHERE status = 'running'`,
  )
  return result.rows
}

export async function startCardAiRun(supplierId: string, batchSize = 4) {
  await scrapingQuery(
    `INSERT INTO product_card_ai_runs (supplier_id, status, batch_size, processed, failed, started_at, heartbeat_at, finished_at, last_error, updated_at)
     VALUES ($1, 'running', $2, 0, 0, NOW(), NOW(), NULL, NULL, NOW())
     ON CONFLICT (supplier_id) DO UPDATE SET
       status = 'running',
       batch_size = EXCLUDED.batch_size,
       started_at = NOW(),
       heartbeat_at = NOW(),
       finished_at = NULL,
       last_error = NULL,
       updated_at = NOW()`,
    [supplierId, Math.min(Math.max(Number(batchSize) || 4, 1), 20)],
  )
}

export async function stopCardAiRun(supplierId: string) {
  const result = await scrapingQuery(
    `UPDATE product_card_ai_runs
     SET status = 'stopped', finished_at = NOW(), updated_at = NOW()
     WHERE supplier_id = $1 AND status = 'running'`,
    [supplierId],
  )
  return result.rowCount || 0
}

export async function touchCardAiRun(supplierId: string, update: {
  status?: string
  processedDelta?: number
  failedDelta?: number
  model?: string | null
  error?: string | null
}) {
  await scrapingQuery(
    `UPDATE product_card_ai_runs
     SET status = COALESCE($2, status),
         processed = processed + $3,
         failed = failed + $4,
         model = COALESCE($5, model),
         last_error = $6,
         heartbeat_at = NOW(),
         finished_at = CASE WHEN $2 IS NOT NULL AND $2 <> 'running' THEN NOW() ELSE finished_at END,
         updated_at = NOW()
     WHERE supplier_id = $1`,
    [
      supplierId,
      update.status || null,
      Math.max(0, Number(update.processedDelta) || 0),
      Math.max(0, Number(update.failedDelta) || 0),
      update.model || null,
      update.error === undefined ? null : update.error,
    ],
  )
}

/** Сколько осталось обработать: прогресс для интерфейса и для решения о конце. */
export async function cardAiRunProgress(supplierId: string) {
  const counts = await cardUpdateCounts(supplierId)
  const remaining = await scrapingQuery<{ remaining: number }>(
    `SELECT COUNT(*)::int AS remaining FROM product_card_updates
     WHERE supplier_id = $1 AND status = 'pending' AND ai_status <> 'ready'`,
    [supplierId],
  )
  return { counts, remaining: Number(remaining.rows[0]?.remaining || 0) }
}

/**
 * Один цикл прогона: порции строк, пока очередь не опустеет. Упавшие строки
 * возвращаются в работу один раз — разовые сбои провайдера обычно проходят.
 */
export async function runCardAiLoop(supplierId: string, options: { maxIterations?: number } = {}) {
  const preset = findProductCardPreset(supplierId)
  const prompt = await resolveCardSupplierPrompt(preset.key)
  const settings = await loadBatchAiSettingsCore()
  const model = settings.provider === 'byesu' ? settings.byesuModel : settings.openrouterModel
  const deadline = Date.now() + CARD_AI_MAX_MINUTES * 60_000
  let retriedFailures = false
  let iterations = 0

  for (;;) {
    const run = await getCardAiRun(preset.supplierUuid)
    if (!run || run.status !== 'running') return
    if (options.maxIterations && iterations >= options.maxIterations) return
    iterations += 1
    if (Date.now() > deadline) {
      await touchCardAiRun(preset.supplierUuid, { status: 'finished', error: 'остановлено по лимиту времени (12 часов)' })
      return
    }

    const rows = await selectPendingCardUpdatesForAi(preset.supplierUuid, Math.min(Math.max(Number(run.batch_size) || 4, 1), 20))
    if (rows.length === 0) {
      if (!retriedFailures) {
        retriedFailures = true
        const requeued = await requeueFailedCardAi(preset.supplierUuid)
        if (requeued > 0) {
          await touchCardAiRun(preset.supplierUuid, {})
          continue
        }
      }
      await touchCardAiRun(preset.supplierUuid, { status: 'finished' })
      return
    }

    let processed = 0
    let failed = 0
    let lastError: string | null = null
    for (const row of rows) {
      try {
        const result = await runProductCardAi(row, settings, prompt.effective, prompt.packaging)
        const attributes = { ...(row.proposed_attributes || {}) }
        if (result.materials.length > 0 && !attributes.materials) attributes.materials = result.materials
        await saveCardUpdateAi(row.id, {
          description: result.description,
          photoAlts: result.photoAlts,
          model,
          attributes,
        })
        processed += 1
      } catch (error: any) {
        failed += 1
        lastError = String(error?.message || error || 'ошибка ИИ').slice(0, 500)
        await markCardUpdateAiFailed(row.id, lastError, model)
      }
    }

    await touchCardAiRun(preset.supplierUuid, { processedDelta: processed, failedDelta: failed, model, error: lastError })
    // Небольшая пауза между порциями, чтобы не занимать процесс целиком.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

const activeTasks = new Map<string, Promise<void>>()
let supervisorStarted = false

/** Поднимает циклы по всем запущенным прогонам; вызывается супервизором и кнопкой. */
export async function ensureCardAiTasks() {
  let runs: Array<{ supplier_id: string }> = []
  try {
    runs = await listRunningCardAiRuns()
  } catch (error) {
    console.error('Card AI supervisor: не удалось прочитать прогоны', error)
    return
  }

  for (const run of runs) {
    const supplierId = run.supplier_id
    if (activeTasks.has(supplierId)) continue
    const task = runCardAiLoop(supplierId)
      .catch(async (error) => {
        console.error('Card AI loop failed', error)
        await touchCardAiRun(supplierId, { status: 'interrupted', error: String(error?.message || error).slice(0, 500) })
      })
      .finally(() => { activeTasks.delete(supplierId) })
    activeTasks.set(supplierId, task)
  }
}

/** Супервизор прогона ИИ: раз в десять секунд держит по одной задаче на поставщика. */
export function startCardAiSupervisor() {
  if (supervisorStarted) return
  supervisorStarted = true
  const timer = setInterval(() => { void ensureCardAiTasks() }, 10_000)
  if (typeof timer.unref === 'function') timer.unref()
  void ensureCardAiTasks()
}

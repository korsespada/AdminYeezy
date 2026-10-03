import { scrapingQuery } from '@/lib/db'
import { applyApprovedCardUpdates } from '@/lib/product-card-apply'
import { findProductCardPreset, PRODUCT_CARD_PRESETS } from '@/lib/product-card-presets'
import { isCardAutoApplyEnabled } from '@/lib/product-card-suppliers'
import { cardUpdateCounts, requeueFailedCardApply } from '@/lib/product-card-updates'

/**
 * Фоновое применение апрувнутых карточек.
 *
 * Живёт в том же супервизоре, что и прогон ИИ (`instrumentation.ts`): при
 * включённом автоприменении оператору достаточно нажать «Апрувить», а запись в
 * Rails идёт сама. Прогресс хранится в `product_card_apply_runs`, поэтому вкладку
 * можно закрыть, а после рестарта контейнера цикл поднимается сам.
 */

export const CARD_APPLY_RUN_STALE_SECONDS = 180
const CARD_APPLY_MAX_MINUTES = 8 * 60

export interface CardApplyRun {
  supplier_id: string
  status: string
  batch_size: number
  applied: number
  failed: number
  started_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
  last_error: string | null
}

export async function getCardApplyRun(supplierId: string) {
  const result = await scrapingQuery<CardApplyRun>(
    `SELECT supplier_id, status, batch_size, applied, failed, started_at, heartbeat_at, finished_at, last_error
     FROM product_card_apply_runs WHERE supplier_id = $1`,
    [supplierId],
  )
  return result.rows[0] || null
}

export async function isCardApplyRunActive(supplierId: string) {
  const result = await scrapingQuery<{ active: boolean }>(
    `SELECT (status = 'running' AND heartbeat_at > NOW() - ($2 || ' seconds')::interval) AS active
     FROM product_card_apply_runs WHERE supplier_id = $1`,
    [supplierId, String(CARD_APPLY_RUN_STALE_SECONDS)],
  )
  return Boolean(result.rows[0]?.active)
}

export async function listRunningCardApplyRuns() {
  const result = await scrapingQuery<{ supplier_id: string }>(
    `SELECT supplier_id FROM product_card_apply_runs WHERE status = 'running'`,
  )
  return result.rows
}

export async function startCardApplyRun(supplierId: string, batchSize = 10) {
  await scrapingQuery(
    `INSERT INTO product_card_apply_runs (supplier_id, status, batch_size, applied, failed, started_at, heartbeat_at, finished_at, last_error, updated_at)
     VALUES ($1, 'running', $2, 0, 0, NOW(), NOW(), NULL, NULL, NOW())
     ON CONFLICT (supplier_id) DO UPDATE SET
       status = 'running',
       batch_size = EXCLUDED.batch_size,
       started_at = NOW(),
       heartbeat_at = NOW(),
       finished_at = NULL,
       last_error = NULL,
       updated_at = NOW()`,
    [supplierId, Math.min(Math.max(Number(batchSize) || 10, 1), 50)],
  )
}

export async function stopCardApplyRun(supplierId: string) {
  const result = await scrapingQuery(
    `UPDATE product_card_apply_runs
     SET status = 'stopped', finished_at = NOW(), updated_at = NOW()
     WHERE supplier_id = $1 AND status = 'running'`,
    [supplierId],
  )
  return result.rowCount || 0
}

export async function touchCardApplyRun(supplierId: string, update: {
  status?: string
  appliedDelta?: number
  failedDelta?: number
  error?: string | null
}) {
  await scrapingQuery(
    `UPDATE product_card_apply_runs
     SET status = COALESCE($2, status),
         applied = applied + $3,
         failed = failed + $4,
         last_error = $5,
         heartbeat_at = NOW(),
         finished_at = CASE WHEN $2 IS NOT NULL AND $2 <> 'running' THEN NOW() ELSE finished_at END,
         updated_at = NOW()
     WHERE supplier_id = $1`,
    [
      supplierId,
      update.status || null,
      Math.max(0, Number(update.appliedDelta) || 0),
      Math.max(0, Number(update.failedDelta) || 0),
      update.error === undefined ? null : update.error,
    ],
  )
}

/** Нужно ли начинать автоприменение: апрувнутое есть, прогон не идёт. */
export function autoApplyDue(input: { autoApply: boolean; approved: number; active: boolean }) {
  return Boolean(input.autoApply) && Number(input.approved) > 0 && !input.active
}

/** Цикл применения: порции апрувнутых строк, пока они не закончатся. */
export async function runCardApplyLoop(supplierId: string, options: { maxIterations?: number } = {}) {
  const preset = findProductCardPreset(supplierId)
  const deadline = Date.now() + CARD_APPLY_MAX_MINUTES * 60_000
  let retriedFailures = false
  let iterations = 0

  for (;;) {
    const run = await getCardApplyRun(preset.supplierUuid)
    if (!run || run.status !== 'running') return
    if (options.maxIterations && iterations >= options.maxIterations) return
    iterations += 1
    if (Date.now() > deadline) {
      await touchCardApplyRun(preset.supplierUuid, { status: 'finished', error: 'остановлено по лимиту времени (8 часов)' })
      return
    }

    const result = await applyApprovedCardUpdates(preset.supplierUuid, Math.min(Math.max(Number(run.batch_size) || 10, 1), 50))
    if (result.processed === 0) {
      if (!retriedFailures) {
        retriedFailures = true
        const requeued = await requeueFailedCardApply(preset.supplierUuid)
        if (requeued > 0) {
          await touchCardApplyRun(preset.supplierUuid, {})
          continue
        }
      }
      await touchCardApplyRun(preset.supplierUuid, { status: 'finished' })
      return
    }

    await touchCardApplyRun(preset.supplierUuid, {
      appliedDelta: result.applied,
      failedDelta: result.failed,
      error: result.failures[0] || null,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const activeApplyTasks = new Map<string, Promise<void>>()
let applySupervisorStarted = false

/**
 * Запускает цикл применения и держит его в карте активных задач.
 *
 * Так же работает «Публикация» в «Выгрузках»: работа идёт в запросе оператора,
 * прогресс пишется в базу, интерфейс его опрашивает. Карта нужна, чтобы
 * супервизор (автоприменение) не поднял второй цикл по той же очереди.
 */
export async function runCardApplyLoopTracked(supplierId: string) {
  const existing = activeApplyTasks.get(supplierId)
  if (existing) return existing
  const task = runCardApplyLoop(supplierId)
    .catch(async (error) => {
      console.error('Card apply loop failed', error)
      await touchCardApplyRun(supplierId, { status: 'interrupted', error: String(error?.message || error).slice(0, 500) })
    })
    .finally(() => { activeApplyTasks.delete(supplierId) })
  activeApplyTasks.set(supplierId, task)
  return task
}

/** Поднимает циклы применения и включает автоприменение там, где оно нужно. */
export async function ensureCardApplyTasks() {
  let runs: Array<{ supplier_id: string }> = []
  try {
    runs = await listRunningCardApplyRuns()
  } catch (error) {
    console.error('Card apply supervisor: не удалось прочитать прогоны', error)
    return
  }

  // Автоприменение: оператор апрувит карточки, запись в Rails идёт сама.
  for (const preset of PRODUCT_CARD_PRESETS) {
    if (runs.some((run) => run.supplier_id === preset.supplierUuid)) continue
    try {
      const [autoApply, counts, active] = await Promise.all([
        isCardAutoApplyEnabled(preset.supplierUuid),
        cardUpdateCounts(preset.supplierUuid),
        isCardApplyRunActive(preset.supplierUuid),
      ])
      if (autoApplyDue({ autoApply, approved: counts.approved, active })) {
        await startCardApplyRun(preset.supplierUuid)
        runs = [...runs, { supplier_id: preset.supplierUuid }]
      }
    } catch (error) {
      console.error('Card apply supervisor: не удалось проверить автоприменение', error)
    }
  }

  for (const run of runs) {
    const supplierId = run.supplier_id
    if (activeApplyTasks.has(supplierId)) continue
    void runCardApplyLoopTracked(supplierId)
  }
}

export function startCardApplySupervisor() {
  if (applySupervisorStarted) return
  applySupervisorStarted = true
  const timer = setInterval(() => { void ensureCardApplyTasks() }, 15_000)
  if (typeof timer.unref === 'function') timer.unref()
  void ensureCardApplyTasks()
}

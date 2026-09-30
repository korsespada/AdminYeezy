import { patchRailsAdminProduct } from '@/lib/rails-admin'
import {
  getMatchRun,
  markMatchApplied,
  markMatchFailed,
  retryFailedMatches,
  selectApprovedForApply,
  touchMatchRun,
} from '@/lib/product-video-matches'

/**
 * Фоновый перенос апрувнутых видео в S3 и в карточки товара.
 * Работает в процессе сервера, а не во вкладке оператора: вкладку можно закрыть,
 * прогресс виден по `product_video_match_runs` и статусам строк.
 */

const APPLY_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1500, 5000]

/** Ошибка ffmpeg занимает килобайты баннера: оставляем суть, а не шапку сборки. */
export function compactApplyError(error: unknown) {
  const message = String((error as any)?.message || error || 'ошибка применения')
  if (message.length <= 400) return message
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean)
  const head = lines.slice(0, 2).join(' ')
  const tail = lines.slice(-3).join(' ')
  return `${head} … ${tail}`.slice(0, 700)
}

/** Одна попытка: скачать источник, перекодировать, положить в S3 и обновить карточку. */
async function applyMatchOnce(row: { video_source_url: string; crm_product_id: string }) {
  const workflow = await import('../scripts/batch-workflow')
  const { videoKey, posterKey } = workflow.videoStorageKeys(row.video_source_url)
  const hosted = await workflow.uploadVideoIfNeeded(row.video_source_url, videoKey, posterKey)
  if (!hosted?.url) throw new Error('S3 не вернул ссылку на видео')
  await patchRailsAdminProduct(row.crm_product_id, {
    videoUrl: hosted.url,
    videoPosterUrl: hosted.posterUrl || null,
  })
  return { url: hosted.url as string, posterUrl: (hosted.posterUrl as string) || null }
}

/** Обрабатывает одну порцию апрувнутых строк, повторяя временные сбои. */
export async function applyApprovedBatch(batchId: string, limit: number) {
  const rows = await selectApprovedForApply(batchId, limit)
  if (rows.length === 0) return { processed: 0, applied: 0, failed: 0 }

  let applied = 0
  let failed = 0
  await Promise.all(rows.map(async (row) => {
    let lastError: unknown = null
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
      try {
        const hosted = await applyMatchOnce(row)
        await markMatchApplied(row.id, hosted.url, hosted.posterUrl)
        applied += 1
        return
      } catch (error) {
        lastError = error
        const delay = RETRY_DELAYS_MS[attempt]
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    failed += 1
    await markMatchFailed(row.id, compactApplyError(lastError))
  }))

  return { processed: rows.length, applied, failed }
}

/**
 * Цикл заливки, пока в партии есть апрувнутые строки и запуск не остановлен.
 * В конце один раз автоматически повторяет упавшие строки — таймауты CDN и
 * разовые сбои кодирования обычно проходят со второго прохода.
 */
export async function runApplyLoop(batchId: string, options: { maxMinutes?: number } = {}) {
  const deadline = Date.now() + (options.maxMinutes ?? 480) * 60_000
  let retriedFailures = false
  for (;;) {
    const run = await getMatchRun(batchId)
    if (!run || run.status !== 'running') return
    if (Date.now() > deadline) {
      await touchMatchRun(batchId, { status: 'finished', error: 'остановлено по лимиту времени (8 часов)' })
      return
    }

    const batchSize = Math.min(Math.max(Number(run.batch_size) || 2, 1), 6)
    const result = await applyApprovedBatch(batchId, batchSize)
    if (result.processed === 0) {
      if (!retriedFailures) {
        const requeued = await retryFailedMatches(batchId)
        retriedFailures = true
        if (requeued > 0) {
          await touchMatchRun(batchId, {})
          continue
        }
      }
      await touchMatchRun(batchId, { status: 'finished' })
      return
    }
    await touchMatchRun(batchId, { appliedDelta: result.applied, failedDelta: result.failed })
    // Небольшая пауза, чтобы не занимать процесс на 100% между порциями.
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

import { patchRailsAdminProduct } from '@/lib/rails-admin'
import {
  getMatchRun,
  markMatchApplied,
  markMatchFailed,
  selectApprovedForApply,
  touchMatchRun,
} from '@/lib/product-video-matches'

/**
 * Фоновый перенос апрувнутых видео в S3 и в карточки товара.
 * Работает в процессе сервера, а не во вкладке оператора: вкладку можно закрыть,
 * прогресс виден по `product_video_match_runs` и статусам строк.
 */

/** Обрабатывает одну порцию апрувнутых строк. */
export async function applyApprovedBatch(batchId: string, limit: number) {
  const rows = await selectApprovedForApply(batchId, limit)
  if (rows.length === 0) return { processed: 0, applied: 0, failed: 0 }

  const workflow = await import('../scripts/batch-workflow')

  let applied = 0
  let failed = 0
  await Promise.all(rows.map(async (row) => {
    try {
      const { videoKey, posterKey } = workflow.videoStorageKeys(row.video_source_url)
      const hosted = await workflow.uploadVideoIfNeeded(row.video_source_url, videoKey, posterKey)
      if (!hosted?.url) throw new Error('S3 не вернул ссылку на видео')
      await patchRailsAdminProduct(row.crm_product_id, {
        videoUrl: hosted.url,
        videoPosterUrl: hosted.posterUrl || null,
      })
      await markMatchApplied(row.id, hosted.url, hosted.posterUrl || null)
      applied += 1
    } catch (error: any) {
      failed += 1
      await markMatchFailed(row.id, error?.message || 'ошибка применения')
    }
  }))

  return { processed: rows.length, applied, failed }
}

/**
 * Цикл заливки, пока в партии есть апрувнутые строки и запуск не остановлен.
 * Продолжает работу после перезагрузки страницы; при остановке контейнера
 * запуск оживает сам при следующем открытии раздела (сторож по heartbeat).
 */
export async function runApplyLoop(batchId: string, options: { maxMinutes?: number } = {}) {
  const deadline = Date.now() + (options.maxMinutes ?? 480) * 60_000
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
      await touchMatchRun(batchId, { status: 'finished' })
      return
    }
    await touchMatchRun(batchId, { appliedDelta: result.applied, failedDelta: result.failed })
    // Небольшая пауза, чтобы не занимать процесс на 100% между порциями.
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

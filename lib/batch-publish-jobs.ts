import crypto from 'crypto'

/**
 * Публикация партии идёт минутами и часами (тысячи фото и видео), поэтому она
 * не может жить внутри одного HTTP-запроса server action: браузер, прокси или
 * сон ноутбука рвут соединение, оператор видит «Failed to fetch», а итог
 * работы сервера теряется. Server action только запускает задачу здесь и сразу
 * отвечает; браузер узнаёт прогресс из блокировки в БД, а итог — из этого
 * реестра через `GET /api/batches/publish-progress`.
 *
 * Реестр живёт в памяти процесса: AdminYeezy работает одним Node-процессом.
 * После рестарта итог пропадает, но блокировка в БД покажет зависшую
 * операцию, а повторная публикация идемпотентна.
 */

export type BatchPublishJobStatus = 'running' | 'succeeded' | 'failed'

export type BatchPublishJob = {
  id: string
  batchId: string
  status: BatchPublishJobStatus
  startedAt: string
  finishedAt: string | null
  result: unknown
  error: string | null
}

type Registry = Map<string, BatchPublishJob>

const REGISTRY_KEY = Symbol.for('adminyeezy.batchPublishJobs')

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  if (!holder[REGISTRY_KEY]) holder[REGISTRY_KEY] = new Map()
  return holder[REGISTRY_KEY]!
}

export function getBatchPublishJob(batchId: string): BatchPublishJob | null {
  return registry().get(batchId) || null
}

/**
 * Запускает публикацию в фоне. Если задача этой партии уже идёт в этом
 * процессе, возвращает её, не запуская вторую.
 */
export function startBatchPublishJob(
  batchId: string,
  run: () => Promise<unknown>,
): { job: BatchPublishJob; alreadyRunning: boolean } {
  const jobs = registry()
  const current = jobs.get(batchId)
  if (current?.status === 'running') return { job: current, alreadyRunning: true }

  const job: BatchPublishJob = {
    id: crypto.randomUUID(),
    batchId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  }
  jobs.set(batchId, job)

  void (async () => {
    try {
      job.result = await run()
      job.status = 'succeeded'
      console.info('[batch-publish] done', JSON.stringify({ batchId, jobId: job.id, result: summarizeResult(job.result) }))
    } catch (error: any) {
      job.error = String(error?.message || error || 'unknown')
      job.status = 'failed'
      console.error('[batch-publish] failed', JSON.stringify({ batchId, jobId: job.id }), job.error)
    } finally {
      job.finishedAt = new Date().toISOString()
    }
  })()

  return { job, alreadyRunning: false }
}

function summarizeResult(result: unknown) {
  if (!result || typeof result !== 'object') return result
  const { errors, videoWarnings, ...rest } = result as Record<string, unknown>
  return {
    ...rest,
    errors: Array.isArray(errors) ? errors.length : 0,
    videoWarnings: Array.isArray(videoWarnings) ? videoWarnings.length : 0,
  }
}

import { randomUUID } from 'node:crypto'
import { scrapingQuery } from '@/lib/db'

/**
 * Очередь заданий на чистку фотографий от вотермарки.
 *
 * Сервер только раздаёт задания: тяжёлая часть (LaMa) идёт на машине оператора.
 * Задания держим в scraping-БД, потому что она техническая и уже используется
 * для похожих очередей, а lease-поля защищают от зависших воркеров.
 */

export type PhotoCleanStatus = 'pending' | 'claimed' | 'done' | 'failed'
export type PhotoCleanVerdict = 'ok' | 'review' | 'miss'

export interface PhotoCleanJob {
  id: string
  sourceKey: string
  sourceUrl: string
  supplier: string
  sourceProduct: string
  sourcePosition: number | null
  status: PhotoCleanStatus
  attempts: number
  leaseToken: string | null
  cleanStatus: PhotoCleanVerdict | null
  s3CleanUrl: string | null
  s3BeforeUrl: string | null
  s3AfterUrl: string | null
  zAfter: number | null
  maskPx: number | null
  passes: number | null
  quality: Record<string, unknown>
  seconds: number | null
  error: string | null
}

const LEASE_MINUTES = 30

function mapJob(row: any): PhotoCleanJob {
  return {
    id: row.id,
    sourceKey: row.source_key,
    sourceUrl: row.source_url,
    supplier: row.supplier || '',
    sourceProduct: row.source_product || '',
    sourcePosition: row.source_position === null ? null : Number(row.source_position),
    status: row.status,
    attempts: Number(row.attempts || 0),
    leaseToken: row.lease_token || null,
    cleanStatus: row.clean_status || null,
    s3CleanUrl: row.s3_clean_url || null,
    s3BeforeUrl: row.s3_before_url || null,
    s3AfterUrl: row.s3_after_url || null,
    zAfter: row.z_after === null ? null : Number(row.z_after),
    maskPx: row.mask_px === null ? null : Number(row.mask_px),
    passes: row.passes === null ? null : Number(row.passes),
    quality: row.quality && typeof row.quality === 'object' ? row.quality : {},
    seconds: row.seconds === null ? null : Number(row.seconds),
    error: row.error || null,
  }
}

/** Ставит фото в очередь. Повторная постановка того же источника ничего не дублирует. */
export async function enqueuePhotoCleanJobs(input: {
  supplier: string
  sourceProduct: string
  photos: Array<{ url: string; position?: number | null }>
}): Promise<{ created: number; existing: number }> {
  let created = 0
  let existing = 0
  for (const [index, photo] of input.photos.entries()) {
    const url = String(photo.url || '').trim()
    if (!url) continue
    const sourceKey = url.split('?')[0]
    const result = await scrapingQuery(
      `INSERT INTO photo_clean_jobs (id, source_key, source_url, supplier, source_product, source_position)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), sourceKey, url, input.supplier, input.sourceProduct,
       photo.position ?? index + 1],
    )
    if (result.rowCount) created += 1
    else existing += 1
  }
  return { created, existing }
}

/** Забирает пачку заданий под lease. Зависшие lease возвращаются в очередь. */
export async function claimPhotoCleanJobs(workerId: string, limit = 3): Promise<Array<PhotoCleanJob & { leaseToken: string }>> {
  const rows = await scrapingQuery(
    `WITH stale AS (
       UPDATE photo_clean_jobs
          SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, worker_id = NULL,
              updated_at = NOW()
        WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
        RETURNING id
     ), picked AS (
       SELECT id FROM photo_clean_jobs
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE photo_clean_jobs job
        SET status = 'claimed',
            worker_id = $2,
            lease_token = $3,
            lease_expires_at = NOW() + ($4 || ' minutes')::interval,
            attempts = job.attempts + 1,
            updated_at = NOW()
      WHERE job.id IN (SELECT id FROM picked)
      RETURNING job.*`,
    [limit, workerId, randomUUID(), String(LEASE_MINUTES)],
  )
  return rows.rows.map((row: any) => ({ ...mapJob(row), leaseToken: String(row.lease_token) }))
}

export async function heartbeatPhotoCleanJobs(jobIds: string[], leaseToken: string): Promise<number> {
  if (!jobIds.length) return 0
  const result = await scrapingQuery(
    `UPDATE photo_clean_jobs
        SET lease_expires_at = NOW() + ($3 || ' minutes')::interval, updated_at = NOW()
      WHERE id = ANY($1::uuid[]) AND lease_token = $2 AND status = 'claimed'`,
    [jobIds, leaseToken, String(LEASE_MINUTES)],
  )
  return result.rowCount || 0
}

export interface PhotoCleanResult {
  id: string
  leaseToken: string
  cleanStatus: PhotoCleanVerdict
  s3CleanUrl: string
  s3BeforeUrl?: string | null
  s3AfterUrl?: string | null
  zAfter?: number | null
  maskPx?: number | null
  passes?: number | null
  seconds?: number | null
  quality?: Record<string, unknown>
}

export async function completePhotoCleanJob(result: PhotoCleanResult): Promise<boolean> {
  const updated = await scrapingQuery(
    `UPDATE photo_clean_jobs
        SET status = 'done',
            clean_status = $3,
            s3_clean_url = $4,
            s3_before_url = $5,
            s3_after_url = $6,
            z_after = $7,
            mask_px = $8,
            passes = $9,
            seconds = $10,
            quality = $11::jsonb,
            error = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND lease_token = $2 AND status = 'claimed'`,
    [result.id, result.leaseToken, result.cleanStatus, result.s3CleanUrl,
     result.s3BeforeUrl || null, result.s3AfterUrl || null, result.zAfter ?? null,
     result.maskPx ?? null, result.passes ?? null, result.seconds ?? null,
     JSON.stringify(result.quality || {})],
  )
  return Boolean(updated.rowCount)
}

export async function failPhotoCleanJob(id: string, leaseToken: string, error: string): Promise<boolean> {
  const failed = await scrapingQuery(
    `UPDATE photo_clean_jobs
        SET status = 'failed', error = $3, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE id = $1 AND lease_token = $2 AND status = 'claimed'`,
    [id, leaseToken, String(error || '').slice(0, 2000)],
  )
  return Boolean(failed.rowCount)
}

export async function listPhotoCleanJobs(filter: {
  supplier?: string
  sourceProduct?: string
  status?: PhotoCleanStatus
  limit?: number
} = {}): Promise<PhotoCleanJob[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filter.supplier) {
    params.push(filter.supplier)
    conditions.push(`supplier = $${params.length}`)
  }
  if (filter.sourceProduct) {
    params.push(filter.sourceProduct)
    conditions.push(`source_product = $${params.length}`)
  }
  if (filter.status) {
    params.push(filter.status)
    conditions.push(`status = $${params.length}`)
  }
  params.push(Math.min(Math.max(filter.limit || 200, 1), 1000))
  const rows = await scrapingQuery(
    `SELECT * FROM photo_clean_jobs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY source_product, source_position NULLS LAST, created_at
      LIMIT $${params.length}`,
    params,
  )
  return rows.rows.map(mapJob)
}

export async function photoCleanStats(supplier = ''): Promise<Record<string, number>> {
  const rows = await scrapingQuery(
    `SELECT status, clean_status, COUNT(*)::int AS count
       FROM photo_clean_jobs
      WHERE ($1 = '' OR supplier = $1)
      GROUP BY status, clean_status`,
    [supplier],
  )
  const stats: Record<string, number> = {}
  for (const row of rows.rows) {
    const key = row.status === 'done' ? `done:${row.clean_status || 'unknown'}` : String(row.status)
    stats[key] = (stats[key] || 0) + Number(row.count)
  }
  return stats
}

/**
 * Возвращает проблемные кадры в очередь: «не найдена», «на глаза» и сбои.
 *
 * Обычная постановка заданий повторно их не берёт (ON CONFLICT DO NOTHING), а
 * детектор и чистка со временем улучшаются — значит нужен явный перезапуск.
 * Файлы в S3 не стираем: пока кадр обрабатывается заново, оператор продолжает
 * видеть прежние кропы «до/после».
 */
export async function requeueProblemPhotoCleanJobs(filter: {
  supplier?: string
  sourceProduct?: string
} = {}): Promise<number> {
  const result = await scrapingQuery(
    `UPDATE photo_clean_jobs
        SET status='pending',
            clean_status=NULL,
            lease_token=NULL,
            lease_expires_at=NULL,
            worker_id=NULL,
            z_after=NULL,
            mask_px=NULL,
            passes=NULL,
            quality='{}'::jsonb,
            seconds=NULL,
            error=NULL,
            updated_at=NOW()
      WHERE ($1 = '' OR supplier = $1)
        AND ($2 = '' OR source_product = $2)
        AND (status='failed' OR (status='done' AND clean_status IN ('miss','review')))
      RETURNING id`,
    [filter.supplier || '', filter.sourceProduct || ''],
  )
  return result.rowCount || 0
}

/** Сколько кадров считается проблемными — для подписи на кнопке. */
export async function countProblemPhotoCleanJobs(filter: {
  supplier?: string
  sourceProduct?: string
} = {}): Promise<number> {
  const result = await scrapingQuery(
    `SELECT COUNT(*)::int AS count
       FROM photo_clean_jobs
      WHERE ($1 = '' OR supplier = $1)
        AND ($2 = '' OR source_product = $2)
        AND (status='failed' OR (status='done' AND clean_status IN ('miss','review')))`,
    [filter.supplier || '', filter.sourceProduct || ''],
  )
  return Number(result.rows[0]?.count || 0)
}

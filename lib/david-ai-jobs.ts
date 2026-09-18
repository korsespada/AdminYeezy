import { randomUUID } from 'node:crypto'
import { scrapingQuery } from '@/lib/db'

/**
 * Очередь ИИ-заданий для черновиков David Studio.
 *
 * Сервер не вызывает модель сам: на проде у него нет ни ключей, ни доступа к
 * Cockpit. Он только готовит задание (промпт + снимок справочников) и раздаёт
 * его локальному воркеру, а ответ нормализует и записывает в черновик.
 * Lease защищает от зависших воркеров, attempts ограничивает повторы.
 */

export type DavidAiStatus = 'pending' | 'claimed' | 'done' | 'failed'

export interface DavidAiJob {
  id: string
  handle: string
  status: DavidAiStatus
  attempts: number
  workerId: string | null
  input: Record<string, any>
  output: Record<string, any> | null
  error: string | null
  createdAt: string | null
  updatedAt: string | null
  leaseToken?: string
}

const LEASE_MINUTES = 30
const MAX_ATTEMPTS = 3

function mapJob(row: any): DavidAiJob {
  return {
    id: row.id,
    handle: row.handle,
    status: row.status,
    attempts: Number(row.attempts || 0),
    workerId: row.worker_id || null,
    input: row.input && typeof row.input === 'object' ? row.input : {},
    output: row.output && typeof row.output === 'object' ? row.output : null,
    error: row.error || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

/**
 * Кладёт задание в очередь. Незабранные задания по этому товару заменяются,
 * чтобы повторное нажатие не размножало вызовы модели.
 */
export async function enqueueDavidAiJob(input: {
  handle: string
  payload: Record<string, unknown>
}): Promise<{ id: string; replaced: number }> {
  const replaced = await scrapingQuery(
    `DELETE FROM david_ai_jobs WHERE handle=$1 AND status='pending'`,
    [input.handle],
  )
  const inserted = await scrapingQuery(
    `INSERT INTO david_ai_jobs (id, handle, input)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [randomUUID(), input.handle, JSON.stringify(input.payload)],
  )
  return { id: String(inserted.rows[0].id), replaced: replaced.rowCount || 0 }
}

/** Забирает задания под lease. Зависшие lease возвращаются в очередь. */
export async function claimDavidAiJobs(workerId: string, limit = 1): Promise<DavidAiJob[]> {
  const rows = await scrapingQuery(
    `WITH stale AS (
       UPDATE david_ai_jobs
          SET status = CASE WHEN attempts >= $5 THEN 'failed' ELSE 'pending' END,
              error = CASE WHEN attempts >= $5 THEN COALESCE(error, 'Превышено число попыток') ELSE error END,
              lease_token = NULL, lease_expires_at = NULL, worker_id = NULL, updated_at = NOW()
        WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
        RETURNING id
     ), picked AS (
       SELECT id FROM david_ai_jobs
        WHERE status = 'pending' AND attempts < $5
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE david_ai_jobs job
        SET status = 'claimed',
            worker_id = $2,
            lease_token = $3,
            lease_expires_at = NOW() + ($4 || ' minutes')::interval,
            attempts = job.attempts + 1,
            updated_at = NOW()
      WHERE job.id IN (SELECT id FROM picked)
      RETURNING job.*`,
    [limit, workerId, randomUUID(), String(LEASE_MINUTES), MAX_ATTEMPTS],
  )
  return rows.rows.map((row: any) => ({ ...mapJob(row), leaseToken: String(row.lease_token) }))
}

export async function heartbeatDavidAiJobs(jobIds: string[], leaseToken: string): Promise<number> {
  if (!jobIds.length) return 0
  const result = await scrapingQuery(
    `UPDATE david_ai_jobs
        SET lease_expires_at = NOW() + ($3 || ' minutes')::interval, updated_at = NOW()
      WHERE id = ANY($1::uuid[]) AND lease_token = $2 AND status = 'claimed'`,
    [jobIds, leaseToken, String(LEASE_MINUTES)],
  )
  return result.rowCount || 0
}

export async function completeDavidAiJob(id: string, leaseToken: string, output: unknown): Promise<boolean> {
  const updated = await scrapingQuery(
    `UPDATE david_ai_jobs
        SET status='done', output=$3::jsonb, error=NULL,
            lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
      WHERE id=$1 AND lease_token=$2 AND status='claimed'`,
    [id, leaseToken, JSON.stringify(output ?? {})],
  )
  return Boolean(updated.rowCount)
}

export async function failDavidAiJob(id: string, leaseToken: string, error: string): Promise<boolean> {
  const failed = await scrapingQuery(
    `UPDATE david_ai_jobs
        SET status='failed', error=$3, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
      WHERE id=$1 AND lease_token=$2 AND status='claimed'`,
    [id, leaseToken, String(error || '').slice(0, 2000)],
  )
  return Boolean(failed.rowCount)
}

/** Последнее задание по товару — для статуса и ошибок в интерфейсе. */
export async function latestDavidAiJob(handle: string): Promise<DavidAiJob | null> {
  const result = await scrapingQuery(
    `SELECT * FROM david_ai_jobs WHERE handle=$1 ORDER BY created_at DESC LIMIT 1`,
    [handle],
  )
  return result.rows[0] ? mapJob(result.rows[0]) : null
}

export async function davidAiJobsForHandles(handles: string[]): Promise<Map<string, DavidAiJob>> {
  if (!handles.length) return new Map()
  const result = await scrapingQuery(
    `SELECT DISTINCT ON (handle) * FROM david_ai_jobs
      WHERE handle = ANY($1::text[])
      ORDER BY handle, created_at DESC`,
    [handles],
  )
  return new Map(result.rows.map((row: any) => [String(row.handle), mapJob(row)]))
}

export async function davidAiQueueStats(): Promise<Record<string, number>> {
  const result = await scrapingQuery(
    `SELECT status, COUNT(*)::int AS count FROM david_ai_jobs GROUP BY status`,
  )
  const stats: Record<string, number> = {}
  for (const row of result.rows) stats[String(row.status)] = Number(row.count)
  return stats
}

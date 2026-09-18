import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  claimDavidAiJobs,
  completeDavidAiJob,
  failDavidAiJob,
  heartbeatDavidAiJobs,
  davidAiQueueStats,
} from '@/lib/david-ai-jobs'
import { completeDavidDraftJob, failDavidDraftJob } from '@/lib/david-studio-ai'

export const dynamic = 'force-dynamic'

/**
 * Ручка локального воркера для черновиков David Studio.
 *
 * Прод не умеет ходить в модель: он только отдаёт задание с готовым промптом и
 * принимает сырой ответ. Нормализация ответа и запись черновика остаются здесь,
 * поэтому воркеру не нужны ни реестр характеристик, ни доступ к Rails.
 */
const TOKEN_NAMES = ['DAVID_AI_WORKER_TOKEN', 'PHOTO_CLEAN_WORKER_TOKEN', 'BATCH_AI_WORKER_TOKEN', 'AI_CATALOG_WORKER_TOKEN']

function authorized(request: NextRequest) {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!actual) return false
  return TOKEN_NAMES
    .map((name) => process.env[name] || '')
    .filter(Boolean)
    .some((expected) => expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual)))
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const workerId = String(body.worker_id || 'david-ai-local').slice(0, 160)

    if (body.action === 'claim') {
      const jobs = await claimDavidAiJobs(workerId, Math.min(Math.max(Number(body.limit) || 1, 1), 5))
      return NextResponse.json({
        ok: true,
        jobs: jobs.map((job) => ({
          id: job.id,
          lease_token: job.leaseToken,
          handle: job.handle,
          attempts: job.attempts,
          input: job.input,
        })),
      })
    }

    if (body.action === 'heartbeat') {
      const ids = Array.isArray(body.job_ids) ? body.job_ids.map(String) : []
      const renewed = await heartbeatDavidAiJobs(ids, String(body.lease_token || ''))
      return NextResponse.json({ ok: true, renewed })
    }

    if (body.action === 'complete') {
      const jobId = String(body.job_id || '')
      const leaseToken = String(body.lease_token || '')
      const result = await completeDavidDraftJob({ jobId, leaseToken, output: body.output })
      if (!result.success) {
        // Потерянный lease — повод отдать задание заново; ошибка нормализации —
        // нет: ответ модели уже получен, а причина видна оператору в черновике.
        if (result.leaseLost) return NextResponse.json({ error: result.error }, { status: 409 })
        await failDavidAiJob(jobId, leaseToken, result.error)
        return NextResponse.json({ ok: false, error: result.error })
      }
      const written = await completeDavidAiJob(jobId, leaseToken, body.output)
      if (!written) return NextResponse.json({ error: 'lease_lost' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'fail') {
      const result = await failDavidDraftJob({
        jobId: String(body.job_id || ''),
        leaseToken: String(body.lease_token || ''),
        error: String(body.error || ''),
      })
      if (!result.success) return NextResponse.json({ error: 'lease_lost' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'stats') {
      return NextResponse.json({ ok: true, stats: await davidAiQueueStats() })
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 422 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'worker_error' }, { status: 500 })
  }
}

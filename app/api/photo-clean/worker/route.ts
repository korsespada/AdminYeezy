import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  claimPhotoCleanJobs,
  completePhotoCleanJob,
  failPhotoCleanJob,
  heartbeatPhotoCleanJobs,
  photoCleanStats,
} from '@/lib/photo-clean-jobs'

export const dynamic = 'force-dynamic'

/** Ручка для локального воркера чистки фото: он ходит наружу сам, сервер только раздаёт задания. */
function authorized(request: NextRequest) {
  const expected = process.env.PHOTO_CLEAN_WORKER_TOKEN || process.env.BATCH_AI_WORKER_TOKEN || ''
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!expected || !actual || expected.length !== actual.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const workerId = String(body.worker_id || 'photo-clean-local').slice(0, 160)

    if (body.action === 'claim') {
      const jobs = await claimPhotoCleanJobs(workerId, Math.min(Math.max(Number(body.limit) || 3, 1), 10))
      return NextResponse.json({
        ok: true,
        jobs: jobs.map((job) => ({
          id: job.id,
          lease_token: job.leaseToken,
          source_url: job.sourceUrl,
          source_product: job.sourceProduct,
          source_position: job.sourcePosition,
          attempts: job.attempts,
        })),
      })
    }

    if (body.action === 'heartbeat') {
      const ids = Array.isArray(body.job_ids) ? body.job_ids.map(String) : []
      const renewed = await heartbeatPhotoCleanJobs(ids, String(body.lease_token || ''))
      return NextResponse.json({ ok: true, renewed })
    }

    if (body.action === 'complete') {
      const done = await completePhotoCleanJob({
        id: String(body.job_id || ''),
        leaseToken: String(body.lease_token || ''),
        cleanStatus: body.clean_status === 'ok' || body.clean_status === 'review' ? body.clean_status : 'miss',
        s3CleanUrl: String(body.s3_clean_url || ''),
        s3BeforeUrl: body.s3_before_url ? String(body.s3_before_url) : null,
        s3AfterUrl: body.s3_after_url ? String(body.s3_after_url) : null,
        zAfter: body.z_after === undefined ? null : Number(body.z_after),
        maskPx: body.mask_px === undefined ? null : Number(body.mask_px),
        passes: body.passes === undefined ? null : Number(body.passes),
        seconds: body.seconds === undefined ? null : Number(body.seconds),
        quality: body.quality && typeof body.quality === 'object' ? body.quality : {},
      })
      if (!done) return NextResponse.json({ error: 'lease_lost' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'fail') {
      const failed = await failPhotoCleanJob(String(body.job_id || ''), String(body.lease_token || ''),
                                             String(body.error || ''))
      if (!failed) return NextResponse.json({ error: 'lease_lost' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'stats') {
      return NextResponse.json({ ok: true, stats: await photoCleanStats(String(body.supplier || '')) })
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 422 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'worker_error' }, { status: 500 })
  }
}

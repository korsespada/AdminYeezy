import { describe, expect, it, vi } from 'vitest'
import { getBatchPublishJob, startBatchPublishJob } from '@/lib/batch-publish-jobs'

describe('batch publish jobs', () => {
  it('runs publication in background and keeps the result for polling', async () => {
    let finish!: (value: unknown) => void
    const run = vi.fn(() => new Promise((resolve) => { finish = resolve }))

    const { job, alreadyRunning } = startBatchPublishJob('batch-ok', run)
    expect(alreadyRunning).toBe(false)
    expect(getBatchPublishJob('batch-ok')).toMatchObject({ id: job.id, status: 'running' })

    const second = startBatchPublishJob('batch-ok', run)
    expect(second).toMatchObject({ alreadyRunning: true, job: { id: job.id } })
    expect(run).toHaveBeenCalledTimes(1)

    finish({ success: 3, errors: [] })
    await vi.waitFor(() => expect(getBatchPublishJob('batch-ok')?.status).toBe('succeeded'))
    expect(getBatchPublishJob('batch-ok')).toMatchObject({ result: { success: 3 }, error: null })
    expect(getBatchPublishJob('batch-ok')?.finishedAt).toBeTruthy()
  })

  it('stores the error of a failed publication', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    startBatchPublishJob('batch-fail', async () => { throw new Error('Публикация остановлена пользователем') })
    await vi.waitFor(() => expect(getBatchPublishJob('batch-fail')?.status).toBe('failed'))
    expect(getBatchPublishJob('batch-fail')?.error).toBe('Публикация остановлена пользователем')
  })

  it('starts a new job after the previous one finished', async () => {
    const first = startBatchPublishJob('batch-repeat', async () => 1).job
    await vi.waitFor(() => expect(getBatchPublishJob('batch-repeat')?.status).toBe('succeeded'))
    const next = startBatchPublishJob('batch-repeat', async () => 2)
    expect(next.alreadyRunning).toBe(false)
    expect(next.job.id).not.toBe(first.id)
  })
})

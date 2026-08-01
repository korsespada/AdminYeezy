import { describe, expect, it } from 'vitest'
import { parseBatchPublishProgress } from '@/lib/batch-publish-progress'

describe('parseBatchPublishProgress', () => {
  const now = new Date('2026-08-01T13:12:00Z').getTime()

  it('parses a live publication operation', () => {
    expect(parseBatchPublishProgress('publish|media|120|607', '2026-08-01T13:10:37Z', now)).toMatchObject({
      running: true,
      stale: false,
      cancelling: false,
      phase: 'media',
      current: 120,
      total: 607,
    })
  })

  it('marks an abandoned publication as stale', () => {
    expect(parseBatchPublishProgress('publish|media|245|607', '2026-08-01T13:00:00Z', now)).toMatchObject({
      running: false,
      stale: true,
      current: 245,
    })
  })

  it('keeps a cancellation request visible', () => {
    expect(parseBatchPublishProgress('cancel_requested|publish|publish|25|100', '2026-08-01T13:11:59Z', now)).toMatchObject({
      running: true,
      cancelling: true,
      phase: 'publish',
      current: 25,
      total: 100,
    })
  })
})

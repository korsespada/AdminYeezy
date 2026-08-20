import { describe, expect, it } from 'vitest'

import { batchPublishSyncDecision } from '@/lib/batch-publish-sync'

describe('batch publish synchronization', () => {
  it('uses the persisted batch for a clean current version', () => {
    expect(batchPublishSyncDecision({ isSnapshotSource: false, isDirty: false }))
      .toBe('database')
  })

  it('waits for an unsaved current-version edit instead of sending the whole batch', () => {
    expect(batchPublishSyncDecision({ isSnapshotSource: false, isDirty: true }))
      .toBe('wait_for_save')
  })

  it('keeps historical snapshots on their dedicated publish path', () => {
    expect(batchPublishSyncDecision({ isSnapshotSource: true, isDirty: false }))
      .toBe('snapshot')
  })
})

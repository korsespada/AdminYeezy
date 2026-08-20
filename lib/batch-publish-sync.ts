export type BatchPublishSyncDecision = 'database' | 'wait_for_save' | 'snapshot'

export function batchPublishSyncDecision(input: {
  isSnapshotSource: boolean
  isDirty: boolean
}): BatchPublishSyncDecision {
  if (input.isSnapshotSource) return 'snapshot'
  if (input.isDirty) return 'wait_for_save'
  return 'database'
}

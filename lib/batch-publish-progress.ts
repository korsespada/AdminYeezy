export const BATCH_PUBLISH_STALE_MS = 5 * 60 * 1000

export type BatchPublishPhase = 'lookup' | 'media' | 'publish'

export type BatchPublishProgress = {
  running: boolean
  cancelling: boolean
  stale: boolean
  phase: BatchPublishPhase | null
  current: number
  total: number
  updatedAt: string | null
}

function validPhase(value: string | undefined): BatchPublishPhase {
  return value === 'lookup' || value === 'media' || value === 'publish' ? value : 'publish'
}

export function parseBatchPublishProgress(
  operationValue: unknown,
  updatedAtValue: unknown,
  now = Date.now(),
): BatchPublishProgress {
  const operation = String(operationValue || '')
  const cancelling = operation.startsWith('cancel_requested|')
  const publishOperation = cancelling ? operation.slice('cancel_requested|'.length) : operation
  if (!publishOperation.startsWith('publish')) {
    return { running: false, cancelling: false, stale: false, phase: null, current: 0, total: 0, updatedAt: null }
  }

  const [, rawPhase, rawCurrent, rawTotal] = publishOperation.split('|')
  const updatedDate = updatedAtValue ? new Date(String(updatedAtValue)) : null
  const updatedAt = updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toISOString() : null
  const stale = !updatedDate || now - updatedDate.getTime() > BATCH_PUBLISH_STALE_MS

  return {
    running: !stale,
    cancelling,
    stale,
    phase: validPhase(rawPhase),
    current: Math.max(0, Number(rawCurrent) || 0),
    total: Math.max(0, Number(rawTotal) || 0),
    updatedAt,
  }
}

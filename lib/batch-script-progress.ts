export const BATCH_SCRIPT_STALE_MS = 6 * 60 * 60 * 1000

export type BatchScriptPhase = 'prepare' | 'visual' | 'saving' | null

export type BatchScriptProgress = {
  running: boolean
  stale: boolean
  completed: boolean
  failed: boolean
  phase: BatchScriptPhase
  current: number
  total: number
  updatedAt: string | null
  error: string | null
}

function validPhase(value: string | undefined): BatchScriptPhase {
  return value === 'prepare' || value === 'visual' || value === 'saving' ? value : null
}

export function parseBatchScriptProgress(
  operationValue: unknown,
  updatedAtValue: unknown,
  taskStatusValue: unknown,
  errorValue: unknown,
  now = Date.now(),
): BatchScriptProgress {
  const operation = String(operationValue || '')
  const taskStatus = String(taskStatusValue || '')
  const updatedDate = updatedAtValue ? new Date(String(updatedAtValue)) : null
  const updatedAt = updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.toISOString() : null
  const isScript = operation === 'script' || operation.startsWith('script|')
  const stale = isScript && (!updatedDate || now - updatedDate.getTime() > BATCH_SCRIPT_STALE_MS)
  const [, rawPhase, rawCurrent, rawTotal] = operation.split('|')

  return {
    running: isScript && !stale,
    stale,
    completed: taskStatus === 'Обработано скриптом',
    failed: taskStatus === 'Ошибка пост-обработки',
    phase: isScript ? validPhase(rawPhase) : null,
    current: Math.max(0, Number(rawCurrent) || 0),
    total: Math.max(0, Number(rawTotal) || 0),
    updatedAt,
    error: errorValue ? String(errorValue) : null,
  }
}

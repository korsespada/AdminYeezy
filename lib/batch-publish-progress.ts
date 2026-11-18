export const BATCH_PUBLISH_STALE_MS = 5 * 60 * 1000

export type BatchPublishPhase = 'lookup' | 'media' | 'publish'

export type BatchPublishProgress = {
  running: boolean
  cancelling: boolean
  stale: boolean
  phase: BatchPublishPhase | null
  current: number
  total: number
  // Фото считаются только на этапе переноса медиа: «осталось 1 240 из 3 000 фото».
  photoCurrent: number
  photoTotal: number
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
    return { running: false, cancelling: false, stale: false, phase: null, current: 0, total: 0, photoCurrent: 0, photoTotal: 0, updatedAt: null }
  }

  const [, rawPhase, rawCurrent, rawTotal, rawPhotoCurrent, rawPhotoTotal] = publishOperation.split('|')
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
    photoCurrent: Math.max(0, Number(rawPhotoCurrent) || 0),
    photoTotal: Math.max(0, Number(rawPhotoTotal) || 0),
    updatedAt,
  }
}

const fmt = (value: number) => value.toLocaleString('ru-RU')

/**
 * Подпись хода публикации: на проверке — сколько сверено, дальше — сколько
 * осталось. «проверка 120/5 118», «фото: осталось 1 240 из 3 000»,
 * «осталось 12 из 40 тов.».
 */
export function publishProgressText(input: {
  phase?: string | null
  current?: number | null
  total?: number | null
  photoCurrent?: number | null
  photoTotal?: number | null
}) {
  const total = Math.max(0, Number(input.total) || 0)
  const current = Math.min(total, Math.max(0, Number(input.current) || 0))
  const photoTotal = Math.max(0, Number(input.photoTotal) || 0)
  const photoCurrent = Math.min(photoTotal, Math.max(0, Number(input.photoCurrent) || 0))
  if (input.phase === 'lookup') return total ? `проверка ${fmt(current)}/${fmt(total)}` : 'проверка'
  if (input.phase === 'media') {
    if (photoTotal) return `фото: осталось ${fmt(photoTotal - photoCurrent)} из ${fmt(photoTotal)}`
    return total ? `фото: осталось ${fmt(total - current)} из ${fmt(total)} тов.` : 'фото'
  }
  return total ? `осталось ${fmt(total - current)} из ${fmt(total)} тов.` : ''
}

/** Доля готового для полосы прогресса: на переносе медиа — по фото. */
export function publishProgressRatio(input: {
  phase?: string | null
  current?: number | null
  total?: number | null
  photoCurrent?: number | null
  photoTotal?: number | null
}) {
  const photoTotal = Math.max(0, Number(input.photoTotal) || 0)
  if (input.phase === 'media' && photoTotal > 0) {
    return Math.min(1, Math.max(0, Number(input.photoCurrent) || 0) / photoTotal)
  }
  const total = Math.max(0, Number(input.total) || 0)
  return total > 0 ? Math.min(1, Math.max(0, Number(input.current) || 0) / total) : 0
}

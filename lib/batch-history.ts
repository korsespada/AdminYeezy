export function shouldOpenBatchArtifactAsFile(resultPath?: string | null, snapshotId?: string | null) {
  return Boolean(resultPath && !resultPath.startsWith('db://') && !snapshotId)
}

export function currentBatchHistoryStatus(stage?: string | null) {
  return ({
    SCRAPED: 'Сырой товар',
    SCRIPT_PROCESSED: 'Обработан скриптом',
    AI_PROCESSED: 'Обработано ИИ',
    PUSHED: 'Обработано ИИ',
  } as Record<string, string>)[String(stage || '')] || ''
}

export function effectiveBatchHistoryStage(stage?: string | null, allAiProcessed = false) {
  if (stage === 'PUSHED' || stage === 'DELETED_FROM_DB') return stage
  return allAiProcessed ? 'AI_PROCESSED' : stage || null
}

// Early published batches predate batch_publications, so their registry count
// is zero even though the server can safely recover their external_id values.
export function canDeletePublishedCatalog(stage?: string | null, publishedExternalCount = 0, catalogDeletedAt?: string | null) {
  return !catalogDeletedAt && (stage === 'PUSHED' || publishedExternalCount > 0)
}

export function protectedCatalogExternalIds(
  candidateIds: Iterable<string>,
  replacementBatchIds: Iterable<string> | null,
  fallbackSharedIds: Iterable<string>,
) {
  const normalize = (value: string) => String(value || '').trim()
  const candidates = new Set([...candidateIds].map(normalize).filter(Boolean))
  const protectedIds = new Set(
    [...(replacementBatchIds || fallbackSharedIds)].map(normalize).filter(Boolean),
  )

  return new Set([...candidates].filter((externalId) => protectedIds.has(externalId)))
}

const PUBLISH_PHASE_LABELS: Record<string, string> = { lookup: 'проверка', media: 'фото' }

/**
 * Счётчик рядом со статусом в списке выгрузок: «Обработка ИИ (12/1036)»,
 * «Публикация в БД (фото 120/500)». Для ИИ считаются готовые и ошибочные
 * товары текущего запуска; для публикации — прогресс из блокировки операции
 * `publish|<этап>|<текущий>|<всего>`.
 */
export function batchStatusProgress(input: {
  publishing?: boolean
  aiRunning?: boolean
  activeOperation?: string | null
  aiCompletedCount?: number | null
  aiFailedCount?: number | null
  aiTotalCount?: number | null
}) {
  if (input.publishing) {
    const operation = String(input.activeOperation || '').replace(/^cancel_requested\|/, '')
    const [kind, phase, rawCurrent, rawTotal] = operation.split('|')
    const total = Math.max(0, Number(rawTotal) || 0)
    if (kind !== 'publish' || !total) return ''
    const current = Math.min(total, Math.max(0, Number(rawCurrent) || 0))
    const label = PUBLISH_PHASE_LABELS[phase || '']
    return `${label ? `${label} ` : ''}${current}/${total}`
  }
  if (input.aiRunning) {
    const total = Math.max(0, Number(input.aiTotalCount) || 0)
    if (!total) return ''
    const done = Math.max(0, Number(input.aiCompletedCount) || 0) + Math.max(0, Number(input.aiFailedCount) || 0)
    return `${Math.min(done, total)}/${total}`
  }
  return ''
}

/**
 * Подпись под поставщиком без повтора его имени: выгрузка называется
 * «<Поставщик> - <дата>», а поставщик уже показан строкой выше.
 */
export function batchSubtitle(batchName?: string | null, supplierName?: string | null) {
  const name = String(batchName || '').trim()
  const supplier = String(supplierName || '').trim()
  if (!supplier) return name
  if (name.toLowerCase() === supplier.toLowerCase()) return ''
  if (name.toLowerCase().startsWith(supplier.toLowerCase())) {
    const rest = name.slice(supplier.length)
    if (/^\s*[-–—:·|]\s*/.test(rest)) return rest.replace(/^\s*[-–—:·|]\s*/, '').trim()
  }
  return name
}

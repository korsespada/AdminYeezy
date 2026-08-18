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

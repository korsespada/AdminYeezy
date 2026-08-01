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

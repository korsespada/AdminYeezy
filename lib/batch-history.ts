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

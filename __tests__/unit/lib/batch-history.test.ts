import { describe, expect, it } from 'vitest'
import {
  canDeletePublishedCatalog,
  currentBatchHistoryStatus,
  effectiveBatchHistoryStage,
  shouldOpenBatchArtifactAsFile,
} from '@/lib/batch-history'

describe('batch history navigation', () => {
  it('opens JSONB batch artifacts as editable batches instead of local files', () => {
    expect(shouldOpenBatchArtifactAsFile('db://batch/abc/script', null)).toBe(false)
    expect(shouldOpenBatchArtifactAsFile('C:/tmp/task.csv', null)).toBe(true)
    expect(shouldOpenBatchArtifactAsFile('C:/tmp/task.csv', 'snapshot-id')).toBe(false)
  })

  it('maps the current workflow stage to its editable history row', () => {
    expect(currentBatchHistoryStatus('SCRAPED')).toBe('Сырой товар')
    expect(currentBatchHistoryStatus('SCRIPT_PROCESSED')).toBe('Обработан скриптом')
    expect(currentBatchHistoryStatus('AI_PROCESSED')).toBe('Обработано ИИ')
    expect(currentBatchHistoryStatus('PUSHED')).toBe('Обработано ИИ')
  })

  it('keeps terminal batch stages when every product was processed by AI', () => {
    expect(effectiveBatchHistoryStage('PUSHED', true)).toBe('PUSHED')
    expect(effectiveBatchHistoryStage('DELETED_FROM_DB', true)).toBe('DELETED_FROM_DB')
    expect(effectiveBatchHistoryStage('SCRIPT_PROCESSED', true)).toBe('AI_PROCESSED')
  })

  it('offers catalog removal for legacy published batches without a publication registry', () => {
    expect(canDeletePublishedCatalog('PUSHED', 0)).toBe(true)
    expect(canDeletePublishedCatalog('AI_PROCESSED', 3)).toBe(true)
    expect(canDeletePublishedCatalog('AI_PROCESSED', 0)).toBe(false)
    expect(canDeletePublishedCatalog('DELETED_FROM_DB', 0)).toBe(false)
  })
})

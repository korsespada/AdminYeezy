import { describe, expect, it } from 'vitest'
import {
  canDeletePublishedCatalog,
  currentBatchHistoryStatus,
  effectiveBatchHistoryStage,
  protectedCatalogExternalIds,
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
    expect(canDeletePublishedCatalog('PUSHED', 0, '2026-08-18T12:00:00Z')).toBe(false)
    expect(canDeletePublishedCatalog('AI_PROCESSED', 3)).toBe(true)
    expect(canDeletePublishedCatalog('AI_PROCESSED', 0)).toBe(false)
    expect(canDeletePublishedCatalog('DELETED_FROM_DB', 0)).toBe(false)
  })

  it('protects only the newest replacement batch when removing a legacy export', () => {
    expect([...protectedCatalogExternalIds(
      ['old-only', 'kept-by-new', 'also-in-older-history'],
      ['kept-by-new'],
      ['kept-by-new', 'also-in-older-history'],
    )]).toEqual(['kept-by-new'])
  })

  it('keeps the conservative shared-id fallback when no newer replacement exists', () => {
    expect([...protectedCatalogExternalIds(
      ['old-only', 'shared'],
      null,
      ['shared'],
    )]).toEqual(['shared'])
  })
})

describe('batchStatusProgress', () => {
  it('shows done/total for a running AI run', async () => {
    const { batchStatusProgress } = await import('@/lib/batch-history')
    expect(batchStatusProgress({ aiRunning: true, aiCompletedCount: 10, aiFailedCount: 2, aiTotalCount: 1036 })).toBe('12/1036')
    expect(batchStatusProgress({ aiRunning: true, aiCompletedCount: 0, aiFailedCount: 0, aiTotalCount: 0 })).toBe('')
  })

  it('shows publish phase progress from the operation lock', async () => {
    const { batchStatusProgress } = await import('@/lib/batch-history')
    expect(batchStatusProgress({ publishing: true, activeOperation: 'publish|media|120|500' })).toBe('фото 120/500')
    expect(batchStatusProgress({ publishing: true, activeOperation: 'publish|publish|50|500' })).toBe('50/500')
    expect(batchStatusProgress({ publishing: true, activeOperation: 'cancel_requested|publish|lookup|5|40' })).toBe('проверка 5/40')
    expect(batchStatusProgress({ publishing: true, activeOperation: 'publish' })).toBe('')
  })

  it('shows nothing when no operation runs', async () => {
    const { batchStatusProgress } = await import('@/lib/batch-history')
    expect(batchStatusProgress({ aiCompletedCount: 5, aiTotalCount: 10 })).toBe('')
  })
})

describe('batchSubtitle', () => {
  it('drops the supplier name from the batch name', async () => {
    const { batchSubtitle } = await import('@/lib/batch-history')
    expect(batchSubtitle('Пуховики - 09.11.2026, 09:54:01', 'Пуховики')).toBe('09.11.2026, 09:54:01')
    expect(batchSubtitle('Пуховики', 'Пуховики')).toBe('')
    expect(batchSubtitle('Пуховики зима', 'Пуховики')).toBe('Пуховики зима')
    expect(batchSubtitle('Другое имя', 'Пуховики')).toBe('Другое имя')
    expect(batchSubtitle('Выгрузка', null)).toBe('Выгрузка')
  })
})

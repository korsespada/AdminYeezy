import { describe, expect, it } from 'vitest'
import { parseBatchScriptProgress } from '@/lib/batch-script-progress'

describe('batch script progress', () => {
  it('parses a live visual post-process operation', () => {
    const now = Date.parse('2026-09-01T10:00:00.000Z')
    const result = parseBatchScriptProgress(
      'script|visual|0|1',
      '2026-09-01T09:59:00.000Z',
      'Пост-обработка скриптом',
      null,
      now,
    )

    expect(result).toMatchObject({ running: true, stale: false, phase: 'visual', current: 0, total: 1 })
  })

  it('reports the persisted failed task after the lock is released', () => {
    const result = parseBatchScriptProgress(
      null,
      null,
      'Ошибка пост-обработки',
      'download failed',
    )

    expect(result).toMatchObject({ running: false, failed: true, error: 'download failed' })
  })
})

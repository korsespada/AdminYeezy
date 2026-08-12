import { describe, expect, it } from 'vitest'
import { normalizeMeasurementTable } from '@/lib/measurement-templates'

describe('measurement template normalization', () => {
  it('keeps the exact cell measurement separate from a tolerance note', () => {
    const table = normalizeMeasurementTable({
      unit: 'см',
      columns: [{ key: 'chest', label: 'Обхват груди' }],
      rows: [{ size: 'M', values: { chest: '86' } }],
      note: 'Допуск ручного измерения: 1–2 см',
    })

    expect(table).toEqual({
      unit: 'см',
      columns: [{ key: 'chest', label: 'Обхват груди' }],
      rows: [{ size: 'M', values: { chest: '86' } }],
      note: 'Допуск ручного измерения: 1–2 см',
    })
  })
})

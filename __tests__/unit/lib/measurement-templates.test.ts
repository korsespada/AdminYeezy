import { describe, expect, it } from 'vitest'
import {
  measurementTemplateForProduct,
  measurementTemplateGarmentForProduct,
  normalizeMeasurementTable,
  type MeasurementTemplate,
} from '@/lib/measurement-templates'

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

  it('matches a single supplier template only to an unambiguous garment type', () => {
    const templates: MeasurementTemplate[] = [
      {
        id: 1, supplierId: 7, name: 'Штаны', garmentType: 'pants',
        measurements: { unit: 'см', columns: [{ key: 'length', label: 'Длина' }], rows: [{ size: 'S', values: { length: '98.5' } }] },
        sourceImageUrl: null, notes: '',
      },
      {
        id: 2, supplierId: 7, name: 'Шорты', garmentType: 'shorts',
        measurements: { unit: 'см', columns: [{ key: 'length', label: 'Длина' }], rows: [{ size: 'S', values: { length: '44' } }] },
        sourceImageUrl: null, notes: '',
      },
    ]

    expect(measurementTemplateGarmentForProduct({ name: 'Спортивные штаны' })).toBe('pants')
    expect(measurementTemplateForProduct(templates, { name: 'Спортивные штаны' })?.id).toBe(1)
    expect(measurementTemplateForProduct(templates, { name: 'Комплект: брюки и шорты' })).toBeNull()
  })
})

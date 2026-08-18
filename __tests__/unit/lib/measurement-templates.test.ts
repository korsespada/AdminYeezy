import { describe, expect, it } from 'vitest'
import {
  measurementTemplateForProduct,
  measurementTemplateGarmentForProduct,
  applyMeasurementTableAttributes,
  measurementTables,
  measurementTableSizes,
  normalizeProductMeasurements,
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

  it('parses JSON strings and canonicalizes AI measurement aliases', () => {
    const encoded = JSON.stringify({
      unit: 'см',
      columns: [
        { key: 'shoulder_width', label: 'Плечи' },
        { key: 'chest_girth', label: 'Обхват груди' },
        { key: 'sleeve_length', label: 'Длина рукава' },
        { key: 'back_length', label: 'Длина' },
      ],
      rows: [{ size: '38', values: {
        shoulder_width: '40', chest_girth: '88', sleeve_length: '23', back_length: '53',
      } }],
    })

    const expected = {
      unit: 'см',
      columns: [
        { key: 'shoulders', label: 'Плечи' },
        { key: 'chest', label: 'Обхват груди' },
        { key: 'sleeve', label: 'Длина рукава' },
        { key: 'length', label: 'Длина' },
      ],
      rows: [{ size: '38', values: { shoulders: '40', chest: '88', sleeve: '23', length: '53' } }],
    }

    expect(normalizeMeasurementTable(encoded)).toEqual(expected)
    expect(applyMeasurementTableAttributes({}, encoded).measurements).toEqual(expected)
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

  it('copies template row sizes to the variant sizes attribute', () => {
    const table = { unit: 'см', columns: [{ key: 'length', label: 'Длина' }], rows: [
      { size: 'S', values: { length: '51.5' } },
      { size: 'M', values: { length: '53' } },
      { size: 'L', values: { length: '54.5' } },
      { size: 'XL', values: { length: '56' } },
    ] }
    expect(measurementTableSizes(table)).toEqual(['S', 'M', 'L', 'XL'])
    expect(applyMeasurementTableAttributes({ colors: ['Чёрный'] }, table)).toMatchObject({
      colors: ['Чёрный'], sizes: ['S', 'M', 'L', 'XL'], size_system: 'International', measurements: table,
    })
  })

  it('keeps multiple named garment tables separate and collapses a single tab back to the legacy shape', () => {
    const vest = {
      unit: 'см',
      columns: [{ key: 'chest', label: 'Обхват груди' }],
      rows: [{ size: 'S', values: { chest: '84' } }],
    }
    const jumper = {
      unit: 'см',
      columns: [{ key: 'length', label: 'Длина' }],
      rows: [{ size: 'S', values: { length: '54' } }],
    }

    expect(normalizeProductMeasurements({
      tabs: [
        { label: 'Майка', ...vest },
        { label: 'Джемпер', ...jumper },
      ],
    })).toEqual({
      tabs: [
        { label: 'Майка', ...vest },
        { label: 'Джемпер', ...jumper },
      ],
    })
    expect(measurementTables({
      tabs: [
        { label: 'Майка', ...vest },
        { label: 'Джемпер', ...jumper },
      ],
    })).toEqual([
      { label: 'Майка', ...vest },
      { label: 'Джемпер', ...jumper },
    ])
    expect(normalizeProductMeasurements({ tabs: [{ label: 'Майка', ...vest }] })).toEqual(vest)
  })
})

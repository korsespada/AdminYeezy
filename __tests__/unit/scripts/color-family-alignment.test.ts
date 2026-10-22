import { describe, expect, it } from 'vitest'

const {
  alignColorFamily,
  batchColorFamilyIssues,
  colorFamilyIssues,
} = require('../../../scripts/lib/color-family-alignment')

const table = (chest: string) => ({
  unit: 'см',
  columns: [{ key: 'chest', label: 'Обхват груди' }],
  rows: [{ size: '48', values: { chest } }, { size: '50', values: { chest: '108' } }],
  note: '',
})

function member(id: number, colour: string, overrides: Record<string, any> = {}) {
  const { attributes, ...rest } = overrides
  return {
    id,
    external_id: `ext-${id}`,
    source_position: id,
    brand: 'brand-a',
    category: 'clothes',
    subcategory: 'jackets',
    gender: 'male',
    price: 30000,
    price_source: 'rule',
    variant_group_key: 'family-1',
    variant_group_name: 'Пуховик',
    attributes: { colors: [colour], album_colour_index: id, ...attributes },
    ...rest,
  }
}

function updateFor(result: any, id: number) {
  return result.updates.find((update: any) => update.id === id)
}

describe('alignColorFamily', () => {
  it('copies classification from the majority and the anchor on a tie', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный'),
      member(2, 'Бежевый', { subcategory: 'coats' }),
      member(3, 'Зелёный'),
    ])

    expect(result.issues).toEqual([])
    expect(updateFor(result, 2).fields).toEqual({ category: 'clothes', subcategory: 'jackets' })
    expect(updateFor(result, 1)).toBeUndefined()

    const tie = alignColorFamily([member(2, 'Бежевый', { brand: 'brand-b' }), member(1, 'Чёрный')])
    expect(updateFor(tie, 2).fields).toEqual({ brand: 'brand-a' })
  })

  it('makes the price equal and prefers a manual price', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный', { price: 0, price_source: 'unpriced' }),
      member(2, 'Бежевый', { price: 41000, price_source: 'manual' }),
      member(3, 'Зелёный'),
    ])

    expect(updateFor(result, 1).fields).toEqual({ price: 41000, price_source: 'manual' })
    expect(updateFor(result, 3).fields).toEqual({ price: 41000, price_source: 'manual' })
  })

  it('reports two different manual prices instead of choosing one', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный', { price: 41000, price_source: 'manual' }),
      member(2, 'Бежевый', { price: 45000, price_source: 'manual' }),
    ])

    expect(result.issues.map((entry: any) => entry.field)).toEqual(['price'])
    expect(result.updates).toEqual([])
  })

  it('spreads a size chart found on one colour to the others', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный'),
      member(2, 'Бежевый', {
        attributes: {
          sizes: ['48', '50'],
          measurements: table('104'),
          size_recommendation: { columns: [], rows: [{ values: { height: '180' } }] },
        },
      }),
    ])

    expect(result.issues).toEqual([])
    expect(updateFor(result, 1).attributes).toMatchObject({
      colors: ['Чёрный'],
      sizes: ['48', '50'],
      measurements: table('104'),
      size_recommendation: { rows: [{ values: { height: '180' } }] },
    })
    expect(updateFor(result, 2)).toBeUndefined()
  })

  it('treats differing readings of one chart album as the same chart', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный', { attributes: { size_chart_source_id: 'chart-1', sizes: ['48', '50'], measurements: table('104') } }),
      member(2, 'Бежевый', { attributes: { size_chart_source_id: 'chart-1', sizes: ['48', '50'], measurements: table('105') } }),
    ])

    expect(result.issues).toEqual([])
    expect(updateFor(result, 2).attributes.measurements).toEqual(table('104'))
  })

  it('blocks two different size charts', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный', { attributes: { measurements: table('104') } }),
      member(2, 'Бежевый', { attributes: { measurements: table('120') } }),
    ])

    expect(result.issues.map((entry: any) => entry.field)).toEqual(['measurements'])
    expect(updateFor(result, 2)).toBeUndefined()
  })

  it('fills missing physical values but reports a real difference', () => {
    const filled = alignColorFamily([
      member(1, 'Чёрный', { attributes: { hardware_color: 'Золотой' } }),
      member(2, 'Бежевый'),
    ])
    expect(updateFor(filled, 2).attributes.hardware_color).toBe('Золотой')

    const conflict = alignColorFamily([
      member(1, 'Чёрный', { attributes: { hardware_color: 'Золотой' } }),
      member(2, 'Бежевый', { attributes: { hardware_color: 'Серебристый' } }),
    ])
    expect(conflict.issues.map((entry: any) => entry.field)).toEqual(['hardware_color'])
  })

  it('reports a repeated or missing colour', () => {
    const result = alignColorFamily([member(1, 'Чёрный'), member(2, 'чёрный'), member(3, '')])

    expect(result.issues.map((entry: any) => entry.message)).toEqual([
      'не указан цвет (ext-3)',
      'одинаковый цвет «Чёрный» (ext-1, ext-2)',
    ])
  })
})

describe('colorFamilyIssues', () => {
  it('rejects a family with different subcategories or prices', () => {
    const issues = colorFamilyIssues([
      member(1, 'Чёрный'),
      member(2, 'Бежевый', { subcategory: 'coats', price: 35000 }),
    ])

    expect(issues.map((entry: any) => entry.field)).toEqual(['category', 'price'])
    expect(issues[0].message).toBe('категория и подкатегория различается (ext-1 / ext-2)')
  })

  it('requires the size chart and size range on every colour unless sizing is skipped', () => {
    const family = [
      member(1, 'Чёрный', { attributes: { sizes: ['48', '50'], measurements: table('104') } }),
      member(2, 'Бежевый'),
    ]

    expect(colorFamilyIssues(family).map((entry: any) => entry.field)).toEqual(['measurements', 'sizes'])
    expect(colorFamilyIssues(family, { sizing: false })).toEqual([])
  })

  it('accepts an aligned family', () => {
    const family = [member(1, 'Чёрный'), member(2, 'Бежевый'), member(3, 'Зелёный')]
    const aligned = alignColorFamily(family)

    expect(aligned.updates).toEqual([])
    expect(colorFamilyIssues(family)).toEqual([])
  })
})

describe('batchColorFamilyIssues', () => {
  it('checks only families with two or more products and labels them by name', () => {
    const issues = batchColorFamilyIssues([
      member(1, 'Чёрный'),
      member(2, 'Бежевый', { brand: 'brand-b' }),
      member(3, 'Чёрный', { variant_group_key: 'single', brand: 'brand-c' }),
      member(4, 'Чёрный', { variant_group_key: null }),
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ family: 'Пуховик', field: 'brand' })
  })
})

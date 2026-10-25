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

  it('compares size charts by content, not by column order or empty rows', () => {
    const reordered = {
      unit: 'см',
      columns: [{ key: 'length', label: 'Длина' }, { key: 'chest', label: 'Грудь' }],
      rows: [{ size: '50', values: { length: '70', chest: '108' } }, { size: '48', values: { chest: '104', length: '68' } }],
    }
    const original = {
      unit: 'см',
      columns: [{ key: 'chest', label: 'Обхват груди' }, { key: 'length', label: 'Длина' }],
      rows: [{ size: '48', values: { chest: '104', length: '68' } }, { size: '50', values: { chest: '108', length: '70' } }],
    }
    const empty = { unit: 'см', columns: [], rows: [{ size: '48', values: {} }] }
    const family = [
      member(1, 'Чёрный', { attributes: { sizes: ['48', '50'], measurements: original } }),
      member(2, 'Бежевый', { attributes: { sizes: ['48', '50'], measurements: reordered } }),
      member(3, 'Зелёный', { attributes: { measurements: empty } }),
    ]
    const result = alignColorFamily(family)

    expect(result.issues).toEqual([])
    expect(updateFor(result, 2)).toBeUndefined()
    expect(updateFor(result, 3).attributes).toMatchObject({ sizes: ['48', '50'], measurements: original })
    expect(colorFamilyIssues(family.slice(0, 2))).toEqual([])
  })

  it('treats one shoe chart written with other column names, number format or an extra size as the same chart', () => {
    const shoe = (key: string, sizes: string[], format = (value: number) => value.toFixed(1)) => ({
      unit: 'см',
      columns: [{ key, label: 'Длина стельки' }],
      rows: sizes.map((size, index) => ({ size, values: { [key]: format(26.5 + index * 0.5) } })),
    })
    const base = ['39', '40', '41', '42', '43', '44', '45']
    const family = [
      member(1, 'Коричневый'),
      member(2, 'Серый', { attributes: { sizes: base, measurements: shoe('insole_length', base) } }),
      member(3, 'Чёрный', { attributes: { sizes: [...base, '46'], measurements: shoe('insole_length', [...base, '46']) } }),
      member(4, 'Синий', { attributes: { sizes: base, measurements: shoe('insole', base, String) } }),
      member(5, 'Белый', { attributes: { sizes: base, measurements: shoe('insole_length', base) } }),
    ]
    const result = alignColorFamily(family)

    expect(result.issues).toEqual([])
    expect(updateFor(result, 1).attributes).toMatchObject({ sizes: base, measurements: shoe('insole_length', base) })
    expect(updateFor(result, 3).attributes.sizes).toEqual(base)
    expect(updateFor(result, 4).attributes.measurements).toEqual(shoe('insole_length', base))
  })

  it('prefers centimetres over the same chart read in millimetres and matches M(48) with M', () => {
    const insole = (values: number[]) => ({
      unit: 'см',
      columns: [{ key: 'insole_length', label: 'Длина стельки' }],
      rows: values.map((value, index) => ({ size: String(39 + index), values: { insole_length: String(value) } })),
    })
    const shoes = alignColorFamily([
      member(1, 'Коричневый', { attributes: { measurements: insole([273, 278, 283]) } }),
      member(2, 'Чёрный', { attributes: { measurements: insole([27.3, 27.8, 28.3]) } }),
    ])
    expect(shoes.issues).toEqual([])
    expect(updateFor(shoes, 1).attributes.measurements).toEqual(insole([27.3, 27.8, 28.3]))

    const knit = (labels: string[]) => ({
      unit: 'см',
      columns: [{ key: 'chest', label: 'Грудь' }],
      rows: labels.map((size, index) => ({ size, values: { chest: String(49 + index * 2) } })),
    })
    const clothes = alignColorFamily([
      member(1, 'Синий', { attributes: { measurements: knit(['M', 'L', 'XL', 'XXL', 'XXXL']) } }),
      member(2, 'Белый', { attributes: { measurements: knit(['M(48)', 'L(50)', 'XL(52)', '2XL(54)', '3XL(56)']) } }),
      member(3, 'Серый', { attributes: { measurements: knit(['M', 'L', 'XL', 'XXL', 'XXXL']) } }),
    ])
    expect(clothes.issues).toEqual([])
  })

  it('treats a chart with a missing column as the same chart and keeps the fuller one', () => {
    const full = {
      unit: 'см',
      columns: [],
      rows: ['S', 'M', 'L'].map((size, index) => ({ size, values: { hips: String(78 + index * 4), length: String(27 + index), waist: String(64 + index * 4) } })),
    }
    const partial = {
      unit: 'см',
      columns: [],
      rows: ['S', 'M', 'L'].map((size, index) => ({ size, values: { length: String(27 + index), waist: String(64 + index * 4) } })),
    }
    const result = alignColorFamily([
      member(1, 'Белый', { attributes: { measurements: partial } }),
      member(2, 'Чёрный', { attributes: { measurements: full } }),
    ])

    expect(result.issues).toEqual([])
    expect(updateFor(result, 1).attributes.measurements).toEqual(full)
  })

  it('keeps each colour its own chart when the charts come from different photos', () => {
    const family = [
      member(1, 'Зелёный', { attributes: { sizes: ['M', 'L'], measurements: table('112'), size_chart_photo_urls: ['https://x/a.jpg'] } }),
      member(2, 'Коричневый', { attributes: { sizes: ['S', 'M', 'L'], measurements: table('130'), size_chart_photo_urls: ['https://x/b.jpg'] } }),
    ]

    expect(alignColorFamily(family)).toEqual({ updates: [], issues: [] })
    expect(colorFamilyIssues(family)).toEqual([])
    const samePhoto = family.map((entry) => ({ ...entry, attributes: { ...entry.attributes, size_chart_photo_urls: ['https://x/a.jpg'] } }))
    expect(alignColorFamily(samePhoto).issues.map((entry: any) => entry.field)).toEqual(['measurements'])
  })

  it('blocks two different size charts on a tie', () => {
    const result = alignColorFamily([
      member(1, 'Чёрный', { attributes: { measurements: table('104') } }),
      member(2, 'Бежевый', { attributes: { measurements: table('120') } }),
    ])

    expect(result.issues.map((entry: any) => entry.field)).toEqual(['measurements'])
    expect(updateFor(result, 2)).toBeUndefined()
  })

  it('takes the majority chart when one colour has a different one', () => {
    const family = [
      member(1, 'Светло-серый'),
      member(2, 'Чёрный', { attributes: { measurements: table('104') } }),
      member(3, 'Бежевый', { attributes: { measurements: table('120') } }),
      member(4, 'Синий', { attributes: { measurements: table('104') } }),
    ]
    const result = alignColorFamily(family)

    expect(result.issues).toEqual([])
    expect(updateFor(result, 1).attributes.measurements).toEqual(table('104'))
    expect(updateFor(result, 3).attributes.measurements).toEqual(table('104'))
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

  it('reports a missing colour and a repeated name, but not a repeated base colour', () => {
    const result = alignColorFamily([
      member(1, 'Серый', { name: 'Тёмно-серый пуховик' }),
      member(2, 'Серый', { name: 'Светло-серый пуховик' }),
      member(3, 'Синий', { name: 'Синий пуховик' }),
      member(4, 'Синий', { name: 'синий  пуховик' }),
      member(5, '', { name: 'Пуховик' }),
    ])

    expect(result.issues.map((entry: any) => entry.message)).toEqual([
      'не указан цвет (ext-5)',
      'одинаковое название «Синий пуховик» (ext-3, ext-4)',
    ])
  })

  it('takes the majority reading when one colour misread a few cells of the same chart', () => {
    const chart = () => ({
      unit: 'см',
      columns: ['chest', 'length', 'shoulders', 'sleeve'].map((key) => ({ key, label: key })),
      rows: ['48', '50', '52', '54', '56'].map((size, index) => ({
        size,
        values: { chest: String(110 + index * 4), length: String(67 + index), shoulders: String(48 + index), sleeve: String(63 + index) },
      })),
    })
    const misread = chart()
    misread.rows[4].values.sleeve = '68.5'
    const family = [
      member(1, 'Чёрный', { attributes: { measurements: chart() } }),
      member(2, 'Бежевый', { attributes: { measurements: misread } }),
      member(3, 'Зелёный', { attributes: { measurements: chart() } }),
    ]
    const result = alignColorFamily(family)

    expect(result.issues).toEqual([])
    expect(updateFor(result, 2).attributes.measurements).toEqual(chart())
    expect(colorFamilyIssues(family)).toEqual([])
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

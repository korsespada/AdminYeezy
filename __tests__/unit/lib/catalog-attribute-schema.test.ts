import { describe, expect, it } from 'vitest'
import {
  getCatalogAttributeDefinitionsForCategory,
  resolveCatalogAttributeCode,
  resolveSupplierAttributeCodes,
} from '@/lib/catalog-attribute-schema'
import { filterCatalogAttributeDefinitionsForCategory } from '@/lib/catalog-attribute-registry'
import {
  normalizeCatalogAttributes,
  normalizeSizes,
} from '@/lib/catalog-attribute-values'

describe('catalog attribute schema', () => {
  it('does not expose jewelry stones to footwear AI processing', () => {
    const definitions = filterCatalogAttributeDefinitionsForCategory([
      { ...getCatalogAttributeDefinitionsForCategory('Обувь')[0], code: 'sizes', active: true },
      {
        code: 'stones', label: 'Камни', category_scope: 'Ювелирные изделия и бижутерия',
        value_type: 'multi_enum', sort_order: 20, parser_rules: [], aliases: [],
        show_as_characteristic: true, use_as_filter: true, use_as_variant_dimension: false, active: true,
      },
    ], 'Обувь')

    expect(definitions.map((item) => item.code)).toEqual(['sizes'])
  })
  it('combines common and category-specific attributes', () => {
    const clothing = getCatalogAttributeDefinitionsForCategory('Одежда').map((item) => item.code)
    expect(clothing).toEqual(expect.arrayContaining(['colors', 'model_name', 'sizes', 'materials', 'fit']))
    expect(clothing).not.toContain('season')
    expect(clothing).not.toContain('country_of_origin')
  })

  it('keeps size attributes available when a mixed supplier has no category', () => {
    const unclassified = getCatalogAttributeDefinitionsForCategory().map((item) => item.code)
    expect(unclassified).toEqual(expect.arrayContaining(['colors', 'model_name', 'materials', 'sizes', 'size_system', 'measurements']))
  })

  it('adds subcategory attributes without making sizes mandatory', () => {
    const rings = getCatalogAttributeDefinitionsForCategory('Ювелирные изделия', 'Кольца')
    expect(rings.map((item) => item.code)).toContain('jewelry_size')
    expect(rings.find((item) => item.code === 'jewelry_size')?.use_as_variant_dimension).toBe(true)
  })

  it('uses category attributes automatically until a supplier overrides them', () => {
    expect(resolveSupplierAttributeCodes([], 'Обувь')).toContain('upper_material')
    expect(resolveSupplierAttributeCodes([], 'Обувь')).toContain('measurements')
    expect(resolveSupplierAttributeCodes(['colors'], 'Обувь')).toEqual(['colors'])
  })

  it('maps legacy codes and moves generic shoe material to upper material', () => {
    expect(resolveCatalogAttributeCode('bag_dimensions')).toBe('dimensions')
    expect(normalizeCatalogAttributes({
      material: 'leather',
      shoe_size_system: 'eu',
      sizes: '38-40',
      season: 'Зима',
    }, { categoryName: 'Обувь' })).toEqual({
      upper_material: ['Кожа'],
      size_system: 'EU',
      sizes: { values: ['38', '39', '40'] },
    })
  })

  it('normalizes letter and numeric sizes without requiring a value', () => {
    expect(normalizeSizes(['xl', '38,5', '39'])).toEqual(['XL', '38.5', '39'])
    expect(normalizeCatalogAttributes({}, { categoryName: 'Одежда' })).toEqual({})
    expect(normalizeCatalogAttributes({
      sizes: { groups: [{ system: 'eu', audience: 'male', values: ['39', '40'] }], values: ['39', '40'] },
    }, { categoryName: 'Обувь' })).toEqual({
      sizes: {
        values: ['39', '40'],
        groups: [{ system: 'EU', audience: 'male', values: ['39', '40'] }],
      },
    })
  })

  it('reads normalized Rails attribute objects when reopening a product', () => {
    expect(normalizeCatalogAttributes({
      colors: { raw_values: ['noir'], filter_values: ['black'] },
      materials: { names: ['хлопок'], families: ['cotton'] },
      size_system: { filter_value: 'EU', display_value: 'EU' },
    }, { categoryName: 'Одежда' })).toEqual({
      colors: ['Чёрный'],
      materials: ['Хлопок'],
      size_system: 'EU',
    })
  })

  it('uses editable dictionary aliases as the canonical product value', () => {
    expect(normalizeCatalogAttributes({
      colors: ['jet black'],
    }, {
      categoryName: 'Одежда',
      definitions: [{
        code: 'colors',
        label: 'Цвет',
        category_scope: 'Все категории',
        value_type: 'multi_enum',
        show_as_characteristic: true,
        use_as_filter: true,
        use_as_variant_dimension: false,
        parser_rules: [],
        aliases: [],
        values: ['Чёрный'],
        dictionary_values: [{
          id: '1',
          attribute_code: 'colors',
          filter_value: 'black',
          canonical_value: 'Чёрный',
          aliases: ['jet black'],
          sort_order: 10,
          active: true,
        }],
        sort_order: 10,
        active: true,
      }],
    })).toEqual({ colors: ['Чёрный'] })
  })

  it('preserves structured measurement tables when saving other product fields', () => {
    expect(normalizeCatalogAttributes({
      measurements: {
        unit: 'см',
        columns: [{ key: 'length', label: 'Длина' }],
        rows: [{ size: 'M', values: { length: '66' } }],
        note: 'Допуск 1–2 см',
      },
    }, { categoryName: 'Одежда' })).toEqual({
      measurements: {
        unit: 'см',
        columns: [{ key: 'length', label: 'Длина' }],
        rows: [{ size: 'M', values: { length: '66' } }],
        note: 'Допуск 1–2 см',
      },
    })
  })
})

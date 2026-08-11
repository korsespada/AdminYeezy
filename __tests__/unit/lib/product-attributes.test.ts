import { describe, expect, it } from 'vitest'
import { extractExplicitShoeAttributes, extractProductAttributes, inferShoeGender, normalizeProductAttributes } from '@/lib/product-attributes'
import { validateProducts } from '@/lib/product-validation'

describe('product attributes', () => {
  it('normalizes JSON attributes and ignores core fields', () => {
    expect(normalizeProductAttributes('{"color":"black","sizes":["M","L"],"name":"ignored","nested":{"x":1}}')).toEqual({
      color: 'black',
      sizes: ['M', 'L'],
      nested: { x: 1 },
    })
  })

  it('preserves a structured measurements table during batch load and save', () => {
    const measurements = {
      unit: 'см',
      columns: [{ key: 'waist', label: 'Талия' }],
      rows: [{ size: 'M', values: { waist: '87.5' } }],
    }

    expect(normalizeProductAttributes({ measurements })).toEqual({ measurements })
  })

  it('keeps unknown CSV fields as attributes', () => {
    expect(extractProductAttributes({
      external_id: 'p-1',
      color: 'black',
      material: 'cotton',
      attributes: '{"season":"ss26"}',
    })).toEqual({
      color: 'black',
      material: 'cotton',
      season: 'ss26',
    })
  })

  it('does not expose batch system fields as product attributes', () => {
    expect(extractProductAttributes({
      price_source: 'legacy',
      h1: 'Заголовок',
      seo_title: 'SEO',
      variant_group_key: 'group-1',
      material: 'кожа',
    })).toEqual({ material: 'кожа' })
  })

  it('extracts only explicit shoe fields and expands a safe size range', () => {
    expect(extractExplicitShoeAttributes(`
      Кроссовки
      Размеры: EU 38-40
      Верх: телячья кожа
      Подкладка: текстиль
      Подошва: резина
      Высота каблука: 4,5 см
    `)).toEqual({
      sizes: ['38', '39', '40'],
      size_system: 'EU',
      upper_material: 'телячья кожа',
      lining_material: 'текстиль',
      sole_material: 'резина',
      heel_height: '4.5 см',
    })
  })

  it('extracts Chinese footwear size labels and ignores trailing supplier notes', () => {
    expect(extractExplicitShoeAttributes(
      'Chrome hearts x Converse 1970S 黑色高帮鞋 码数：38-46（大于44码需补差价） 五金：白铜镀银',
    )).toMatchObject({
      sizes: ['38', '39', '40', '41', '42', '43', '44', '45', '46'],
    })
  })

  it('keeps supplied structured values over text suggestions', () => {
    expect(extractProductAttributes({
      description: 'Размеры: 38-40',
      attributes: { sizes: ['41'], size_system: 'IT' },
    })).toMatchObject({
      sizes: ['41'],
      size_system: 'IT',
    })
  })

  it('classifies shoe gender from explicit wording and safe EU ranges', () => {
    expect(inferShoeGender('Женские босоножки. Размеры: EU 38–45')).toBe('female')
    expect(inferShoeGender('Размеры: EU 36–45')).toBe('unisex')
    expect(inferShoeGender('Размеры: EU 39–45')).toBe('male')
    expect(inferShoeGender('Размеры: EU 36–41')).toBe('female')
    expect(inferShoeGender('Размеры: EU 38–45')).toBeNull()
  })

  it('uses an explicit size-group audience before range heuristics', () => {
    expect(inferShoeGender('Размеры EU 38–45', {
      values: ['38', '39', '40', '41', '42', '43', '44', '45'],
      groups: [{ audience: 'female', values: ['38', '39', '40', '41'] }],
    })).toBe('female')
  })

  it('reports duplicate IDs and invalid attribute keys', () => {
    const issues = validateProducts([
      { external_id: 'same', name: 'A' },
      { external_id: 'same', name: 'B', attributes: { 'bad key': 'x' } },
    ])
    expect(issues.some((issue) => issue.field === 'external_id' && issue.severity === 'error')).toBe(true)
    expect(issues.some((issue) => issue.field === 'attributes.bad key')).toBe(true)
  })
})

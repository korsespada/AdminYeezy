import { describe, expect, it } from 'vitest'
import { extractExplicitShoeAttributes, extractProductAttributes, normalizeProductAttributes } from '@/lib/product-attributes'
import { validateProducts } from '@/lib/product-validation'

describe('product attributes', () => {
  it('normalizes JSON attributes and ignores core fields', () => {
    expect(normalizeProductAttributes('{"color":"black","sizes":["M","L"],"name":"ignored","nested":{"x":1}}')).toEqual({
      color: 'black',
      sizes: ['M', 'L'],
    })
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
      shoe_size_system: 'EU',
      upper_material: 'телячья кожа',
      lining_material: 'текстиль',
      sole_material: 'резина',
      heel_height: '4.5 см',
    })
  })

  it('keeps supplied structured values over text suggestions', () => {
    expect(extractProductAttributes({
      description: 'Размеры: 38-40',
      attributes: { sizes: ['41'], shoe_size_system: 'IT' },
    })).toMatchObject({
      sizes: ['41'],
      shoe_size_system: 'IT',
    })
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

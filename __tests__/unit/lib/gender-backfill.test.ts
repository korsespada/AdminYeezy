import { describe, expect, it } from 'vitest'
import {
  buildPreviewRow,
  findExactProductMatch,
  parseGenderCsv,
  suggestGender,
  type GenderCsvRow,
} from '@/lib/gender-backfill'
import type { Product } from '@/lib/types'

function row(description: string, overrides: Partial<GenderCsvRow> = {}): GenderCsvRow {
  return {
    rowNumber: 2,
    productId: 'ext-1',
    name: 'Product',
    description,
    raw: {},
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    productId: 'ext-1',
    external_id: 'ext-1',
    sku: 'sku-1',
    name: 'CRM Product',
    description: '',
    price: 0,
    status: 'active',
    brand: '',
    category: '',
    subcategory: '',
    photos: [],
    photos_processed: true,
    gender: '',
    thumb: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'products',
    ...overrides,
  }
}

describe('gender backfill helpers', () => {
  it('parses semicolon CSV with productId and multiline descriptions', () => {
    const rows = parseGenderCsv([
      'productId;name;description;photos',
      '"_abc";"Chanel Кроссовки";"Тип обуви: Кроссовки',
      'Размеры: 35-40";"[""a.jpg""]"',
    ].join('\n'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      productId: '_abc',
      name: 'Chanel Кроссовки',
    })
    expect(rows[0].description).toContain('Размеры: 35-40')
  })

  it('matches products by exact productId, external_id, sku, or id only', () => {
    const products = [
      product({ id: '1', external_id: 'abc-10', sku: 'sku-10', productId: 'abc-10' }),
      product({ id: '2', external_id: 'abc-1', sku: 'sku-1', productId: 'abc-1' }),
    ]

    expect(findExactProductMatch(products, 'abc-1')?.id).toBe('2')
    expect(findExactProductMatch(products, 'sku-10')?.id).toBe('1')
    expect(findExactProductMatch(products, 'abc')).toBeUndefined()
  })

  it('suggests gender from explicit text markers', () => {
    expect(suggestGender(row('Женская сумка')).gender).toBe('Для женщин')
    expect(suggestGender(row('Мужской ремень')).gender).toBe('Для мужчин')
    expect(suggestGender(row('unisex hoodie')).gender).toBe('Унисекс')
  })

  it('suggests gender from shoe size ranges only for likely shoes', () => {
    expect(suggestGender(row('Тип обуви: Кроссовки Размеры: 35-41')).gender).toBe('Для женщин')
    expect(suggestGender(row('Тип обуви: Кроссовки Размеры: 39-45')).gender).toBe('Для мужчин')
    expect(suggestGender(row('Тип обуви: Кроссовки Размеры: 36-45')).gender).toBe('Унисекс')
  })

  it('leaves non-shoes without explicit markers for manual review', () => {
    const preview = buildPreviewRow(row('Кожаная сумка, размеры 20-30'), product({ name: 'Bag' }))

    expect(preview.status).toBe('needs_review')
    expect(preview.selectedGender).toBe('')
    expect(preview.reason).toContain('ручной выбор')
  })
})

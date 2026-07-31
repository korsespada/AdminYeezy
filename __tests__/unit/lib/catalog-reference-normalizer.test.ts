import { describe, expect, it } from 'vitest'
import { normalizeProductsCatalogReferences, sanitizeSupplierAiInstructions } from '@/lib/catalog-reference-normalizer'

describe('supplier AI instruction sanitizing', () => {
  it('replaces legacy and canonical catalog ids with readable lookup names', () => {
    const result = sanitizeSupplierAiInstructions(
      'ID бренда: oldbrand1234567; category: 9168dfab-3808-4c98-85f2-827de398f959',
      [
        { entity_type: 'brand', legacy_id: 'oldbrand1234567', canonical_id: 'brand-uuid', name: 'Chanel' },
        { entity_type: 'category', legacy_id: 'old-category', canonical_id: '9168dfab-3808-4c98-85f2-827de398f959', name: 'Обувь' },
      ],
    )

    expect(result).toContain('бренд из справочника: «Chanel»')
    expect(result).toContain('category: «Обувь»')
    expect(result).not.toContain('oldbrand1234567')
    expect(result).not.toContain('9168dfab-3808-4c98-85f2-827de398f959')
    expect(result).toContain('возвращай только точные текущие id')
  })

  it('removes built-in attributes that belong to another category', () => {
    const [product] = normalizeProductsCatalogReferences([{
      category: 'shoes-id',
      attributes: { sizes: ['38'], upper_material: 'Кожа', stones: ['Стразы'], custom_note: 'ok' },
    }], [
      { entity_type: 'category', legacy_id: 'shoes-id', canonical_id: 'shoes-id', name: 'Обувь' },
    ])

    expect(product.attributes).toEqual({
      sizes: ['38'],
      upper_material: 'Кожа',
      custom_note: 'ok',
    })
  })
})

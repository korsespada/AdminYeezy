import { describe, expect, it } from 'vitest'
import { canonicalBatchSuggestionKey, matchingPriceRule, normalizeBatchAiOutput } from '@/lib/batch-ai'

describe('batch AI normalization', () => {
  it('keeps unknown taxonomy out of the applied product and removes rejected media', () => {
    const result = normalizeBatchAiOutput({
      product: {
        name: 'Chanel Сумка',
        brand: 'unknown-brand',
        category: 'bags',
        subcategory: 'new-subcategory',
        catalog_attributes: { colors: ['black'], exotic_detail: 'value' }, price_rule_key: 'known-rule',
        confidence: 0.9,
      },
      media: { discard_indexes: [2], size_chart_indexes: [3] },
      attribute_suggestions: [],
    }, {
      product: {
        name: '', brand: 'chanel', category: 'bags', subcategory: 'bags-generic',
        photos: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'], attributes: {},
      },
      brandIds: new Set(['chanel']),
      categoryIds: new Set(['bags']),
      subcategoryIds: new Set(['bags-generic']),
      attributeCodes: new Set(['colors']),
      priceRuleKeys: new Set(['known-rule']),
    })

    expect(result.product.brand).toBe('chanel')
    expect(result.product.subcategory).toBe('bags-generic')
    expect(result.product.photos).toEqual(['1.jpg', '4.jpg'])
    expect(result.product.attributes).toEqual({ colors: ['black'] })
    expect(result.product.price_rule_key).toBe('known-rule')
    expect(result.suggestions[0].code).toBe('exotic_detail')
  })

  it('chooses the most specific price rule and normalizes common attribute aliases', () => {
    const product = { category: 'bags', brand: 'chanel', attributes: { size_class: 'large', materials: ['leather'] } }
    const rule = matchingPriceRule(product, [
      { id: 1, enabled: true, priority: 100, conditions: { category: 'bags' }, price: 40_000 },
      { id: 2, enabled: true, priority: 0, conditions: { category: 'bags', 'attributes.size_class': 'large' }, price: 52_000 },
    ])

    expect(rule.id).toBe(2)
    expect(canonicalBatchSuggestionKey('Material')).toBe('materials')
    expect(canonicalBatchSuggestionKey('model_names')).toBe('model_name')
  })

  it('applies suggestions for already registered attributes instead of asking for approval', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'bags' },
      attribute_suggestions: [
        { code: 'dimensions', value: '17 × 19.5 × 5', label: 'Габариты' },
        { code: 'bag_width', value: 17, label: 'Ширина сумки' },
      ],
    }, {
      product: { category: 'bags', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['bags']),
      subcategoryIds: new Set(),
      attributeCodes: new Set(['dimensions', 'bag_width_cm']),
    })

    expect(result.product.attributes).toEqual({
      dimensions: '17 × 19.5 × 5',
      bag_width_cm: 17,
    })
    expect(result.suggestions).toEqual([])
  })

  it('drops registered attributes that are not allowed for the product category', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        catalog_attributes: { sizes: ['38'], stones: ['Стразы'] },
      },
      attribute_suggestions: [{ code: 'stones', value: ['Стразы'], label: 'Камни' }],
    }, {
      product: {
        category: 'shoes',
        photos: [],
        attributes: { stones: ['Стразы'], upper_material: 'Кожа' },
      },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      subcategoryIds: new Set(),
      attributeCodes: new Set(['sizes', 'upper_material']),
      knownAttributeCodes: new Set(['sizes', 'upper_material', 'stones']),
    })

    expect(result.product.attributes).toEqual({ upper_material: 'Кожа', sizes: ['38'] })
    expect(result.suggestions).toEqual([])
  })

  it('recovers an explicit shoe size range when the model omits sizes', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sandals',
        description: 'Чёрные босоножки с ремешками. Доступные размеры: EU 35–41.',
        catalog_attributes: { colors: ['Чёрный'] },
      },
    }, {
      product: { category: 'shoes', subcategory: 'sandals', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sandals']),
      subcategoryParents: new Map([['sandals', 'shoes']]),
      subcategoryNames: new Map([['sandals', 'Сандалии и босоножки']]),
      attributeCodes: new Set(['sizes', 'size_system', 'colors']),
    })

    expect(result.product.attributes).toMatchObject({
      colors: ['Чёрный'],
      sizes: ['35', '36', '37', '38', '39', '40', '41'],
      size_system: 'EU',
    })
  })

  it('maps a known shoe construction suggestion to an existing broad subcategory', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'shoes', subcategory: 'generic-shoes' },
      subcategory_suggestion: { name: 'Дерби', parent_category_id: 'shoes' },
    }, {
      product: { category: 'shoes', subcategory: 'generic-shoes', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['generic-shoes', 'flat-shoes']),
      subcategoryParents: new Map([['generic-shoes', 'shoes'], ['flat-shoes', 'shoes']]),
      subcategoryNames: new Map([
        ['generic-shoes', 'Туфли'],
        ['flat-shoes', 'Туфли на плоской подошве'],
      ]),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('flat-shoes')
    expect(result.subcategorySuggestion).toBeNull()
  })

  it('rejects the legacy generic shoe subcategory', () => {
    expect(() => normalizeBatchAiOutput({
      product: { category: 'shoes', subcategory: 'generic-shoes' },
    }, {
      product: { category: 'shoes', subcategory: 'generic-shoes', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['generic-shoes']),
      subcategoryParents: new Map([['generic-shoes', 'shoes']]),
      subcategoryNames: new Map([['generic-shoes', 'Туфли']]),
      attributeCodes: new Set(),
    })).toThrow('конкретная подкатегория')
  })

  it('does not keep a legacy taxonomy value excluded from the current supplier dictionary', () => {
    const result = normalizeBatchAiOutput({
      product: { brand: 'chanel', category: 'bags', subcategory: 'generic-bags' },
    }, {
      product: { brand: 'chanel', category: 'bags', subcategory: 'generic-bags', photos: [], attributes: {} },
      brandIds: new Set(['chanel']),
      categoryIds: new Set(['bags']),
      subcategoryIds: new Set(['backpacks']),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('')
  })

  it('keeps a selected subcategory and its parent category consistent', () => {
    const result = normalizeBatchAiOutput({
      product: { brand: 'chanel', category: 'bags', subcategory: 'passport-holders' },
    }, {
      product: { brand: 'chanel', category: 'bags', subcategory: '', photos: [], attributes: {} },
      brandIds: new Set(['chanel']),
      categoryIds: new Set(['bags', 'accessories']),
      subcategoryIds: new Set(['passport-holders']),
      subcategoryParents: new Map([['passport-holders', 'accessories']]),
      attributeCodes: new Set(),
    })

    expect(result.product.category).toBe('accessories')
    expect(result.product.subcategory).toBe('passport-holders')
  })

  it('matches numeric ranges and gives an exact visual rule precedence over fallback size', () => {
    const product = {
      category: 'bags', price_rule_key: 'visual-1',
      attributes: { model_name: 'Classic Flap', bag_width_cm: 25, size_class: 'large' },
    }
    const rule = matchingPriceRule(product, [
      { id: 1, enabled: true, priority: 10, conditions: { category: 'bags', 'attributes.size_class': 'large' }, price: 90_000 },
      { id: 2, enabled: true, priority: 150, conditions: { category: 'bags', 'attributes.model_name': 'Classic Flap', 'attributes.bag_width_cm': { min: 23, max: 30 } }, price: 90_000 },
      { id: 3, enabled: true, priority: 200, conditions: { price_rule_key: 'visual-1' }, price: 95_000 },
    ])

    expect(rule.id).toBe(3)
  })
})

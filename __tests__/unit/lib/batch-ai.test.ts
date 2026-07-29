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

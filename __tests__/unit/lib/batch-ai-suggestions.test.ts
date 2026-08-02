import { describe, expect, it } from 'vitest'
import {
  canonicalColorFamilyKey,
  canonicalProductColorFamilyKey,
  colorFamilyRebuildPlan,
  inferBaseColor,
  normalizeShadeScanOutput,
  normalizeVisualFamilyScanOutput,
  sameSubcategoryFamily,
  subcategoryFamilyKey,
} from '@/lib/batch-ai-suggestions'

describe('subcategoryFamilyKey', () => {
  it('merges punctuation, number and harmless wording variants', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).toBe(subcategoryFamilyKey('сумка тоут'))
    expect(subcategoryFamilyKey('Сумки с верхней ручкой')).toBe(subcategoryFamilyKey('Сумки с ручкой'))
  })

  it('keeps genuinely different subcategories separate', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).not.toBe(subcategoryFamilyKey('Сумки-хобо'))
    expect(sameSubcategoryFamily('Сумки-тоут', 'Сумки-хобо')).toBe(false)
  })

  it('merges a narrower wording into an existing broader family', () => {
    expect(sameSubcategoryFamily('Сумки с короткой ручкой', 'Сумки с ручкой')).toBe(true)
  })
})

describe('canonicalColorFamilyKey', () => {
  it('removes color from a candidate signature', () => {
    expect(canonicalColorFamilyKey({
      group_signature: 'Chanel Classic Flap medium Caviar gold white',
      color: 'White',
    })).toBe('chanel_classic_flap_medium_caviar_gold')
  })

  it('keeps size and construction differences separate', () => {
    const small = canonicalColorFamilyKey({ group_signature: 'Chanel Classic Flap TopHandle small gold pink', color: 'pink' })
    const medium = canonicalColorFamilyKey({ group_signature: 'Chanel Classic Flap medium gold white', color: 'white' })
    expect(small).not.toBe(medium)
  })
})

describe('canonicalProductColorFamilyKey', () => {
  it('matches the same product in different colors', () => {
    const beige = {
      name: 'Chanel Hobo Mini',
      brand: 'chanel',
      category: 'bags',
      subcategory: 'hobo',
      attributes: {
        colors: ['Бежевый'], dimensions: '20 × 22 × 12.5 см',
        model_name: 'Hobo', materials: ['Кожа'], hardware_color: 'Золотистая',
      },
    }
    const gold = {
      ...beige,
      attributes: { ...beige.attributes, colors: ['Золотой'] },
    }
    expect(canonicalProductColorFamilyKey(beige)).toBe(canonicalProductColorFamilyKey(gold))
  })

  it('keeps different physical bag sizes separate', () => {
    const small = { name: 'Chanel Hobo', attributes: { model_name: 'Hobo', dimensions: '20 × 22 × 12 см' } }
    const large = { name: 'Chanel Hobo', attributes: { model_name: 'Hobo', dimensions: '30 × 26 × 14 см' } }
    expect(canonicalProductColorFamilyKey(small)).not.toBe(canonicalProductColorFamilyKey(large))
  })

  it('uses the internal model code before inconsistent material wording', () => {
    const cotton = {
      name: 'Brunello Cucinelli поло', brand: 'bc', category: 'clothes', variant_group_key: 'BC116',
      attributes: { colors: ['Серый'], materials: ['Хлопок'] },
    }
    const knit = {
      ...cotton,
      attributes: { colors: ['Бежевый'], materials: ['Хлопок', 'Трикотаж'] },
    }
    expect(canonicalProductColorFamilyKey(cotton)).toBe(canonicalProductColorFamilyKey(knit))
  })

  it('does not merge different product types that reuse the same source code', () => {
    const polo = { name: 'Brunello Cucinelli поло', brand: 'bc', category: 'clothes', variant_group_key: '116', attributes: {} }
    const trousers = { ...polo, name: 'Brunello Cucinelli брюки' }
    expect(canonicalProductColorFamilyKey(polo)).not.toBe(canonicalProductColorFamilyKey(trousers))
  })
})

describe('colorFamilyRebuildPlan', () => {
  it('keeps same-named colors visible and sends them to shade comparison', () => {
    const base = { name: 'Brunello Cucinelli поло', brand: 'bc', category: 'clothes', variant_group_key: 'BC116', description: '' }
    const plan = colorFamilyRebuildPlan([
      { ...base, id: 1, photos: ['1'], attributes: { colors: ['Серый'], materials: ['Хлопок'] } },
      { ...base, id: 2, photos: ['1', '2'], attributes: { colors: ['Серый'], materials: ['Хлопок', 'Трикотаж'] } },
      { ...base, id: 3, photos: ['1'], attributes: { colors: ['Синий'], materials: ['Хлопок'] } },
    ])
    expect(plan.deterministicFamilies).toHaveLength(1)
    expect(plan.deterministicFamilies[0].products.map((product) => product.id).sort()).toEqual([1, 2, 3])
    expect(plan.deterministicFamilies[0].duplicateProducts).toEqual([])
    expect(plan.deterministicFamilies[0].colorConflicts).toEqual([{ color: 'серый', productIds: [1, 2] }])
    expect(plan.shadeCandidates).toHaveLength(1)
  })

  it('sends uncoded products with several colors to visual comparison', () => {
    const base = { name: 'Loro Piana Шарф', brand: 'lp', category: 'accessories', subcategory: 'scarves' }
    const plan = colorFamilyRebuildPlan([
      { ...base, id: 1, photos: ['photo-1'], attributes: { colors: ['Синий'], materials: ['Шерсть'] } },
      { ...base, id: 2, photos: ['photo-2'], attributes: { colors: ['Серый'], materials: ['Шерсть'] } },
    ])
    expect(plan.visualCandidates).toHaveLength(1)
    expect(plan.deterministicFamilies).toHaveLength(0)
  })
})

describe('normalizeShadeScanOutput', () => {
  it('keeps distinct shades and only suggests high-confidence true duplicates', () => {
    const candidates = [
      { id: 1, attributes: { colors: ['Серый'] } },
      { id: 2, attributes: { colors: ['Серый'] } },
      { id: 3, attributes: { colors: ['Серый'] } },
    ]
    const result = normalizeShadeScanOutput({ variants: [
      { product_index: 1, color: 'Светло-серый', base_color: 'Серый', confidence: 0.96 },
      { product_index: 2, color: 'Графитовый', base_color: 'Серый', confidence: 0.94 },
      { product_index: 3, color: 'Светло-серый', base_color: 'Серый', duplicate_of_index: 1, confidence: 0.92 },
    ] }, candidates)
    expect(result.map((variant: any) => variant.color)).toEqual(['Светло-серый', 'Графитовый', 'Светло-серый'])
    expect(result[2].duplicateOfProductId).toBe(1)
    expect(inferBaseColor('Графитовый')).toBe('Серый')
    expect(inferBaseColor('Песочный')).toBe('Бежевый')
  })
})

describe('normalizeVisualFamilyScanOutput', () => {
  it('keeps one product per color and rejects low-confidence families', () => {
    const candidates = [
      { id: 1, name: 'Шарф', attributes: { colors: ['Синий'] } },
      { id: 2, name: 'Шарф', attributes: { colors: ['Синий'] } },
      { id: 3, name: 'Шарф', attributes: { colors: ['Серый'] } },
    ]
    const result = normalizeVisualFamilyScanOutput({ families: [
      { product_indexes: [1, 2, 3], confidence: 0.95, matching_evidence: 'Одинаковая вязка' },
      { product_indexes: [1, 3], confidence: 0.7 },
    ] }, candidates)
    expect(result).toHaveLength(1)
    expect(result[0].products.map((product: any) => product.id)).toEqual([1, 3])
  })
})

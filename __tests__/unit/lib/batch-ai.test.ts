import { describe, expect, it } from 'vitest'
import { buildBatchAiShadePrompt, buildBatchAiUserPrompt, canonicalBatchSuggestionKey, matchingPriceRule, normalizeBatchAiOutput } from '@/lib/batch-ai'

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

  it('keeps measurements and merges explicit clothing sizes omitted by the model', () => {
    const measurements = {
      unit: 'см',
      columns: [{ key: 'waist', label: 'Талия' }],
      rows: [
        { size: 'M', values: { waist: '87.5' } },
        { size: '3XL', values: { waist: '101.5' } },
      ],
    }
    const result = normalizeBatchAiOutput({
      product: {
        category: 'clothing',
        catalog_attributes: {
          sizes: ['M', 'L', 'XL', 'XXL'],
          measurements,
        },
      },
    }, {
      product: {
        category: 'clothing',
        description: 'Размеры: M•L•XL•XXL•XXXL ▫️Цена: 530¥',
        photos: [],
        attributes: {},
      },
      brandIds: new Set(),
      categoryIds: new Set(['clothing']),
      subcategoryIds: new Set(),
      attributeCodes: new Set(['sizes', 'size_system', 'measurements']),
    })

    expect(result.product.attributes).toMatchObject({
      sizes: ['M', 'L', 'XL', 'XXL', 'XXXL'],
      size_system: 'International',
      measurements: {
        ...measurements,
        rows: [
          { size: 'M', values: { waist: '87.5' } },
          { size: 'XXXL', values: { waist: '101.5' } },
        ],
      },
    })
  })

  it('merges explicit numeric ranges only for clothing', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'clothing', catalog_attributes: { sizes: ['48'] } },
    }, {
      product: { category: 'clothing', description: 'Размеры: 46–50', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['clothing']),
      categoryNames: new Map([['clothing', 'Одежда']]),
      subcategoryIds: new Set(),
      attributeCodes: new Set(['sizes']),
    })

    expect(result.product.attributes.sizes).toEqual(['46', '47', '48', '49', '50'])
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

  it('resolves a legacy generic shoe result into the existing heel taxonomy', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'generic-shoes',
        description: 'Кожаные туфли-лодочки на каблуке 7 см.',
      },
    }, {
      product: { category: 'shoes', subcategory: '', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['generic-shoes', 'heel-shoes', 'flat-shoes']),
      subcategoryParents: new Map([
        ['generic-shoes', 'shoes'],
        ['heel-shoes', 'shoes'],
        ['flat-shoes', 'shoes'],
      ]),
      subcategoryNames: new Map([
        ['generic-shoes', 'Туфли'],
        ['heel-shoes', 'Туфли на каблуке'],
        ['flat-shoes', 'Туфли на плоской подошве'],
      ]),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('heel-shoes')
  })

  it('keeps heeled mules in the mule taxonomy and cleans model placeholders', () => {
    const result = normalizeBatchAiOutput({
      product: {
        name: 'Чёрные мюли Chanel на тонком каблуке',
        h1: 'Мюли Chanel без задника',
        category: 'shoes',
        subcategory: 'heel-shoes',
        confidence: 95,
        catalog_attributes: {
          model_name: '26C',
          upper_material: 'не определён',
        },
      },
    }, {
      product: { category: 'shoes', subcategory: 'heel-shoes', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['heel-shoes', 'mules']),
      subcategoryParents: new Map([['heel-shoes', 'shoes'], ['mules', 'shoes']]),
      subcategoryNames: new Map([
        ['heel-shoes', 'Туфли на каблуке'],
        ['mules', 'Мюли и сабо'],
      ]),
      attributeCodes: new Set(['model_name', 'upper_material']),
    })

    expect(result.product.subcategory).toBe('mules')
    expect(result.product.attributes).toEqual({})
    expect(result.product.ai_confidence).toBe(0.95)
  })

  it('adds category rules only for the matching product category', () => {
    const base = {
      product: { category: 'shoes' },
      supplierInstructions: 'Особенности поставщика',
      brands: [],
      subcategories: [],
      attributes: [],
      priceRules: [],
    }
    const shoePrompt = buildBatchAiUserPrompt({
      ...base,
      categories: [{ id: 'shoes', name: 'Обувь' }],
    })
    const accessoryPrompt = buildBatchAiUserPrompt({
      ...base,
      product: { category: 'accessories' },
      categories: [{ id: 'accessories', name: 'Аксессуары' }],
    })
    const clothingPrompt = buildBatchAiUserPrompt({
      ...base,
      product: { category: 'clothes' },
      categories: [{ id: 'clothes', name: 'Одежда' }],
    })

    expect(shoePrompt).toContain('Автоматические правила категории «Обувь»')
    expect(shoePrompt).toContain('мюли на каблуке остаются')
    expect(accessoryPrompt).toContain('Автоматические правила категории «Аксессуары»')
    expect(accessoryPrompt).toContain('Кепки и бейсболки')
    expect(accessoryPrompt).not.toContain('Правила классификации категории «Обувь»')
    expect(clothingPrompt).toContain('Никогда не заполняй subcategory_suggestion для одежды')
  })

  it('passes the actual price together with each supplier price rule', () => {
    const prompt = buildBatchAiUserPrompt({
      product: { category: 'shoes' },
      brands: [],
      categories: [{ id: 'shoes', name: 'Обувь' }],
      subcategories: [],
      attributes: [],
      priceRules: [{
        rule_key: 'lp_shoes_all',
        name: 'Вся обувь',
        conditions: { category: 'shoes' },
        price: 25000,
      }],
    })

    expect(prompt).toContain('"rule_key":"lp_shoes_all"')
    expect(prompt).toContain('"price":25000')
    expect(prompt).toContain('Цена будет применена сервером')
  })

  it('requires unique public shade names while allowing shared base colors', () => {
    const prompt = buildBatchAiShadePrompt([
      { id: 1, external_id: 'A-1', name: 'Brunello Cucinelli кроссовки', attributes: { colors: ['Серый'] } },
      { id: 2, external_id: 'A-2', name: 'Brunello Cucinelli кроссовки', attributes: { colors: ['Серый'] } },
    ])

    expect(prompt).toContain('color — публичное точное название конкретного оттенка и обязано быть уникальным')
    expect(prompt).toContain('attributes.model_code')
    expect(prompt).toContain('photo_decision_fields')
    expect(prompt).toContain('«Светло-серый», «Серый», «Графитовый»')
    expect(prompt).toContain('Разные оттенки дублями не являются')
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

  it('maps clothing aliases to existing global subcategories without a suggestion', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'clothes', subcategory: '' },
      subcategory_suggestion: { name: 'Поло', parent_category_id: 'clothes' },
    }, {
      product: { name: 'Loro Piana поло', category: 'clothes', subcategory: '', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['clothes']),
      categoryNames: new Map([['clothes', 'Одежда']]),
      subcategoryIds: new Set(['tees', 'shorts']),
      subcategoryParents: new Map([['tees', 'clothes'], ['shorts', 'clothes']]),
      subcategoryNames: new Map([['tees', 'Футболки и майки'], ['shorts', 'Шорты']]),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('tees')
    expect(result.subcategorySuggestion).toBeNull()
  })

  it('drops unknown clothing subcategory suggestions instead of creating taxonomy proposals', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'clothes', subcategory: '' },
      subcategory_suggestion: { name: 'Экспериментальная одежда', parent_category_id: 'clothes' },
    }, {
      product: { name: 'Неопределённая модель', category: 'clothes', subcategory: '', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['clothes']),
      categoryNames: new Map([['clothes', 'Одежда']]),
      subcategoryIds: new Set(['tees']),
      subcategoryParents: new Map([['tees', 'clothes']]),
      subcategoryNames: new Map([['tees', 'Футболки и майки']]),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('')
    expect(result.subcategorySuggestion).toBeNull()
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

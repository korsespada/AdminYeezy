import { describe, expect, it } from 'vitest'
import { buildBatchAiColorSplitPrompt, buildBatchAiShadePrompt, buildBatchAiShadeRepairPrompt, buildBatchAiUserPrompt, calculatePriceRulePrice, canonicalBatchSuggestionKey, DEFAULT_BATCH_AI_PROCESSING_OPTIONS, GLOBAL_BATCH_AI_CATALOG_RULES, matchingPriceRule, normalizeBatchAiOutput, normalizeBatchAiProcessingOptions, normalizePriceRulesCatalogReferences, parseBatchAiJson, shouldPreserveExistingPrice } from '@/lib/batch-ai'
import { decryptProviderApiKey, encryptProviderApiKey, normalizeProviderBaseUrl, providerChatUrl, providerMessagesUrl, providerModelsUrl, providerProtocol } from '@/lib/ai-providers'
import { normalizeBatchAiCategoryRules } from '@/lib/batch-ai-category-rules'

describe('batch AI normalization', () => {
  it('extracts a structured response wrapped in markdown and repairs control characters', () => {
    expect(parseBatchAiJson('Ответ:\n```json\n{"unit":"см","columns":[],"rows":[],"note":"строка\nс допуском",}\n```')).toEqual({
      unit: 'см',
      columns: [],
      rows: [],
      note: 'строка\nс допуском',
    })
  })

  it('normalizes provider endpoints and encrypts API keys at rest', () => {
    const previous = process.env.AI_PROVIDER_ENCRYPTION_KEY
    process.env.AI_PROVIDER_ENCRYPTION_KEY = 'unit-test-key'
    try {
      expect(normalizeProviderBaseUrl('https://openrouter.ai/api/v1/chat/completions', 'openrouter')).toBe('https://openrouter.ai/api/v1')
      expect(normalizeProviderBaseUrl('https://provider.example.com/v1/models')).toBe('https://provider.example.com/v1')
      expect(providerChatUrl('https://byesu.com/v1')).toBe('https://byesu.com/v1/chat/completions')
      expect(providerModelsUrl('https://byesu.com/v1')).toBe('https://byesu.com/v1/models')
      expect(providerProtocol('https://openrouter.ai/api/v1')).toBe('openai')
      expect(providerProtocol('https://agentrouter.org/v1')).toBe('anthropic')
      expect(providerMessagesUrl('https://agentrouter.org/v1')).toBe('https://agentrouter.org/v1/messages?beta=true')
      expect(normalizeProviderBaseUrl('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com/v1/messages')
      const encrypted = encryptProviderApiKey('secret-key')
      expect(encrypted).not.toContain('secret-key')
      expect(decryptProviderApiKey(encrypted)).toBe('secret-key')
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY
      else process.env.AI_PROVIDER_ENCRYPTION_KEY = previous
    }
  })

  it('asks one color-split response to contain fully processed products', () => {
    const prompt = buildBatchAiColorSplitPrompt({
      product: { external_id: 'album-1', photos: ['1.jpg', '2.jpg'] },
      brands: [],
      categories: [],
      subcategories: [],
      attributes: [],
    })

    expect(prompt).toContain('Второго AI-прохода не будет')
    expect(prompt).toContain('photo_indexes')
    expect(prompt).toContain('catalog_attributes')
  })

  it('asks for a video color only when a separate video preview is available', () => {
    const prompt = buildBatchAiColorSplitPrompt({
      product: { external_id: 'album-1', photos: ['1.jpg', '2.jpg'] },
      brands: [], categories: [], subcategories: [], attributes: [],
      videoPreviewAvailable: true,
    })

    expect(prompt).toContain('video_color_key')
    expect(prompt).toContain('отдельный кадр-превью исходного видео')
  })

  it('includes the selected targeted processing rules in the AI prompt', () => {
    const prompt = buildBatchAiUserPrompt({
      product: { external_id: 'SP001-blue', photos: ['1.jpg', '2.jpg'] },
      brands: [], categories: [], subcategories: [], attributes: [],
      processingOptions: {
        colorFamilyByArticle: true,
        articleExample: 'SP001 blue',
        splitAlbumColors: false,
        reorderFirstPhoto: true,
        skipModelOnlyAlbum: true,
      },
    })
    expect(prompt).toContain('SP001 blue')
    expect(prompt).toContain('SP001 green')
    expect(prompt).toContain('cover_photo_index')
    expect(prompt).toContain('skip_product=true')
  })

  it('keeps consecutive-family matching disabled unless the supplier enables it', () => {
    expect(normalizeBatchAiProcessingOptions({}).colorFamilyBySequence).toBe(false)
    expect(normalizeBatchAiProcessingOptions({ colorFamilyBySequence: true }).colorFamilyBySequence).toBe(true)
  })

  it('enforces the current product-title contract over saved legacy prompts', () => {
    expect(GLOBAL_BATCH_AI_CATALOG_RULES).toContain('name — видимый заголовок товара без бренда и артикула, но с точным цветом')
    expect(GLOBAL_BATCH_AI_CATALOG_RULES).toContain('Сервер записывает h1 равным name')
    expect(GLOBAL_BATCH_AI_CATALOG_RULES).toContain('Не возвращай attribute_suggestions или subcategory_suggestion')
  })

  it('never creates new taxonomy proposals', () => {
    const output = {
      product: { category: 'accessories', subcategory: '', catalog_attributes: {} },
      attribute_suggestions: [{ code: 'strap_type', label: 'Тип ремешка', value: 'Плетёный' }],
      subcategory_suggestion: { name: 'Новая категория аксессуара', parent_category_id: 'accessories' },
    }
    const baseInput = {
      product: { category: 'accessories', subcategory: '', photos: [], attributes: {} },
      brandIds: new Set<string>(),
      categoryIds: new Set(['accessories']),
      categoryNames: new Map([['accessories', 'Аксессуары']]),
      subcategoryIds: new Set<string>(),
      subcategoryParents: new Map<string, string>(),
      subcategoryNames: new Map<string, string>(),
      attributeCodes: new Set<string>(),
      knownAttributeCodes: new Set<string>(),
    }
    const disabled = normalizeBatchAiOutput(output, baseInput)
    expect(disabled.suggestions).toEqual([])
    expect(disabled.subcategorySuggestion).toBeNull()

    const stillDisabled = normalizeBatchAiOutput(output, {
      ...baseInput,
      processingOptions: { ...DEFAULT_BATCH_AI_PROCESSING_OPTIONS, suggestSubcategories: true, suggestAttributes: true },
    })
    expect(stillDisabled.suggestions).toEqual([])
    expect(stillDisabled.subcategorySuggestion).toBeNull()
  })

  it('keeps the brand in its own field and mirrors the visible name into H1', () => {
    const result = normalizeBatchAiOutput({
      product: {
        name: 'Chanel — Сумка 22 Mini, чёрная',
        brand: 'chanel',
        h1: 'Устаревший H1',
        seo_title: 'Устаревший title',
        seo_description: 'Устаревшее описание',
      },
    }, {
      product: { name: '', photos: [], attributes: {} },
      brandIds: new Set(['chanel']),
      brandNames: new Map([['chanel', 'Chanel']]),
      categoryIds: new Set(), subcategoryIds: new Set(), attributeCodes: new Set(),
    })

    expect(result.product.name).toBe('Сумка 22 Mini, чёрная')
    expect(result.product.brand).toBe('chanel')
    expect(result.product.h1).toBe('Сумка 22 Mini, чёрная')
    expect(result.product.seo_title).toBe('')
    expect(result.product.seo_description).toBe('')
  })

  it('moves only the selected cover photo to the first position', () => {
    const result = normalizeBatchAiOutput({
      product: { name: 'Товар' },
      photo_alts: ['Первый', 'Второй', 'Третий'],
      ai_processing: { cover_photo_index: 3 },
    }, {
      product: { name: '', photos: ['1.jpg', '2.jpg', '3.jpg'], attributes: {} },
      brandIds: new Set(), categoryIds: new Set(), subcategoryIds: new Set(), attributeCodes: new Set(),
      processingOptions: {
        colorFamilyByArticle: false, articleExample: '', splitAlbumColors: false,
        reorderFirstPhoto: true, skipModelOnlyAlbum: false,
      },
    })
    expect(result.product.photos).toEqual(['3.jpg', '1.jpg', '2.jpg'])
    expect(result.product.photo_alts).toEqual(['Третий', 'Первый', 'Второй'])
    expect(result.coverPhotoIndex).toBe(3)
  })

  it('keeps supplier publication date out of AI attributes and on the product', () => {
    const result = normalizeBatchAiOutput({
      product: { name: 'Товар' },
    }, {
      product: {
        name: '',
        photos: [],
        supplier_published_on: '2026-05-26',
        attributes: { supplier_published_on: '2026-05-26' },
      },
      brandIds: new Set(), categoryIds: new Set(), subcategoryIds: new Set(), attributeCodes: new Set(),
    })

    expect(result.product.supplier_published_on).toBe('2026-05-26')
    expect(result.product.attributes).not.toHaveProperty('supplier_published_on')
  })

  it('marks a model-only album for whole-product exclusion', () => {
    const result = normalizeBatchAiOutput({
      product: { name: 'Товар' },
      ai_processing: { skip_product: true },
    }, {
      product: { name: '', photos: ['1.jpg'], attributes: {} },
      brandIds: new Set(), categoryIds: new Set(), subcategoryIds: new Set(), attributeCodes: new Set(),
      processingOptions: {
        colorFamilyByArticle: false, articleExample: '', splitAlbumColors: false,
        reorderFirstPhoto: false, skipModelOnlyAlbum: true,
      },
    })
    expect(result.skipProduct).toBe(true)
  })

  it('uses the Chromoff taxonomy for approved suppliers without changing the common taxonomy', () => {
    const prompt = buildBatchAiUserPrompt({
      product: { external_id: 'ch-1', category: '', subcategory: '' },
      brands: [],
      categories: [],
      subcategories: [],
      attributes: [],
      chromoffMode: true,
      chromoffCategories: [{ id: 'bracelets', name: 'Браслеты из кожи', parent_id: 'accessories', path: 'Аксессуары → Браслеты из кожи' }],
    })
    expect(prompt).toContain('Категории Chromoff')
    expect(prompt).toContain('Браслеты из кожи')
    expect(prompt).toContain('Не заменяй её общей категорией YeezyUnique')

    const result = normalizeBatchAiOutput({
      product: { name: 'Браслет Chrome Hearts', category: '', subcategory: '', catalog_attributes: {} },
      chromoff_category: { id: 'bracelets', confidence: 0.91, reason: 'Кожаный браслет' },
    }, {
      product: { name: '', category: '', subcategory: '', attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(),
      subcategoryIds: new Set(),
      attributeCodes: new Set(),
      chromoffMode: true,
      chromoffCategories: [{ id: 'bracelets', name: 'Браслеты из кожи', parent_id: 'accessories' }],
    })
    expect(result.product.category).toBe('')
    expect(result.product.attributes.chromoff_category_id).toBe('bracelets')
    expect(result.product.attributes.chromoff_category_status).toBe('ai_assigned')

    const review = normalizeBatchAiOutput({
      product: { category: '', subcategory: '' },
      chromoff_category: { id: 'bracelets', confidence: 0.6, reason: 'Недостаточно фото' },
    }, {
      product: { category: '', subcategory: '', attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(),
      subcategoryIds: new Set(),
      attributeCodes: new Set(),
      chromoffMode: true,
      chromoffCategories: [{ id: 'bracelets', name: 'Браслеты из кожи', parent_id: 'accessories' }],
    })
    expect(review.product.attributes.chromoff_category_status).toBe('needs_review')
  })

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
      processingOptions: { ...DEFAULT_BATCH_AI_PROCESSING_OPTIONS, suggestAttributes: true },
    })

    expect(result.product.brand).toBe('chanel')
    expect(result.product.subcategory).toBe('bags-generic')
    expect(result.product.photos).toEqual(['1.jpg', '4.jpg'])
    expect(result.product.attributes).toEqual({ colors: ['black'] })
    expect(result.product.price_rule_key).toBe('known-rule')
    expect(result.suggestions).toEqual([])
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

  it('normalizes legacy and human-readable catalog values in supplier price rules', () => {
    const mappings = [
      { entity_type: 'subcategory', legacy_id: 'legacy-hoodie', canonical_id: 'hoodie-current', name: 'Худи и толстовки' },
    ]
    const [rule] = normalizePriceRulesCatalogReferences([
      { enabled: true, conditions: { subcategory: 'legacy-hoodie' }, price: 24_000 },
      { enabled: true, conditions: { subcategory: 'Худи и толстовки' }, price: 24_000 },
    ], mappings)

    expect(rule.conditions?.subcategory).toBe('hoodie-current')
    expect(matchingPriceRule({ subcategory: 'hoodie-current', attributes: {} }, [rule])?.price).toBe(24_000)
  })

  it('does not preserve an unpriced zero when a new rule can fill it', () => {
    expect(shouldPreserveExistingPrice({ price: 0, price_source: 'legacy' })).toBe(false)
    expect(shouldPreserveExistingPrice({ price: 24_000, price_source: 'rule' })).toBe(true)
    expect(shouldPreserveExistingPrice({ price: 0, price_source: 'manual' })).toBe(true)
  })

  it('calculates a custom price rule from the maximum source price and rounds it', () => {
    const rule = {
      price: 0,
      conditions: {
        price_formula: {
          source_price: 'max',
          multiplier: 13,
          secondary_multiplier: 2.5,
          round_to: 1000,
          rounding: 'nearest',
        },
      },
    }
    expect(matchingPriceRule({ category: 'clothing', attributes: {} }, [{ ...rule, enabled: true, conditions: { category: 'clothing', ...rule.conditions } }])).toBeTruthy()
    expect(calculatePriceRulePrice(rule, '休闲裤 💰2399—4599 7-10天发货')).toBe(149000)
    expect(calculatePriceRulePrice({ ...rule, conditions: { price_formula: { ...rule.conditions.price_formula, rounding: 'up' } } }, '💰2399—4599')).toBe(150000)
    expect(calculatePriceRulePrice({ ...rule, conditions: { ...rule.conditions, price_formula: { ...rule.conditions.price_formula, rounding: 'up' } } }, '💰带扣：780/实时价格 💰带身：1980/实时价格')).toBe(65000)
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

  it('normalizes bag dimensions and hardware before deterministic pricing', () => {
    const result = normalizeBatchAiOutput({
      product: {
        name: 'Classic Flap',
        category: 'bags',
        subcategory: 'shoulder-bags',
        description: 'Сумка с золотистой фурнитурой. Размер: 25,5 × 15 × 6,5 см.',
        catalog_attributes: { model_name: 'Classic Flap' },
      },
    }, {
      product: { category: 'bags', subcategory: 'shoulder-bags', photos: [], attributes: { sizes: ['25'] } },
      brandIds: new Set(),
      categoryIds: new Set(['bags']),
      categoryNames: new Map([['bags', 'Сумки']]),
      subcategoryIds: new Set(['shoulder-bags']),
      subcategoryNames: new Map([['shoulder-bags', 'Сумки на плечо']]),
      subcategoryParents: new Map([['shoulder-bags', 'bags']]),
      // Raw suppliers may not assign a category before AI. Their prompt then
      // receives only common fields, while the resolved «Сумки» category must
      // still recover its registered attributes after processing.
      attributeCodes: new Set(['sizes', 'model_name']),
      knownAttributeCodes: new Set(['sizes', 'model_name', 'dimensions', 'bag_width_cm', 'bag_height_cm', 'hardware_color']),
    })

    expect(result.product.name).toBe('Classic Flap 25')
    expect(result.product.attributes).toEqual({
      model_name: 'Classic Flap',
      dimensions: '25,5 × 15 × 6,5 см',
      bag_width_cm: 25.5,
      bag_height_cm: 15,
      hardware_color: 'Золотистая',
    })
    expect(matchingPriceRule(result.product, [{
      id: 'classic-flap-25', enabled: true, priority: 100,
      conditions: { category: 'bags', 'attributes.model_name': 'Classic Flap', 'attributes.bag_width_cm': { min: 25, max: 26 } },
      price: 90_000,
    }])?.price).toBe(90_000)
  })

  it('moves top-handle bags into shoulder bags', () => {
    const result = normalizeBatchAiOutput({
      product: { category: 'bags', subcategory: 'top-handle-bags' },
    }, {
      product: { category: 'bags', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['bags']),
      categoryNames: new Map([['bags', 'Сумки']]),
      subcategoryIds: new Set(['shoulder-bags', 'top-handle-bags']),
      subcategoryNames: new Map([
        ['shoulder-bags', 'Сумки на плечо'],
        ['top-handle-bags', 'Сумки с верхней ручкой'],
      ]),
      subcategoryParents: new Map([
        ['shoulder-bags', 'bags'],
        ['top-handle-bags', 'bags'],
      ]),
      attributeCodes: new Set(),
    })

    expect(result.product.subcategory).toBe('shoulder-bags')
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

  it('recovers Chinese footwear sizes when AI omits the attribute', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        description: 'Chrome Hearts x Converse 1970S 黑色高帮鞋-特制款 码数：38-46（大于44码需补差价）',
        catalog_attributes: { colors: ['Чёрный'] },
      },
    }, {
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        photos: [],
        attributes: {},
      },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sneakers']),
      subcategoryParents: new Map([['sneakers', 'shoes']]),
      subcategoryNames: new Map([['sneakers', 'Кроссовки и кеды']]),
      attributeCodes: new Set(['sizes', 'colors']),
    })

    expect(result.product.attributes.sizes).toEqual(['38', '39', '40', '41', '42', '43', '44', '45', '46'])
  })

  it('replaces an incomplete AI size attribute with the explicit source range', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        description: '高帮鞋 码数：38-46（大于44码需补差价）',
        catalog_attributes: { sizes: ['40'] },
      },
    }, {
      product: { category: 'shoes', subcategory: 'sneakers', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sneakers']),
      subcategoryParents: new Map([['sneakers', 'shoes']]),
      subcategoryNames: new Map([['sneakers', 'Кроссовки и кеды']]),
      attributeCodes: new Set(['sizes']),
    })

    expect(result.product.attributes.sizes).toEqual(['38', '39', '40', '41', '42', '43', '44', '45', '46'])
  })

  it('normalizes footwear gender from explicit text and safe ranges', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        gender: 'female',
        description: 'Мужские кроссовки. Размеры: EU 39–45.',
        catalog_attributes: { sizes: ['39', '40', '41', '42', '43', '44', '45'] },
      },
    }, {
      product: { category: 'shoes', subcategory: 'sneakers', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sneakers']),
      subcategoryParents: new Map([['sneakers', 'shoes']]),
      subcategoryNames: new Map([['sneakers', 'Кроссовки и кеды']]),
      attributeCodes: new Set(['sizes']),
    })

    expect(result.product.gender).toBe('male')
  })

  it('leaves ambiguous footwear ranges to the AI gender decision', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        gender: 'unisex',
        description: 'Кроссовки. Размеры: EU 38–45.',
        catalog_attributes: { sizes: ['38', '39', '40', '41', '42', '43', '44', '45'] },
      },
    }, {
      product: { category: 'shoes', subcategory: 'sneakers', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sneakers']),
      subcategoryParents: new Map([['sneakers', 'shoes']]),
      subcategoryNames: new Map([['sneakers', 'Кроссовки и кеды']]),
      attributeCodes: new Set(['sizes']),
    })

    expect(result.product.gender).toBe('unisex')
  })

  it('preserves footwear size groups and their audience metadata', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'shoes',
        subcategory: 'sneakers',
        catalog_attributes: {
          sizes: {
            values: ['38', '39', '40', '41'],
            groups: [{ audience: 'female', system: 'eu', values: ['38', '39', '40', '41'] }],
          },
        },
      },
    }, {
      product: { category: 'shoes', subcategory: 'sneakers', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['shoes']),
      categoryNames: new Map([['shoes', 'Обувь']]),
      subcategoryIds: new Set(['sneakers']),
      subcategoryParents: new Map([['sneakers', 'shoes']]),
      subcategoryNames: new Map([['sneakers', 'Кроссовки и кеды']]),
      attributeCodes: new Set(['sizes']),
    })

    expect(result.product.attributes.sizes).toEqual({
      values: ['38', '39', '40', '41'],
      groups: [{ audience: 'female', system: 'EU', values: ['38', '39', '40', '41'] }],
    })
    expect(result.product.gender).toBe('female')
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

  it('removes an empty duplicate size column from measurements', () => {
    const result = normalizeBatchAiOutput({
      product: {
        category: 'clothing',
        catalog_attributes: {
          measurements: {
            unit: 'см',
            columns: [
              { key: 'size', label: 'Размеры' },
              { key: 'length', label: 'Длина' },
            ],
            rows: [{ size: 'M', values: { size: '', length: '65' } }],
          },
        },
      },
    }, {
      product: { category: 'clothing', photos: [], attributes: {} },
      brandIds: new Set(),
      categoryIds: new Set(['clothing']),
      categoryNames: new Map([['clothing', 'Одежда']]),
      subcategoryIds: new Set(),
      attributeCodes: new Set(['sizes', 'measurements']),
    })

    expect(result.product.attributes.measurements).toEqual({
      unit: 'см',
      columns: [{ key: 'length', label: 'Длина' }],
      rows: [{ size: 'M', values: { length: '65' } }],
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

  it('uses an operator-edited category rule from settings', () => {
    const prompt = buildBatchAiUserPrompt({
      product: { category: 'textile' },
      brands: [],
      categories: [{ id: 'textile', name: 'Текстиль' }],
      subcategories: [],
      attributes: [],
      categoryRules: [{
        id: 'textile-rule',
        categoryName: 'Текстиль',
        title: 'Текстиль: ручное правило',
        description: 'Настроено оператором',
        rules: 'Для текстиля выбирай только подтверждённые материалы.',
      }],
    })

    expect(prompt).toContain('Автоматические правила категории «Текстиль»')
    expect(prompt).toContain('Для текстиля выбирай только подтверждённые материалы.')
  })

  it('allows the operator to remove every category rule', () => {
    expect(normalizeBatchAiCategoryRules([])).toEqual([])
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

  it('builds an automatic shade repair prompt instead of requiring manual renaming', () => {
    const prompt = buildBatchAiShadeRepairPrompt(
      [{ id: 1, external_id: 'A-1', attributes: { colors: ['Серый'] } }],
      [{ product: { id: 1 }, color: 'Серый' }],
    )

    expect(prompt).toContain('Пользователь не будет переименовывать товары вручную')
    expect(prompt).toContain('Не используй номера')
    expect(prompt).toContain('preliminary_color')
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

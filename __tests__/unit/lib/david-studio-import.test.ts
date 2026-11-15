import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDavidAttributeSchema,
  buildDavidMediaPayload,
  buildDavidRailsProductPayload,
  buildDavidAiPrompt,
  davidCategoryRules,
  davidPromptLookups,
  davidRulePriceRub,
  davidScopedPromptText,
  mergeDavidCatalogAttributes,
  normalizeDavidAiOutput,
  toDavidPromptProduct,
  davidProductVariantAttributes,
  type DavidCatalogProduct,
} from '@/lib/david-studio-import'
import { parseDavidVariantSize } from '@/lib/david-studio-sizes'

const BRACELET: DavidCatalogProduct = {
  product_id: 1,
  handle: 'chrome-hearts-ch-plus-square-pattern-bracelet',
  title: 'CH PLUS SQUARE PATTERN BRACELET',
  url: 'https://www.david-studio.com/products/chrome-hearts-ch-plus-square-pattern-bracelet',
  product_type: 'Bracelet',
  vendor: 'David_Studio',
  category: 'chrome-hearts-bracelets',
  subcategory: null,
  images: [{ position: 1, src: 'https://cdn.shopify.com/a.jpg' }],
  variants: [
    { title: '6.3 IN / 16 CM（Suitable For Wrists 14CM）', size: '6.3 IN / 16 CM（Suitable For Wrists 14CM）', price: 500 },
    { title: '6.7 IN / 17 CM（Suitable For Wrists 15CM）', size: '6.7 IN / 17 CM（Suitable For Wrists 15CM）', price: 520 },
  ],
  price_min: 500,
  price_max: 520,
  description_text: 'CH PLUS SQUARE PATTERN BRACELET',
}

describe('buildDavidRailsProductPayload', () => {
  const payload = buildDavidRailsProductPayload({
    handle: BRACELET.handle,
    name: 'Серебряный звеньевой браслет с крестами',
    description: 'Описание',
    brandId: 'brand-1',
    categoryId: 'cat-1',
    attributes: { sizes: ['16 см', '17 см'], measurements: { unit: 'см', columns: [], rows: [] } },
    sizes: ['16 см', '17 см'],
    media: [],
  })

  it('ставит цену 0 у товара и у каждого варианта', () => {
    expect(payload.price_cents).toBe(0)
    expect(payload.variants.every((variant) => variant.price_cents === 0)).toBe(true)
  })

  it('создаёт вариант на каждый размер David', () => {
    expect(payload.variants.map((variant) => variant.size)).toEqual(['16 см', '17 см'])
  })

  it('публикует товар и отдаёт его в поиск', () => {
    expect(payload.status).toBe('active')
    expect(payload.indexing_status).toBe('indexable')
  })

  it('отдаёт товар только в Chromoff', () => {
    expect(payload.chromoff_only).toBe(true)
  })

  it('без размеров оставляет один вариант без размера', () => {
    const noSizes = buildDavidRailsProductPayload({
      handle: 'x', name: 'x', description: '', brandId: 'b', categoryId: 'c', sizes: [], media: [],
    })
    expect(noSizes.variants).toEqual([{
      size: null,
      color: null,
      price_cents: 0,
      status: 'active',
      metadata: { generated_from: 'catalog_attributes.sizes' },
    }])
  })

  it('даёт варианту устойчивый SKU и флаг источника размеров', () => {
    const withSizes = buildDavidRailsProductPayload({
      handle: 'chrome-hearts-keeper-ring', name: 'Кольцо Keeper', description: '', brandId: 'b', categoryId: 'c',
      sizes: ['US 10.5', '16 см'], media: [],
    })

    expect(withSizes.variants.map((variant: any) => variant.sku)).toEqual([
      'david-studio-chrome-hearts-keeper-ring-us-10-5',
      'david-studio-chrome-hearts-keeper-ring-16-см',
    ])
    expect(withSizes.variants.every((variant: any) => variant.metadata.generated_from === 'catalog_attributes.sizes')).toBe(true)
  })
})

describe('mergeDavidCatalogAttributes', () => {
  it('размеры и замеры поставщика важнее ответа модели', () => {
    const merged = mergeDavidCatalogAttributes(
      { jewelry_metal: 'Серебро', sizes: ['выдуманный размер'], measurements: { unit: 'см', columns: [], rows: [] } },
      davidProductVariantAttributes(BRACELET),
    )
    expect(merged.jewelry_metal).toBe('Серебро')
    expect(merged.sizes).toEqual(['16 см', '17 см'])
    expect((merged.measurements as any).rows).toHaveLength(2)
  })
})

describe('buildDavidAttributeSchema', () => {
  const definitions = [
    { code: 'colors', label: 'Цвет', category_scope: 'Все категории', values: [] },
    { code: 'jewelry_metal', label: 'Металл', category_scope: 'Ювелирные изделия', values: ['Серебро'] },
    { code: 'measurements', label: 'Замеры', category_scope: 'Одежда', values: [] },
    { code: 'hidden', label: 'Выключенный', category_scope: 'Все категории', active: false, values: [] },
  ] as any

  it('группирует схему по области категории и выкидывает выключенные, одежду, обувь и часы', () => {
    const schema = buildDavidAttributeSchema([
      ...definitions,
      { code: 'shoe_sole', label: 'Подошва', category_scope: 'Одежда и обувь', values: [] },
      { code: 'watch_glass', label: 'Стекло', category_scope: 'Часы', values: [] },
      { code: 'jewelry_box', label: 'Шкатулка', category_scope: 'Часы, ювелирные изделия и бижутерия', values: [] },
      { code: 'strap', label: 'Ремешок', category_scope: 'Одежда, сумки и аксессуары', values: [] },
    ])
    expect(Object.keys(schema)).toEqual(['Все категории', 'Одежда, сумки и аксессуары', 'Часы, ювелирные изделия и бижутерия', 'Ювелирные изделия'])
    expect(schema['Ювелирные изделия'].map((item: any) => item.code)).toEqual(['jewelry_metal'])
    expect(JSON.stringify(schema)).not.toContain('hidden')
  })
})

describe('промпт David', () => {
  it('отдаёт размеры уже в сантиметрах и не повторяет дюймы', () => {
    const promptProduct = toDavidPromptProduct(BRACELET, ['https://static.yuconcierge.com/products/media/a.webp'])
    expect(promptProduct.attributes.sizes).toEqual(['16 см', '17 см'])
    expect(JSON.stringify(promptProduct)).not.toContain('6.3 IN')
  })

  it('вкладывает карту областей категорий в текст промпта', () => {
    const { userPrompt } = buildDavidAiPrompt({
      product: BRACELET,
      photos: ['https://static.yuconcierge.com/products/media/a.webp'],
      settings: { categoryRules: [] },
      brands: [],
      categories: [{ id: 'cat-1', name: 'Ювелирные изделия' }],
      subcategories: [{ id: 'sub-1', name: 'Браслеты', parent_id: 'cat-1' }],
      attributes: [{ code: 'jewelry_metal', label: 'Металл', category_scope: 'Ювелирные изделия', values: [] }] as any,
      chromoffCategories: [{ id: 'ch-1', name: 'Браслеты' }],
    })
    expect(userPrompt).toContain('Ювелирные изделия')
    expect(userPrompt).toContain('Схема атрибутов')
    expect(userPrompt).toContain('jewelry_metal')
  })
})

describe('normalizeDavidAiOutput', () => {
  it('отдаёт характеристики в product.attributes (а не в catalog_attributes)', () => {
    const promptProduct = toDavidPromptProduct(BRACELET, ['https://static.yuconcierge.com/products/media/a.webp'])
    const normalized: any = normalizeDavidAiOutput({
      product: {
        name: 'Серебряный браслет',
        description: 'Описание',
        brand: 'brand-1',
        category: 'cat-1',
        subcategory: 'sub-1',
        catalog_attributes: { jewelry_metal: 'Серебро 925', stones: 'нет' },
      },
      chromoff_category: { id: 'ch-1', confidence: 0.9 },
      photo_alts: ['альт'],
    }, {
      promptProduct,
      brands: [{ id: 'brand-1', name: 'Chrome Hearts' }],
      categories: [{ id: 'cat-1', name: 'Ювелирные изделия' }],
      subcategories: [{ id: 'sub-1', name: 'Браслеты', parent_id: 'cat-1' }],
      attributeCodes: ['jewelry_metal', 'stones', 'colors'],
      chromoffCategories: [{ id: 'ch-1', name: 'Браслеты' }],
    })
    expect(normalized.product.attributes.jewelry_metal).toBe('Серебро 925')
    expect(normalized.product.attributes.chromoff_category_id).toBe('ch-1')
    expect(normalized.product.photo_alts).toEqual(['альт'])
  })
})

describe('реальная выгрузка David Studio', () => {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'data', 'david-studio', 'catalog.json'), 'utf8'))

  it('каждый разобранный размер — сантиметры, миллиметры, US-размер или буква', () => {
    const allowed = /^(?:[\d,]+(?:–[\d,]+)? (?:см|мм)|US [\d.]+|[0-9]?X{0,4}[SML])$/
    const offenders: string[] = []
    for (const product of catalog.products as DavidCatalogProduct[]) {
      for (const variant of product.variants || []) {
        const parsed = parseDavidVariantSize(variant.size)
        if (!parsed.size) continue
        if (!allowed.test(parsed.size)) offenders.push(`${product.handle}: ${variant.size} → ${parsed.size}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('не путает цвета и служебные подписи с размерами', () => {
    const misparsed: string[] = []
    for (const product of catalog.products as DavidCatalogProduct[]) {
      for (const variant of product.variants || []) {
        const raw = String(variant.size || '')
        if (!/choose an option|per piece|per pair|pendant only/i.test(raw)) continue
        if (parseDavidVariantSize(raw).size) misparsed.push(`${product.handle}: ${raw}`)
      }
    }
    expect(misparsed).toEqual([])
  })

  it('у браслета с подсказкой о посадке строка замеров содержит и размер, и посадку', () => {
    const product = (catalog.products as DavidCatalogProduct[])
      .find((item) => item.handle === 'chrome-hearts-ch-plus-square-pattern-bracelet')
    expect(product).toBeTruthy()
    const { measurements, sizes } = davidProductVariantAttributes(product as DavidCatalogProduct)
    expect(sizes).toContain('16 см')
    const row = measurements?.rows.find((item) => item.size === '16 см')
    expect(row?.values.fit).toBe('подходит для запястья 14 см')
  })
})

describe('buildDavidMediaPayload', () => {
  it('раскладывает альты по порядку кадров', () => {
    const media = buildDavidMediaPayload(
      [{ url: 'https://static.yuconcierge.com/products/media/b.webp', position: 2 },
       { url: 'https://static.yuconcierge.com/products/media/a.webp', position: 1 }],
      ['первый', 'второй'],
      'запасной',
    )
    expect(media.map((item) => item.original_url)).toEqual([
      'https://static.yuconcierge.com/products/media/a.webp',
      'https://static.yuconcierge.com/products/media/b.webp',
    ])
    expect(media[0].alt_text).toBe('первый')
  })
})

describe('David — только Chromoff', () => {
  it('справочники: ювелирка и сумки целиком, из аксессуаров — ремни, картхолдеры, «Другое»', () => {
    const lookups = davidPromptLookups({
      brands: [{ id: 'b1', name: 'Chrome Hearts' }, { id: 'b2', name: 'Nike', description: 'x'.repeat(100) }],
      categories: [
        { id: 'c-cloth', name: 'Одежда', seo_text_top: 'длинный SEO' },
        { id: 'c-jew', name: 'Ювелирные изделия', seo_text_top: 'длинный SEO' },
        { id: 'c-shoe', name: 'Обувь' },
        { id: 'c-bij', name: 'Бижутерия' },
        { id: 'c-watch', name: 'Часы' },
        { id: 'c-acc', name: 'Аксессуары' },
      ],
      subcategories: [
        { id: 's1', name: 'Кольца', category: 'c-jew', seo_text_bottom: 'SEO' },
        { id: 's2', name: 'Джинсы', category: 'c-cloth' },
        { id: 's3', name: 'Кеды', parent_id: 'c-shoe' },
        { id: 's4', name: 'Брошь', category: 'c-bij' },
        { id: 's5', name: 'Ремни', category: 'c-acc' },
        { id: 's6', name: 'Зонты', category: 'c-acc' },
        { id: 's7', name: 'Кошельки и картхолдеры', category: 'c-acc' },
      ],
      chromoffCategories: [
        { id: 'r-silver', name: 'Изделия из серебра', parent_id: null, active: true },
        { id: 'r-rings', name: 'Кольца', parent_id: 'r-silver', active: true },
        { id: 'r-cloth', name: 'Одежда', parent_id: null, active: true },
        { id: 'r-jeans', name: 'Джинсы', parent_id: 'r-cloth', active: true },
        { id: 'r-old', name: 'Бижутерия', parent_id: null, active: false },
        { id: 'r-old-child', name: 'Серьги', parent_id: 'r-old', active: true },
        { id: 'r-acc', name: 'Аксессуары', parent_id: null, active: true, catalog_category: { name: 'Аксессуары' } },
        { id: 'r-belts', name: 'Ремни', parent_id: 'r-acc', active: true, catalog_category: { name: 'Ремни' } },
        { id: 'r-caps', name: 'Кепки', parent_id: 'r-acc', active: true, catalog_category: { name: 'Кепки и бейсболки' } },
      ],
    })
    expect(lookups.brands).toEqual([{ id: 'b1', name: 'Chrome Hearts' }])
    expect(lookups.categories).toEqual([{ id: 'c-jew', name: 'Ювелирные изделия' }, { id: 'c-acc', name: 'Аксессуары' }])
    expect(lookups.subcategories).toEqual([
      { id: 's1', name: 'Кольца', parent_id: 'c-jew' },
      { id: 's5', name: 'Ремни', parent_id: 'c-acc' },
      { id: 's7', name: 'Кошельки и картхолдеры', parent_id: 'c-acc' },
    ])
    expect(lookups.chromoffCategories).toEqual([
      { id: 'r-silver', name: 'Изделия из серебра' },
      { id: 'r-rings', name: 'Изделия из серебра / Кольца' },
      { id: 'r-belts', name: 'Аксессуары / Ремни' },
    ])
  })

  it('правила категорий только для ювелирки, сумок и аксессуаров', () => {
    const rules = davidCategoryRules([
      { categoryName: 'Одежда' }, { categoryName: 'Сумки' }, { categoryName: 'обувь' }, { categoryName: 'Часы' }, { categoryName: 'Аксессуары' },
    ])
    expect(rules.map((rule) => rule.categoryName)).toEqual(['Сумки', 'Аксессуары'])
  })

  it('вырезает из общих промптов пункты и примеры только для одежды и обуви', () => {
    const text = [
      'ОБЩЕЕ',
      '- Бренд выбирай только из справочника.',
      '- Числовые размеры одежды, брюк и джинсов — только чётные.',
      '- Карточка, в которой показано несколько вещей, обрабатывается так:',
      '  1) Одна модель в нескольких цветах.',
      '  2) Две разные вещи.',
      '- Для сумок заполни dimensions.',
      '- Для обуви должны совпадать бренд и модель.',
      '',
      'Пример уровня текста для худи (скудный текст):',
      'name: «Голубое худи»',
      '',
      'description: «Свободное худи…»',
      '',
      'ОСТАЛЬНЫЕ ПОЛЯ',
      '- Пиши по-русски.',
    ].join('\n')
    const scoped = davidScopedPromptText(text)
    expect(scoped).toContain('Бренд выбирай только из справочника.')
    expect(scoped).toContain('Для сумок заполни dimensions.')
    expect(scoped).toContain('ОСТАЛЬНЫЕ ПОЛЯ')
    expect(scoped).toContain('Пиши по-русски.')
    expect(scoped).not.toMatch(/одежд|обув|худи|Одна модель в нескольких цветах/)
  })

  it('цена по правилу: большая цена в USD × 172, вверх до тысячи', () => {
    expect(davidRulePriceRub({ price_min: 120, price_max: 150 })).toBe(26000)
    expect(davidRulePriceRub({ price_min: 100, price_max: 100 })).toBe(18000)
    expect(davidRulePriceRub({ price_min: null, price_max: null })).toBeNull()
  })

  it('цена из карточки уходит в товар и все варианты', () => {
    const payload = buildDavidRailsProductPayload({
      handle: 'demo', name: 'Кольцо', description: '', brandId: 'b1', categoryId: 's1',
      sizes: ['US 8', 'US 9'], media: [], priceRub: 26000,
    })
    expect(payload.price_cents).toBe(2_600_000)
    expect(payload.variants.map((variant) => variant.price_cents)).toEqual([2_600_000, 2_600_000])
    expect(payload.metadata.price_source).toBe('manual')
  })
})

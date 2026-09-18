import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDavidAttributeSchema,
  buildDavidMediaPayload,
  buildDavidRailsProductPayload,
  buildDavidAiPrompt,
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

  it('публикует товар, но не отдаёт его в поиск основного магазина', () => {
    expect(payload.status).toBe('active')
    expect(payload.indexing_status).toBe('noindex')
  })

  it('без размеров оставляет один вариант без размера', () => {
    const noSizes = buildDavidRailsProductPayload({
      handle: 'x', name: 'x', description: '', brandId: 'b', categoryId: 'c', sizes: [], media: [],
    })
    expect(noSizes.variants).toEqual([{ size: null, color: null, price_cents: 0, status: 'active' }])
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

  it('группирует схему по области категории и выкидывает выключенные', () => {
    const schema = buildDavidAttributeSchema(definitions)
    expect(Object.keys(schema)).toEqual(['Все категории', 'Одежда', 'Ювелирные изделия'])
    expect(schema['Ювелирные изделия'].map((item: any) => item.code)).toEqual(['jewelry_metal'])
    expect(JSON.stringify(schema)).not.toContain('hidden')
  })
})

describe('промпт David', () => {
  it('отдаёт размеры уже в сантиметрах и не повторяет дюймы', () => {
    const promptProduct = toDavidPromptProduct(BRACELET, ['https://static.yeezyunique.ru/products/media/a.webp'])
    expect(promptProduct.attributes.sizes).toEqual(['16 см', '17 см'])
    expect(JSON.stringify(promptProduct)).not.toContain('6.3 IN')
  })

  it('вкладывает карту областей категорий в текст промпта', () => {
    const { userPrompt } = buildDavidAiPrompt({
      product: BRACELET,
      photos: ['https://static.yeezyunique.ru/products/media/a.webp'],
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
    const promptProduct = toDavidPromptProduct(BRACELET, ['https://static.yeezyunique.ru/products/media/a.webp'])
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
    const allowed = /^(?:[\d,]+(?:–[\d,]+)? (?:см|мм)|US [\d,]+|[0-9]?X{0,4}[SML])$/
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
      [{ url: 'https://static.yeezyunique.ru/products/media/b.webp', position: 2 },
       { url: 'https://static.yeezyunique.ru/products/media/a.webp', position: 1 }],
      ['первый', 'второй'],
      'запасной',
    )
    expect(media.map((item) => item.original_url)).toEqual([
      'https://static.yeezyunique.ru/products/media/a.webp',
      'https://static.yeezyunique.ru/products/media/b.webp',
    ])
    expect(media[0].alt_text).toBe('первый')
  })
})

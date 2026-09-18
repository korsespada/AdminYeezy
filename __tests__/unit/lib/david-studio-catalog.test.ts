import { describe, expect, it } from 'vitest'
import {
  buildDavidStudioFacets,
  buildSummary,
  categoryLabel,
  filterDavidStudioProducts,
  formatPriceRange,
  formatUsd,
  hasActiveFilters,
  normalizeFilters,
  normalizePageSize,
  paginate,
} from '@/lib/david-studio-catalog'
import type { DavidStudioFilters, DavidStudioProduct } from '@/lib/david-studio-catalog'

function makeProduct(overrides: Partial<DavidStudioProduct> & { product_id: number }): DavidStudioProduct {
  return {
    handle: `product-${overrides.product_id}`,
    url: `https://www.david-studio.com/products/product-${overrides.product_id}`,
    title: `Товар ${overrides.product_id}`,
    product_type: 'Rings',
    vendor: 'David_Studio',
    tags: [],
    collections: [],
    category: 'rings',
    subcategory: null,
    price_min: 100,
    price_max: 100,
    currency: 'USD',
    available: true,
    published_at: null,
    updated_at: null,
    images: [],
    variants: [],
    description_text: '',
    ...overrides,
  }
}

const CATALOG: DavidStudioProduct[] = [
  makeProduct({
    product_id: 1,
    title: 'CLASSIC OVAL CROSS BUCKLE COWHIDE LEATHER BELT',
    product_type: 'Belt',
    category: 'chrome-hearts-belts',
    subcategory: null,
    collections: ['chrome-hearts-belts'],
    price_min: 1200,
    price_max: 1450,
    description_text: 'Measures：74mm x 54mm\nMaterial：925 Sterling Silver',
    variants: [
      { variant_id: 11, title: 'Just Oval Cross Buckle', size: 'Just Oval Cross Buckle', price: 1200, compare_at_price: null, available: true },
      { variant_id: 12, title: 'Waist Circumference 28IN', size: 'Waist Circumference 28IN', price: 1450, compare_at_price: null, available: true },
    ],
    images: [{ position: 1, src: 'https://cdn.shopify.com/a.png' }, { position: 2, src: 'https://cdn.shopify.com/b.png' }],
  }),
  makeProduct({
    product_id: 2,
    title: 'FOREVER RING WITH MOISSANITE',
    product_type: 'Rings',
    category: 'rings',
    subcategory: 'chrome-hearts-spacer-rings',
    collections: ['rings', 'chrome-hearts-spacer-rings'],
    price_min: 280,
    price_max: 320,
    tags: ['Spacer'],
    variants: [
      { variant_id: 21, title: 'US7', size: 'US7', price: 280, compare_at_price: null, available: true },
      { variant_id: 22, title: 'US9', size: 'US9', price: 320, compare_at_price: 350, available: false },
    ],
    images: [{ position: 1, src: 'https://cdn.shopify.com/c.png' }],
  }),
  makeProduct({
    product_id: 3,
    title: 'CROSS PENDANT',
    product_type: 'Pendant',
    category: 'pendants',
    subcategory: 'chrome-hearts-cross-pendant',
    collections: ['pendants', 'chrome-hearts-cross-pendant'],
    price_min: 150,
    price_max: 150,
    available: false,
    variants: [{ variant_id: 31, title: 'Default Title', size: null, price: 150, compare_at_price: null, available: false }],
  }),
]

describe('david studio category labels', () => {
  it('strips the chrome-hearts prefix and capitalizes the first word', () => {
    expect(categoryLabel('chrome-hearts-cross-rings')).toBe('Cross rings')
    expect(categoryLabel('necklace')).toBe('Necklace')
  })

  it('keeps the handle when there is nothing left to prettify', () => {
    expect(categoryLabel('chrome-hearts-')).toBe('chrome-hearts-')
  })
})

describe('david studio filters', () => {
  it('falls back to safe defaults for unknown values', () => {
    const filters = normalizeFilters({ availability: 'broken', sort: 'broken' })
    expect(filters.availability).toBe('all')
    expect(filters.sort).toBe('default')
    expect(hasActiveFilters(filters)).toBe(false)
  })

  it('trims the search query', () => {
    expect(normalizeFilters({ q: '  cross  ' }).q).toBe('cross')
    expect(hasActiveFilters(normalizeFilters({ q: 'cross' }))).toBe(true)
  })

  it('filters by category, subcategory, product type and availability', () => {
    const byCategory = filterDavidStudioProducts(CATALOG, normalizeFilters({ category: 'pendants' }))
    expect(byCategory.map((item) => item.product_id)).toEqual([3])

    const bySubcategory = filterDavidStudioProducts(CATALOG, normalizeFilters({ category: 'rings', subcategory: 'chrome-hearts-spacer-rings' }))
    expect(bySubcategory.map((item) => item.product_id)).toEqual([2])

    const byType = filterDavidStudioProducts(CATALOG, normalizeFilters({ productType: 'Belt' }))
    expect(byType.map((item) => item.product_id)).toEqual([1])

    const outOfStock = filterDavidStudioProducts(CATALOG, normalizeFilters({ availability: 'out' }))
    expect(outOfStock.map((item) => item.product_id)).toEqual([3])

    const inStock = filterDavidStudioProducts(CATALOG, normalizeFilters({ availability: 'available' }))
    expect(inStock.map((item) => item.product_id)).toEqual([1, 2])
  })

  it('searches titles case-insensitively', () => {
    const found = filterDavidStudioProducts(CATALOG, normalizeFilters({ q: 'cross buckle' }))
    expect(found.map((item) => item.product_id)).toEqual([1])
  })

  it('фильтрует по состоянию импорта: необработанное, обработанное, опубликованное', () => {
    const statuses = {
      [CATALOG[0].handle]: {
        publishedInChromoff: true, photosCleaned: true, photosExpected: 2, photosDone: 2, photosPending: 0, photosFailed: 0,
      },
      [CATALOG[1].handle]: {
        publishedInChromoff: false, photosCleaned: true, photosExpected: 1, photosDone: 1, photosPending: 0, photosFailed: 0,
      },
      // Третий товар намеренно без статуса: он необработан.
    }

    const unprocessed = filterDavidStudioProducts(CATALOG, normalizeFilters({ state: 'unprocessed' }), statuses)
    expect(unprocessed.map((item) => item.product_id)).toEqual([3])

    const processed = filterDavidStudioProducts(CATALOG, normalizeFilters({ state: 'processed' }), statuses)
    expect(processed.map((item) => item.product_id)).toEqual([2])

    const published = filterDavidStudioProducts(CATALOG, normalizeFilters({ state: 'published' }), statuses)
    expect(published.map((item) => item.product_id)).toEqual([1])

    // Без статусов всё считается необработанным.
    expect(filterDavidStudioProducts(CATALOG, normalizeFilters({ state: 'unprocessed' })).map((item) => item.product_id))
      .toEqual([1, 2, 3])
    expect(hasActiveFilters(normalizeFilters({ state: 'processed' }))).toBe(true)
    expect(normalizeFilters({ state: 'broken' }).state).toBe('all')
  })

  it('считает фасет состояний по той же выборке, что и подразделы', () => {
    const statuses = {
      [CATALOG[0].handle]: {
        publishedInChromoff: false, photosCleaned: true, photosExpected: 2, photosDone: 2, photosPending: 0, photosFailed: 0,
      },
    }
    const facets = buildDavidStudioFacets(CATALOG, {}, statuses)
    expect(facets.states).toEqual([
      { value: 'unprocessed', label: 'Необработанное', count: 2 },
      { value: 'processed', label: 'Обработанное', count: 1 },
    ])

    const scoped = buildDavidStudioFacets(CATALOG, { category: 'pendants' }, statuses)
    expect(scoped.states).toEqual([{ value: 'unprocessed', label: 'Необработанное', count: 1 }])
  })

  it('searches description text and variant titles, not just the title', () => {
    // «74mm» есть только в описании, «US9» — только в варианте.
    expect(filterDavidStudioProducts(CATALOG, normalizeFilters({ q: '74mm' })).map((item) => item.product_id)).toEqual([1])
    expect(filterDavidStudioProducts(CATALOG, normalizeFilters({ q: 'us9' })).map((item) => item.product_id)).toEqual([2])
  })

  it('sorts by price and by title', () => {
    const ascending = filterDavidStudioProducts(CATALOG, normalizeFilters({ sort: 'price-asc' }))
    expect(ascending.map((item) => item.product_id)).toEqual([3, 2, 1])

    const descending = filterDavidStudioProducts(CATALOG, normalizeFilters({ sort: 'price-desc' }))
    expect(descending.map((item) => item.product_id)).toEqual([1, 2, 3])

    const byTitle = filterDavidStudioProducts(CATALOG, normalizeFilters({ sort: 'title' }))
    expect(byTitle.map((item) => item.title)).toEqual([
      'CLASSIC OVAL CROSS BUCKLE COWHIDE LEATHER BELT',
      'CROSS PENDANT',
      'FOREVER RING WITH MOISSANITE',
    ])
  })

  it('never mutates the source array when sorting', () => {
    const before = CATALOG.map((item) => item.product_id)
    filterDavidStudioProducts(CATALOG, normalizeFilters({ sort: 'price-desc' }))
    expect(CATALOG.map((item) => item.product_id)).toEqual(before)
  })

  it('filters a subcategory by collection membership, not by the stored subcategory field', () => {
    // Регрессия: товар лежит в chrome-hearts-cross-rings, но «самой длинной»
    // коллекцией у него оказалась chrome-hearts-new-arrivals. Раньше фильтр
    // по cross rings его терял, и коллекция из 26 товаров показывала 7.
    const product = makeProduct({
      product_id: 90,
      category: 'rings',
      subcategory: 'chrome-hearts-new-arrivals',
      collections: ['rings', 'chrome-hearts-cross-rings', 'chrome-hearts-new-arrivals'],
    })

    const found = filterDavidStudioProducts([product], normalizeFilters({ category: 'rings', subcategory: 'chrome-hearts-cross-rings' }))
    expect(found.map((item) => item.product_id)).toEqual([90])

    const other = filterDavidStudioProducts([product], normalizeFilters({ category: 'rings', subcategory: 'chrome-hearts-spin-rings' }))
    expect(other).toEqual([])
  })

  it('counts a subcategory facet by membership too', () => {
    const product = makeProduct({
      product_id: 91,
      category: 'rings',
      subcategory: 'chrome-hearts-new-arrivals',
      collections: ['rings', 'chrome-hearts-cross-rings', 'chrome-hearts-new-arrivals'],
    })

    const facets = buildDavidStudioFacets([product], { category: 'rings' })
    expect(facets.subcategories.map((option) => option.value).sort()).toEqual([
      'chrome-hearts-cross-rings',
      'chrome-hearts-new-arrivals',
    ])
    // основной раздел не дублируется в подразделах
    expect(facets.subcategories.some((option) => option.value === 'rings')).toBe(false)
  })
})

describe('david studio facets', () => {
  it('counts every category over the whole catalog', () => {
    const facets = buildDavidStudioFacets(CATALOG)
    expect(facets.categories.map((option) => option.value).sort()).toEqual(['chrome-hearts-belts', 'pendants', 'rings'])
    expect(facets.productTypes.map((option) => option.value).sort()).toEqual(['Belt', 'Pendant', 'Rings'])
  })

  it('narrows subcategories to the selected category', () => {
    const all = buildDavidStudioFacets(CATALOG)
    expect(all.subcategories.map((option) => option.value).sort()).toEqual(['chrome-hearts-cross-pendant', 'chrome-hearts-spacer-rings'])

    const scoped = buildDavidStudioFacets(CATALOG, { category: 'rings' })
    expect(scoped.subcategories.map((option) => option.value)).toEqual(['chrome-hearts-spacer-rings'])
    // список разделов при этом не сужается, иначе фильтр было бы не переключить
    expect(scoped.categories).toHaveLength(3)
  })

  it('reports a count that matches what its own filter returns', () => {
    // Инвариант: число рядом с вариантом фильтра обязано совпадать с размером
    // выдачи после его выбора — иначе счётчик в интерфейсе врёт.
    // Товар, для которого коллекция стала основным разделом, в подразделы
    // не попадает, но остаётся доступен через раздел.
    const selfAddressed = makeProduct({
      product_id: 93,
      title: 'BUTTERFLY FLORAL CROSS RING',
      category: 'chrome-hearts-cross-rings',
      subcategory: 'chrome-hearts-gifts-for-her',
      collections: ['chrome-hearts-cross-rings', 'chrome-hearts-floral-rings', 'chrome-hearts-gifts-for-her'],
    })
    const catalog = [...CATALOG, selfAddressed]

    const scopes: Array<Partial<Pick<DavidStudioFilters, 'category'>>> = [{}, { category: 'rings' }]
    for (const scope of scopes) {
      const facets = buildDavidStudioFacets(catalog, scope)
      for (const option of facets.categories) {
        const found = filterDavidStudioProducts(catalog, normalizeFilters({ ...scope, category: option.value }))
        expect({ scope, option: option.value, count: option.count }).toEqual({ scope, option: option.value, count: found.length })
      }
      for (const option of facets.subcategories) {
        const found = filterDavidStudioProducts(catalog, normalizeFilters({ ...scope, subcategory: option.value }))
        expect({ scope, option: option.value, count: option.count }).toEqual({ scope, option: option.value, count: found.length })
      }
    }

    // товар со «своей» коллекцией доступен через раздел, а не через подраздел
    expect(filterDavidStudioProducts(catalog, normalizeFilters({ category: 'chrome-hearts-cross-rings' })).map((item) => item.product_id)).toEqual([93])
    expect(filterDavidStudioProducts(catalog, normalizeFilters({ subcategory: 'chrome-hearts-cross-rings' }))).toEqual([])
    expect(filterDavidStudioProducts(catalog, normalizeFilters({ subcategory: 'chrome-hearts-floral-rings' })).map((item) => item.product_id)).toEqual([93])
  })
})

describe('david studio pagination', () => {
  it('slices the requested page', () => {
    const result = paginate([1, 2, 3, 4, 5], 2, 2)
    expect(result.items).toEqual([3, 4])
    expect(result.total).toBe(5)
    expect(result.totalPages).toBe(3)
    expect(result.page).toBe(2)
  })

  it('clamps a page beyond the end instead of returning nothing', () => {
    expect(paginate([1, 2, 3], 99, 2).page).toBe(2)
    expect(paginate([1, 2, 3], 99, 2).items).toEqual([3])
    expect(paginate([1, 2, 3], 0, 2).page).toBe(1)
  })

  it('always reports at least one page for an empty result', () => {
    expect(paginate([], 1, 24).totalPages).toBe(1)
  })

  it('accepts only the supported page sizes', () => {
    expect(normalizePageSize('48')).toBe(48)
    expect(normalizePageSize('37')).toBe(24)
    expect(normalizePageSize(undefined)).toBe(24)
  })
})

describe('david studio formatting', () => {
  it('formats a single price without decimals and a range with a dash', () => {
    expect(formatUsd(280)).toContain('280')
    expect(formatPriceRange({ price_min: 150, price_max: 150, currency: 'USD' })).toBe(formatUsd(150))
    expect(formatPriceRange({ price_min: 1200, price_max: 1450, currency: 'USD' })).toBe(`${formatUsd(1200)} — ${formatUsd(1450)}`)
  })

  it('renders a dash for a missing price', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatPriceRange({ price_min: null, price_max: null, currency: 'USD' })).toBe('—')
  })

  it('summarizes products, variants and images', () => {
    const summary = buildSummary(CATALOG)
    expect(summary.products).toBe(3)
    expect(summary.variants).toBe(5)
    expect(summary.images).toBe(3)
    expect(summary.byCategory['chrome-hearts-belts']).toBe(1)
    expect(summary.byProductType.Rings).toBe(1)
  })
})

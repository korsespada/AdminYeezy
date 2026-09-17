/**
 * Каталог поставщика David_Studio: типы и чистые функции.
 *
 * Модуль не обращается к файловой системе и безопасен для клиентских компонентов.
 * Чтение выгрузки с диска живёт отдельно — в lib/david-studio-catalog-server.ts.
 */

export interface DavidStudioVariant {
  variant_id: number
  title: string
  size: string | null
  price: number | null
  compare_at_price: number | null
  available: boolean
}

export interface DavidStudioImage {
  position: number
  src: string
}

export interface DavidStudioProduct {
  product_id: number
  handle: string
  url: string
  title: string
  product_type: string | null
  vendor: string | null
  tags: string[]
  collections: string[]
  category: string | null
  subcategory: string | null
  price_min: number | null
  price_max: number | null
  currency: string
  available: boolean
  published_at: string | null
  updated_at: string | null
  images: DavidStudioImage[]
  variants: DavidStudioVariant[]
  description_text: string
}

export interface DavidStudioSummary {
  products: number
  variants: number
  images: number
  byCategory: Record<string, number>
  byProductType: Record<string, number>
}

export interface DavidStudioCatalog {
  source: string
  parsed_at: string
  currency: string
  summary: DavidStudioSummary
  products: DavidStudioProduct[]
}

export interface FacetOption {
  value: string
  label: string
  count: number
}

export type DavidStudioAvailability = 'all' | 'available' | 'out'
export type DavidStudioSort = 'default' | 'price-asc' | 'price-desc' | 'title'

export interface DavidStudioFilters {
  q: string
  category: string
  subcategory: string
  productType: string
  availability: DavidStudioAvailability
  sort: DavidStudioSort
}

export interface DavidStudioFacets {
  categories: FacetOption[]
  subcategories: FacetOption[]
  productTypes: FacetOption[]
}

export const DAVID_STUDIO_PAGE_SIZES = [24, 48, 96] as const
export const DAVID_STUDIO_DEFAULT_PAGE_SIZE = 24

export function buildSummary(products: DavidStudioProduct[]): DavidStudioSummary {
  const byCategory: Record<string, number> = {}
  const byProductType: Record<string, number> = {}
  let variants = 0
  let images = 0

  for (const product of products) {
    const category = product.category || '(без категории)'
    byCategory[category] = (byCategory[category] || 0) + 1
    const productType = product.product_type || '(без типа)'
    byProductType[productType] = (byProductType[productType] || 0) + 1
    variants += product.variants?.length || 0
    images += product.images?.length || 0
  }

  return { products: products.length, variants, images, byCategory, byProductType }
}

/** handle вида chrome-hearts-cross-rings -> «Cross rings». */
export function categoryLabel(handle: string): string {
  const stripped = handle.replace(/^chrome-hearts-/, '')
  const words = stripped.replace(/[-_]+/g, ' ').trim()
  if (!words) return handle
  return words.charAt(0).toLocaleUpperCase('ru-RU') + words.slice(1)
}

export function normalizeFilters(input: {
  q?: string
  category?: string
  subcategory?: string
  productType?: string
  availability?: string
  sort?: string
}): DavidStudioFilters {
  return {
    q: (input.q || '').trim(),
    category: input.category || '',
    subcategory: input.subcategory || '',
    productType: input.productType || '',
    availability: (['available', 'out'].includes(input.availability || '') ? input.availability : 'all') as DavidStudioAvailability,
    sort: (['price-asc', 'price-desc', 'title'].includes(input.sort || '') ? input.sort : 'default') as DavidStudioSort,
  }
}

export function hasActiveFilters(filters: DavidStudioFilters): boolean {
  return Boolean(
    filters.q || filters.category || filters.subcategory || filters.productType ||
    filters.availability !== 'all' || filters.sort !== 'default',
  )
}

export function filterDavidStudioProducts(
  products: DavidStudioProduct[],
  filters: DavidStudioFilters,
): DavidStudioProduct[] {
  const needle = filters.q.toLocaleLowerCase('ru-RU')

  const filtered = products.filter((product) => {
    if (filters.category && product.category !== filters.category) return false
    // Подраздел — это реальное членство в коллекции (а не «самый длинный handle»),
    // но собственная основная коллекция товара в подразделы не попадает: она уже
    // показана как раздел. Условие зеркалит buildDavidStudioFacets, иначе счётчик
    // в списке не совпадал бы с числом найденных товаров.
    if (filters.subcategory && (
      !(product.collections || []).includes(filters.subcategory) ||
      product.category === filters.subcategory
    )) return false
    if (filters.productType && (product.product_type || '') !== filters.productType) return false
    if (filters.availability === 'available' && !product.available) return false
    if (filters.availability === 'out' && product.available) return false

    if (!needle) return true
    const haystack = [
      product.title,
      product.handle,
      product.product_type || '',
      product.category || '',
      product.subcategory || '',
      (product.tags || []).join(' '),
      product.description_text || '',
      ...(product.variants || []).map((variant) => variant.title),
    ].join(' ').toLocaleLowerCase('ru-RU')
    return haystack.includes(needle)
  })

  if (filters.sort === 'default') return filtered

  const sorted = [...filtered]
  if (filters.sort === 'title') {
    sorted.sort((left, right) => left.title.localeCompare(right.title, 'en'))
  } else {
    const direction = filters.sort === 'price-asc' ? 1 : -1
    sorted.sort((left, right) => {
      const leftPrice = left.price_min ?? Number.POSITIVE_INFINITY
      const rightPrice = right.price_min ?? Number.POSITIVE_INFINITY
      return (leftPrice - rightPrice) * direction || left.title.localeCompare(right.title, 'en')
    })
  }
  return sorted
}

/**
 * Фасеты считаются по полному каталогу, а не по текущей выдаче:
 * иначе после выбора раздела исчезали бы остальные варианты фильтра.
 */
export function buildDavidStudioFacets(
  products: DavidStudioProduct[],
  filters?: Partial<Pick<DavidStudioFilters, 'category'>>,
): DavidStudioFacets {
  const categories = new Map<string, number>()
  const subcategories = new Map<string, number>()
  const productTypes = new Map<string, number>()

  for (const product of products) {
    if (product.category) categories.set(product.category, (categories.get(product.category) || 0) + 1)
    if (product.product_type) productTypes.set(product.product_type, (productTypes.get(product.product_type) || 0) + 1)
    if (filters?.category && product.category !== filters.category) continue

    // Подразделы — все коллекции товара, кроме его основного раздела.
    // Так счётчик совпадает с реальным размером коллекции у поставщика.
    for (const collection of product.collections || []) {
      if (collection === product.category) continue
      subcategories.set(collection, (subcategories.get(collection) || 0) + 1)
    }
  }

  const toOptions = (map: Map<string, number>, labelize: boolean): FacetOption[] =>
    [...map.entries()]
      .map(([value, count]) => ({ value, label: labelize ? categoryLabel(value) : value, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru'))

  return {
    categories: toOptions(categories, true),
    subcategories: toOptions(subcategories, true),
    productTypes: toOptions(productTypes, false),
  }
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (safePage - 1) * perPage
  return { items: items.slice(start, start + perPage), total, totalPages, page: safePage }
}

export function normalizePageSize(value?: string | number): number {
  const parsed = Number(value)
  return (DAVID_STUDIO_PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DAVID_STUDIO_DEFAULT_PAGE_SIZE
}

export function formatUsd(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

/** Цена товара: одна цифра, если все варианты стоят одинаково, иначе диапазон. */
export function formatPriceRange(product: Pick<DavidStudioProduct, 'price_min' | 'price_max' | 'currency'>): string {
  const { price_min: min, price_max: max, currency } = product
  if (min === null) return '—'
  if (max === null || min === max) return formatUsd(min, currency)
  return `${formatUsd(min, currency)} — ${formatUsd(max, currency)}`
}

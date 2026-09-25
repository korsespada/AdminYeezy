import type { BatchAiLookup, BatchAiAttributeDefinition, BatchAiSettings } from '@/lib/batch-ai'
import { buildBatchAiUserPrompt, normalizeBatchAiOutput } from '@/lib/batch-ai'
import { normalizePhotoAlts } from '@/lib/product-media-seo'
import { davidVariantAttributes, parseDavidVariantSize, type DavidVariantAttributes } from '@/lib/david-studio-sizes'

/**
 * Импорт товаров David Studio в Chromoff.
 *
 * Товары David живут в выгрузке data/david-studio/catalog.json (Shopify JSON), поэтому
 * батч-пайплайн «Выгрузок» не нужен: правила ИИ и промпты переиспользуются напрямую,
 * а «отдельный поставщик» даёт различимость в каталоге (primary_supplier_name).
 */

export const DAVID_SUPPLIER_NAME = 'David Studio'
export const DAVID_BRAND_NAME = 'Chrome Hearts'
export const DAVID_SOURCE = 'https://www.david-studio.com'

export function davidExternalId(handle: string) {
  return `david-studio-${String(handle || '').trim()}`
}

/** Хвост SKU размера: «US 10.5» → «us-10-5», «16 см» → «16-см». */
export function davidSizeSkuSuffix(size: string) {
  return String(size || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Инструкция поставщика для ИИ. Это source-specific знания, которые не повторяются
 * в общих правилах из «Настроек интеллекта».
 */
export const DAVID_STUDIO_AI_INSTRUCTION = [
  'Источник — David Studio (david-studio.com), украшения и аксессуары в стиле Chrome Hearts.',
  'Исходные тексты поставщика на английском: используй их как факты (тип изделия, камень, размер, фурнитура), но не переноси рекламные обороты и не переводи дословно.',
  'Изделия из серебра 925 пробы. Материал указывай только если он подтверждён исходным текстом или фотографией; состав, пробу и камни не выдумывай.',
  'Название, описание и альты — на русском. Название без бренда и артикула, с точным типом изделия и цветом или камнем, если он виден.',
  'Размерный ряд и замеры приходят из вариантов поставщика и подставляются сервером: sizes и measurements не заполняй и не выдумывай.',
  'Заполняй catalog_attributes только кодами из группы «Все категории» и группы той категории, которую сам выбрал. Не переноси код из чужой категории и не оставляй пустую строку вместо значения.',
  'Обязательно заполни те характеристики выбранной категории, которые подтверждены исходным текстом или фотографиями: металл, пробу, камни, тип застёжки, материал, цвет. Отсутствие подтверждения — не повод пропустить характеристику, но и выдумывать значение нельзя.',
  'Клатчи, ремни, сумки и одежда описываются как обычный товар: конструкция, фактура, фурнитура и видимые детали важнее общих слов.',
].join('\n')

export interface DavidCatalogImage {
  position?: number | null
  src: string
}

export interface DavidCatalogProduct {
  product_id?: number | string | null
  handle: string
  title: string
  url?: string | null
  product_type?: string | null
  vendor?: string | null
  tags?: string[]
  collections?: string[]
  category?: string | null
  subcategory?: string | null
  images: DavidCatalogImage[]
  variants?: Array<{ title?: string | null; size?: string | null; price?: number | null; available?: boolean | null }>
  price_min?: number | null
  price_max?: number | null
  description_text?: string | null
}

export function davidPriceRange(product: DavidCatalogProduct) {
  const min = Number(product.price_min ?? 0) || 0
  const max = Number(product.price_max ?? 0) || 0
  if (!min && !max) return { min: 0, max: 0, label: '' }
  const label = min === max ? `$${min}` : `$${min} – $${max}`
  return { min, max, label }
}

/** Товар в форме, которую ждёт промпт батч-ИИ: исходные факты David как evidence. */
export function toDavidPromptProduct(product: DavidCatalogProduct, photos: string[]) {
  const price = davidPriceRange(product)
  const tags = Array.isArray(product.tags) ? product.tags : []
  const collections = Array.isArray(product.collections) ? product.collections : []
  const variants = Array.isArray(product.variants) ? product.variants : []
  const variantAttributes = davidVariantAttributes(variants)

  return {
    external_id: String(product.product_id || product.handle),
    slug: '',
    name: String(product.title || '').trim(),
    description: String(product.description_text || '').trim(),
    brand: '',
    category: '',
    subcategory: '',
    gender: null,
    price: price.min || null,
    source_price: 'min' as const,
    photos,
    attributes: {
      model_code: String(product.handle || ''),
      product_type: product.product_type || '',
      vendor: product.vendor || '',
      tags,
      collections,
      // Размеры уже приведены к сантиметрам: модель не должна пересчитывать дюймы.
      sizes: variantAttributes.sizes,
      source_url: product.url || `${DAVID_SOURCE}/products/${product.handle}`,
      source_price_usd_min: price.min || null,
      source_price_usd_max: price.max || null,
      source_supplier: DAVID_SUPPLIER_NAME,
    },
    variants: variants.map((variant) => {
      const parsed = parseDavidVariantSize(variant.size)
      return {
        // Заголовок варианта у David повторяет размер, поэтому отдаём только
        // нормализованное значение: дюймы в промпт не попадают.
        title: parsed.size || String(variant.title || '').trim(),
        // Неразмерные значения (цвет, «Per Piece») уходят отдельным полем,
        // чтобы модель не спутала их с размером.
        size: parsed.size,
        option: parsed.size ? undefined : String(variant.size || '').trim(),
        price: variant.price ?? null,
      }
    }),
  }
}

/**
 * Схема атрибутов, сгруппированная по области категории.
 *
 * Реестр AdminYeezy плоский, а требование — заполнять характеристики по схеме
 * выбранной категории. Поэтому в промпт уходит карта «область → коды», и модель
 * после выбора категории берёт свою группу плюс общие коды.
 */
export function buildDavidAttributeSchema(definitions: Array<BatchAiAttributeDefinition & { category_scope?: string | null; active?: boolean; sort_order?: number }>) {
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const definition of definitions) {
    if (definition.active === false) continue
    const scope = String(definition.category_scope || 'Все категории').trim() || 'Все категории'
    const list = groups.get(scope) || []
    list.push({
      code: definition.code,
      label: definition.label,
      value_type: definition.value_type || 'text',
      unit: definition.unit || null,
      values: definition.values || [],
    })
    groups.set(scope, list)
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => (left === 'Все категории' ? -1 : right === 'Все категории' ? 1 : left.localeCompare(right, 'ru'))),
  )
}

export function buildDavidAiPrompt(input: {
  product: DavidCatalogProduct
  photos: string[]
  settings: Pick<BatchAiSettings, 'categoryRules'> & { categoryRules?: BatchAiSettings['categoryRules'] }
  brands: BatchAiLookup[]
  categories: BatchAiLookup[]
  subcategories: BatchAiLookup[]
  attributes: BatchAiAttributeDefinition[]
  chromoffCategories: BatchAiLookup[]
}) {
  const promptProduct = toDavidPromptProduct(input.product, input.photos)
  const userPrompt = buildBatchAiUserPrompt({
    product: promptProduct,
    supplierInstructions: DAVID_STUDIO_AI_INSTRUCTION,
    brands: input.brands,
    categories: input.categories,
    subcategories: input.subcategories,
    // Реестр уходит картой «область категории → коды»: модель обязана заполнять
    // характеристики по схеме той категории, которую выбрала сама.
    attributes: buildDavidAttributeSchema(input.attributes) as unknown as BatchAiAttributeDefinition[],
    categoryRules: input.settings.categoryRules,
    chromoffMode: true,
    chromoffCategories: input.chromoffCategories,
  })
  return { promptProduct, userPrompt }
}

export function normalizeDavidAiOutput(raw: unknown, input: {
  promptProduct: Record<string, unknown>
  brands: BatchAiLookup[]
  categories: BatchAiLookup[]
  subcategories: BatchAiLookup[]
  attributeCodes: string[]
  chromoffCategories: BatchAiLookup[]
}) {
  return normalizeBatchAiOutput(raw, {
    product: input.promptProduct,
    brandIds: new Set(input.brands.map((row) => String(row.id))),
    categoryIds: new Set(input.categories.map((row) => String(row.id))),
    subcategoryIds: new Set(input.subcategories.map((row) => String(row.id))),
    subcategoryParents: new Map(input.subcategories.map((row) => [String(row.id), String((row as any).parent_id || '')])),
    categoryNames: new Map(input.categories.map((row) => [String(row.id), String(row.name || '')])),
    subcategoryNames: new Map(input.subcategories.map((row) => [String(row.id), String(row.name || '')])),
    attributeCodes: new Set(input.attributeCodes),
    knownAttributeCodes: new Set(input.attributeCodes),
    attributeDictionaryValues: [],
    priceRuleKeys: new Set<string>(),
    // Без этого флага нормализация не читает chromoff_category вовсе, и
    // категория Chromoff всегда оставалась пустой.
    chromoffMode: true,
    chromoffCategories: input.chromoffCategories.map((row) => ({ id: String(row.id), name: String(row.name || '') })),
  } as any)
}

export interface DavidPhotoMedia {
  url: string
  position: number | null
}

/** Медиа товара для Rails: адреса очищенных фото из S3 и альты, которые вернул ИИ. */
export function buildDavidMediaPayload(photos: DavidPhotoMedia[], alts: unknown, fallbackAlt: string) {
  const sorted = [...photos].sort((left, right) => (left.position || 0) - (right.position || 0))
  const normalizedAlts = normalizePhotoAlts(alts, sorted.length, fallbackAlt)
  return sorted.map((photo, index) => ({
    original_url: photo.url,
    thumb_url: photo.url,
    preview_url: photo.url,
    og_image_url: photo.url,
    alt_text: normalizedAlts[index] || fallbackAlt,
    sort_order: index,
    processing_status: 'processed',
  }))
}

/**
 * Характеристики товара: ответ ИИ плюс детерминированные размеры и замеры из
 * вариантов David. Размеры поставщика — источник истины, поэтому они
 * перекрывают ответ модели, а не наоборот.
 */
export function mergeDavidCatalogAttributes(
  aiAttributes: Record<string, unknown> | null | undefined,
  variant: DavidVariantAttributes,
) {
  const merged: Record<string, unknown> = { ...(aiAttributes || {}) }
  if (variant.sizes.length) merged.sizes = variant.sizes
  if (variant.measurements) merged.measurements = variant.measurements
  return merged
}

/** Размеры вариантов товара David — для payload и для ревью. */
export function davidProductVariantAttributes(product: Pick<DavidCatalogProduct, 'variants'>) {
  return davidVariantAttributes(product.variants)
}

/**
 * Товар для Rails.
 *
 * Цена всегда 0: у поставщика цена в USD и в рублях её ещё не назначили. Rails
 * сам отдаёт `price_on_request = true` при нулевой цене, поэтому витрина
 * показывает «Цена по запросу» и не даёт оформить заказ. Статус active —
 * требование «публиковать не скрывая»; индекс — `indexable`, чтобы карточки
 * David попадали в поиск витрины Chromoff.
 */
export function buildDavidRailsProductPayload(input: {
  handle: string
  name: string
  description: string
  h1?: string
  seoDescription?: string
  brandId: string
  categoryId: string
  gender?: string | null
  attributes?: Record<string, unknown>
  sizes?: string[]
  media: ReturnType<typeof buildDavidMediaPayload>
}) {
  const sizes = [...new Set((input.sizes || []).map((size) => String(size).trim()).filter(Boolean))]
  const externalId = davidExternalId(input.handle)
  return {
    external_id: externalId,
    name: input.name,
    description: input.description,
    h1: input.h1 || input.name,
    seo_description: input.seoDescription || '',
    price_cents: 0,
    currency: 'RUB',
    status: 'active',
    indexing_status: 'indexable',
    brand_id: input.brandId,
    category_id: input.categoryId,
    gender: input.gender || null,
    primary_supplier_name: DAVID_SUPPLIER_NAME,
    catalog_attributes: input.attributes || {},
    // Варианту нужен устойчивый SKU: без него Rails на каждом обновлении создаёт
    // новую строку размера, и в карточке появлялись два одинаковых размера
    // («US 5,5» и «US 5.5»). Флаг generated_from разрешает Rails удалять размеры,
    // которых больше нет у поставщика.
    variants: (sizes.length ? sizes : [null]).map((size) => ({
      sku: size ? `${externalId}-${davidSizeSkuSuffix(size)}` : undefined,
      size,
      color: null,
      price_cents: 0,
      status: 'active',
      metadata: { generated_from: 'catalog_attributes.sizes' },
    })),
    media: input.media,
    metadata: {
      source: 'david-studio',
      source_handle: input.handle,
      source_supplier_name: DAVID_SUPPLIER_NAME,
      storefront: 'chromoff',
      price_source: 'not_assigned',
    },
  }
}

import type { BatchAiLookup, BatchAiAttributeDefinition, BatchAiSettings } from '@/lib/batch-ai'
import { buildBatchAiUserPrompt, normalizeBatchAiOutput } from '@/lib/batch-ai'
import { normalizePhotoAlts } from '@/lib/product-media-seo'

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

/**
 * Инструкция поставщика для ИИ. Это source-specific знания, которые не повторяются
 * в общих правилах из «Настроек интеллекта».
 */
export const DAVID_STUDIO_AI_INSTRUCTION = [
  'Источник — David Studio (david-studio.com), украшения и аксессуары в стиле Chrome Hearts.',
  'Исходные тексты поставщика на английском: используй их как факты (тип изделия, камень, размер, фурнитура), но не переноси рекламные обороты и не переводи дословно.',
  'Изделия из серебра 925 пробы. Материал указывай только если он подтверждён исходным текстом или фотографией; состав, пробу и камни не выдумывай.',
  'Название, описание и альты — на русском. Название без бренда и артикула, с точным типом изделия и цветом или камнем, если он виден.',
  'Размеры колец и браслетов указаны на самом изделии, отдельные размерные варианты не создаются: размерный ряд не выдумывай.',
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
  const sizes = [...new Set(variants.map((variant) => String(variant.size || '').trim()).filter(Boolean))]

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
      sizes,
      source_url: product.url || `${DAVID_SOURCE}/products/${product.handle}`,
      source_price_usd_min: price.min || null,
      source_price_usd_max: price.max || null,
      source_supplier: DAVID_SUPPLIER_NAME,
    },
    variants: variants.map((variant) => ({
      title: variant.title || '',
      size: variant.size || null,
      price: variant.price ?? null,
    })),
  }
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
    attributes: input.attributes,
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

/** Товар для Rails: только Chromoff, поэтому status hidden и без индексации в основном магазине. */
export function buildDavidRailsProductPayload(input: {
  handle: string
  name: string
  description: string
  h1?: string
  seoDescription?: string
  priceRub: number
  brandId: string
  categoryId: string
  gender?: string | null
  attributes?: Record<string, unknown>
  media: ReturnType<typeof buildDavidMediaPayload>
}) {
  const priceCents = Math.max(0, Math.round(input.priceRub)) * 100
  return {
    external_id: davidExternalId(input.handle),
    name: input.name,
    description: input.description,
    h1: input.h1 || input.name,
    seo_description: input.seoDescription || '',
    price_cents: priceCents,
    currency: 'RUB',
    status: 'hidden',
    indexing_status: 'noindex',
    brand_id: input.brandId,
    category_id: input.categoryId,
    gender: input.gender || null,
    primary_supplier_name: DAVID_SUPPLIER_NAME,
    catalog_attributes: input.attributes || {},
    variants: [{ size: null, color: null, price_cents: priceCents, status: 'active' }],
    media: input.media,
    metadata: {
      source: 'david-studio',
      source_handle: input.handle,
      source_supplier_name: DAVID_SUPPLIER_NAME,
      storefront: 'chromoff',
    },
  }
}

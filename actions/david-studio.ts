'use server'

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { scrapingQuery } from '@/lib/db'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import {
  createRailsChromoffListing,
  getRailsCatalogLookups,
  listRailsChromoffCategories,
  listRailsChromoffListings,
  railsFetch,
} from '@/lib/rails-admin'
import { buildBatchAiContactSheets, runBatchAiOpenRouter } from '@/lib/batch-ai'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'
import { enqueuePhotoCleanJobs, listPhotoCleanJobs, photoCleanStats } from '@/lib/photo-clean-jobs'
import {
  DAVID_BRAND_NAME,
  DAVID_SUPPLIER_NAME,
  buildDavidAiPrompt,
  buildDavidMediaPayload,
  buildDavidRailsProductPayload,
  davidPriceRange,
  normalizeDavidAiOutput,
  type DavidCatalogProduct,
} from '@/lib/david-studio-import'

const CATALOG_FILE = path.join(process.cwd(), 'data', 'david-studio', 'catalog.json')

async function loadCatalog(): Promise<{ products: DavidCatalogProduct[] }> {
  const parsed = JSON.parse(await readFile(CATALOG_FILE, 'utf8'))
  return { products: Array.isArray(parsed.products) ? parsed.products : [] }
}

export async function getDavidProductAction(handle: string) {
  const catalog = await loadCatalog()
  const product = catalog.products.find((item) => item.handle === handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  const draft = await getDavidDraftAction(handle)
  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 })
  return {
    success: true as const,
    data: { product, draft: draft.data, photos, price: davidPriceRange(product) },
  }
}

export async function getDavidDraftAction(handle: string) {
  const result = await scrapingQuery('SELECT * FROM david_import_drafts WHERE handle=$1', [handle])
  return { success: true as const, data: result.rows[0] || null }
}

export async function getDavidQueueStatsAction() {
  return { success: true as const, data: await photoCleanStats(DAVID_SUPPLIER_NAME) }
}

/** Поиск товара Chromoff, к которому привязываем фото David. */
export async function searchChromoffProductsAction(query: string) {
  const result = await listRailsChromoffListings({ search: query.trim(), perPage: 20, page: 1, published: true })
  return {
    success: true as const,
    data: result.items.map((listing: any) => ({
      id: String(listing.product_id || listing.product?.id || ''),
      listingId: String(listing.id || ''),
      name: String(listing.product?.name || listing.name || ''),
      photos: Array.isArray(listing.media) ? listing.media.length : Array.isArray(listing.product?.media) ? listing.product.media.length : 0,
      category: String(listing.chromoff_category?.name || ''),
      price: Number(listing.product?.price || 0),
    })).filter((item: any) => item.id),
  }
}

/** Ставит все фото товара David в очередь на чистку от вотермарки. */
export async function startDavidPhotoCleaningAction(handle: string) {
  const catalog = await loadCatalog()
  const product = catalog.products.find((item) => item.handle === handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  if (!product.images?.length) return { success: false as const, error: 'У товара нет фотографий' }

  const queued = await enqueuePhotoCleanJobs({
    supplier: DAVID_SUPPLIER_NAME,
    sourceProduct: handle,
    photos: product.images.map((image, index) => ({ url: image.src, position: image.position ?? index + 1 })),
  })

  await ensureDavidDraft(handle, 'new', null, product)
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: queued }
}

async function ensureDavidDraft(handle: string, mode: string, targetProductId: string | null,
                               sourceProduct: DavidCatalogProduct) {
  await scrapingQuery(
    `INSERT INTO david_import_drafts (id, handle, mode, target_product_id, source_product)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (handle) DO UPDATE
       SET mode=EXCLUDED.mode,
           target_product_id=EXCLUDED.target_product_id,
           source_product=EXCLUDED.source_product,
           updated_at=NOW()`,
    [randomUUID(), handle, mode, targetProductId, JSON.stringify(sourceProduct)],
  )
}

/** Готовит черновик: очищенные фото → контактные листы → ИИ → поля для ревью. */
export async function generateDavidDraftAction(handle: string, targetProductId: string | null = null) {
  const catalog = await loadCatalog()
  const product = catalog.products.find((item) => item.handle === handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }

  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 })
  const ready = photos.filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
  if (!ready.length) {
    return { success: false as const, error: 'Нет очищенных фото: сначала поставьте их в очередь и дождитесь воркера' }
  }

  await ensureDavidDraft(handle, targetProductId ? 'existing' : 'new', targetProductId, product)

  const [settingsResult, lookups, chromoffCategories, attributes] = await Promise.all([
    getBatchAiSettingsAction(),
    getRailsCatalogLookups(),
    listRailsChromoffCategories(),
    getCatalogAttributeDefinitions(),
  ])
  if (!settingsResult.success || !settingsResult.data) {
    return { success: false as const, error: 'Не удалось прочитать настройки ИИ' }
  }
  const settings = settingsResult.data as any

  const photoUrls = ready.map((photo) => photo.s3CleanUrl as string)
  const { promptProduct, userPrompt } = buildDavidAiPrompt({
    product,
    photos: photoUrls,
    settings,
    brands: lookups.brands as any,
    categories: lookups.categories as any,
    subcategories: lookups.subcategories as any,
    attributes,
    chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
  })

  const contactSheets = await buildBatchAiContactSheets(photoUrls, {
    additionalHosts: ['static.yeezyunique.ru'],
  })
  const raw = await runBatchAiOpenRouter({
    settings,
    systemPrompt: settings.systemPrompt,
    userPrompt,
    contactSheets,
  })

  const normalized = normalizeDavidAiOutput(raw, {
    promptProduct,
    brands: lookups.brands as any,
    categories: lookups.categories as any,
    subcategories: lookups.subcategories as any,
    attributeCodes: attributes.map((definition) => definition.code),
    chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
  }) as any

  const aiOutput = {
    name: normalized?.product?.name || '',
    description: normalized?.product?.description || '',
    brand: normalized?.product?.brand || '',
    category: normalized?.product?.category || '',
    subcategory: normalized?.product?.subcategory || '',
    gender: normalized?.product?.gender || null,
    attributes: normalized?.product?.catalog_attributes || {},
    photoAlts: normalized?.product?.photo_alts || [],
    chromoffCategory: normalized?.product?.attributes?.chromoff_category_id
      ? {
          id: normalized.product.attributes.chromoff_category_id,
          name: normalized.product.attributes.chromoff_category_name || '',
          confidence: normalized.product.attributes.chromoff_category_confidence || 0,
          status: normalized.product.attributes.chromoff_category_status || 'needs_review',
        }
      : null,
    raw: normalized,
  }

  await scrapingQuery(
    `UPDATE david_import_drafts
        SET ai_output=$2::jsonb, status='ai_ready', error=NULL, updated_at=NOW()
      WHERE handle=$1`,
    [handle, JSON.stringify(aiOutput)],
  )
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: aiOutput }
}

/** Создаёт hidden-товар в Rails и опубликованный Chromoff-листинг с медиа и альтами. */
export async function createDavidChromoffProductAction(input: {
  handle: string
  name: string
  description: string
  priceRub: number
  categoryId: string
  chromoffCategoryId: string
  gender?: string | null
  attributes?: Record<string, unknown>
  photoAlts?: string[]
  seoDescription?: string
  published?: boolean
}) {
  const catalog = await loadCatalog()
  const product = catalog.products.find((item) => item.handle === input.handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  if (!input.priceRub || input.priceRub <= 0) return { success: false as const, error: 'Укажите цену в рублях' }
  if (!input.chromoffCategoryId) return { success: false as const, error: 'Выберите категорию Chromoff' }
  if (!input.categoryId) return { success: false as const, error: 'Выберите категорию каталога' }

  const lookups = await getRailsCatalogLookups()
  const brand = lookups.brands.find(
    (item: any) => String(item.name || '').trim().toLocaleLowerCase('ru-RU') === DAVID_BRAND_NAME.toLocaleLowerCase('ru-RU'),
  )
  if (!brand) return { success: false as const, error: `В справочнике нет бренда «${DAVID_BRAND_NAME}»` }

  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: input.handle, limit: 200 })
  const ready = photos
    .filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
    .map((photo) => ({ url: photo.s3CleanUrl as string, position: photo.sourcePosition }))
  if (!ready.length) return { success: false as const, error: 'Нет очищенных фото для товара' }

  const media = buildDavidMediaPayload(ready, input.photoAlts || [], input.name)
  const payload = buildDavidRailsProductPayload({
    handle: input.handle,
    name: input.name,
    description: input.description,
    seoDescription: input.seoDescription,
    priceRub: input.priceRub,
    brandId: String((brand as any).id),
    categoryId: input.categoryId,
    gender: input.gender || null,
    attributes: input.attributes || {},
    media,
  })

  const created = await railsFetch<{ product: any }>('/admin/products', {
    method: 'POST',
    body: JSON.stringify({ product: payload }),
  })
  const productId = String(created.product?.id || '')
  if (!productId) return { success: false as const, error: 'Rails не вернул созданный товар' }

  const listing = await createRailsChromoffListing({
    productId,
    chromoffCategoryId: input.chromoffCategoryId,
    published: input.published !== false,
  })

  await scrapingQuery(
    `UPDATE david_import_drafts
        SET status='created', rails_product_id=$2, chromoff_listing_id=$3, edited=$4::jsonb, updated_at=NOW()
      WHERE handle=$1`,
    [input.handle, productId, String(listing?.id || ''), JSON.stringify({ media, attributes: input.attributes || {} })],
  )
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: { productId, listingId: String(listing?.id || ''), photos: media.length },
  }
}

/** Привязывает очищенные фото David к существующему товару Chromoff, не трогая его поля. */
export async function attachDavidPhotosAction(input: {
  handle: string
  productId: string
  photoAlts?: string[]
}) {
  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: input.handle, limit: 200 })
  const ready = photos
    .filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
    .map((photo) => ({ url: photo.s3CleanUrl as string, position: photo.sourcePosition, sourceKey: photo.sourceKey }))
  if (!ready.length) return { success: false as const, error: 'Нет очищенных фото для товара' }

  const current = await railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(input.productId)}`)
  const existingMedia = Array.isArray(current.product?.media) ? current.product.media : []
  const existingUrls = new Set(existingMedia.map((medium: any) => String(medium.original_url || '')))

  const added = ready.filter((photo) => !existingUrls.has(photo.url))
  if (!added.length) return { success: true as const, data: { added: 0, skipped: ready.length } }

  const media = buildDavidMediaPayload(
    added.map((photo) => ({ url: photo.url, position: photo.position })),
    input.photoAlts || [],
    String(current.product?.name || ''),
  )
  const merged = [
    ...existingMedia,
    ...media.map((medium, index) => ({ ...medium, sort_order: existingMedia.length + index })),
  ]

  await railsFetch(`/admin/products/${encodeURIComponent(input.productId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ product: { media: merged } }),
  })
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: { added: media.length, skipped: ready.length - added.length } }
}

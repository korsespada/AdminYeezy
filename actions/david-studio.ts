'use server'

import { revalidatePath } from 'next/cache'
import { scrapingQuery } from '@/lib/db'
import {
  createRailsChromoffListing,
  getRailsCatalogLookups,
  listRailsChromoffListings,
  railsFetch,
} from '@/lib/rails-admin'
import { enqueuePhotoCleanJobs, listPhotoCleanJobs, photoCleanStats } from '@/lib/photo-clean-jobs'
import {
  DAVID_BRAND_NAME,
  DAVID_SUPPLIER_NAME,
  buildDavidMediaPayload,
  buildDavidRailsProductPayload,
  davidPriceRange,
  davidProductVariantAttributes,
  mergeDavidCatalogAttributes,
} from '@/lib/david-studio-import'
import {
  ensureDavidDraft,
  enqueueDavidDraftJob,
  getDavidAiJobState,
  getDavidCatalogProduct,
  getDavidDraft,
} from '@/lib/david-studio-ai'

/**
 * Экшены импорта David Studio.
 *
 * Модель здесь не вызывается: экшен кладёт ИИ-задание в очередь, а его забирает
 * локальный воркер. Так на проде не нужны ни модель, ни ключи к ней.
 */

export async function getDavidProductAction(handle: string) {
  const product = await getDavidCatalogProduct(handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  const [draft, photos, job] = await Promise.all([
    getDavidDraft(handle),
    listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 }),
    getDavidAiJobState(handle),
  ])
  return {
    success: true as const,
    data: { product, draft, photos, job, price: davidPriceRange(product) },
  }
}

export async function getDavidDraftAction(handle: string) {
  const [draft, job] = await Promise.all([getDavidDraft(handle), getDavidAiJobState(handle)])
  return { success: true as const, data: { draft, job } }
}

export async function getDavidQueueStatsAction() {
  return { success: true as const, data: await photoCleanStats(DAVID_SUPPLIER_NAME) }
}

/** Поиск товара Chromoff, к которому привязываем фото и характеристики David. */
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
      // Признак нашего товара: по нему ревью понимает, что цена должна стать 0.
      externalId: String(listing.product?.external_id || ''),
      attributes: listing.product?.catalog_attributes && typeof listing.product.catalog_attributes === 'object'
        ? listing.product.catalog_attributes
        : {},
    })).filter((item: any) => item.id),
  }
}

/** Ставит все фото товара David в очередь на чистку от вотермарки. */
export async function startDavidPhotoCleaningAction(handle: string) {
  const product = await getDavidCatalogProduct(handle)
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

export interface DavidBatchCleaningResult {
  products: number
  created: number
  existing: number
  photos: number
}

/** Массовая постановка фото выбранных товаров: чистка идёт в фоне у воркера. */
export async function startDavidPhotoCleaningBatchAction(handles: string[]): Promise<
  { success: true; data: DavidBatchCleaningResult } | { success: false; error: string }
> {
  const unique = [...new Set((handles || []).map((handle) => String(handle || '').trim()).filter(Boolean))]
  if (!unique.length) return { success: false as const, error: 'Не выбрано ни одного товара' }

  let created = 0
  let existing = 0
  let photos = 0
  let products = 0

  for (const handle of unique) {
    const product = await getDavidCatalogProduct(handle)
    if (!product?.images?.length) continue
    products += 1
    photos += product.images.length
    const queued = await enqueuePhotoCleanJobs({
      supplier: DAVID_SUPPLIER_NAME,
      sourceProduct: handle,
      photos: product.images.map((image, index) => ({ url: image.src, position: image.position ?? index + 1 })),
    })
    created += queued.created
    existing += queued.existing
    await ensureDavidDraft(handle, 'new', null, product)
  }

  if (!products) return { success: false as const, error: 'У выбранных товаров нет фотографий' }
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: { products, created, existing, photos } }
}

/**
 * Кладёт ИИ-задание в очередь. Ответ модели придёт от локального воркера,
 * сервер его нормализует и запишет в черновик.
 */
export async function generateDavidDraftAction(handle: string, targetProductId: string | null = null) {
  const result = await enqueueDavidDraftJob(handle, targetProductId)
  if (!result.success) return result
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: { ...result.data, queued: true, message: 'Задание ИИ в очереди: его заберёт локальный воркер' },
  }
}

/** Повтор задания после ошибки: очередь отдаёт его заново. */
export async function retryDavidDraftAction(handle: string, targetProductId: string | null = null) {
  return generateDavidDraftAction(handle, targetProductId)
}

/** Создаёт товар в Rails и Chromoff-листинг: цена 0, размеры и замеры из вариантов David. */
export async function createDavidChromoffProductAction(input: {
  handle: string
  name: string
  description: string
  categoryId: string
  chromoffCategoryId: string
  gender?: string | null
  attributes?: Record<string, unknown>
  photoAlts?: string[]
  seoDescription?: string
  published?: boolean
}) {
  const product = await getDavidCatalogProduct(input.handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  if (!input.chromoffCategoryId) return { success: false as const, error: 'Не определена категория Chromoff' }
  if (!input.categoryId) return { success: false as const, error: 'Не определена категория каталога' }
  if (!String(input.name || '').trim()) return { success: false as const, error: 'Пустое название' }

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

  const variantAttributes = davidProductVariantAttributes(product)
  const attributes: Record<string, unknown> = {
    ...mergeDavidCatalogAttributes(input.attributes || {}, variantAttributes),
    price_source: 'not_assigned',
  }
  const media = buildDavidMediaPayload(ready, input.photoAlts || [], input.name)
  const payload = buildDavidRailsProductPayload({
    handle: input.handle,
    name: input.name,
    description: input.description,
    seoDescription: input.seoDescription,
    brandId: String((brand as any).id),
    categoryId: input.categoryId,
    gender: input.gender || null,
    attributes,
    sizes: variantAttributes.sizes,
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
    [input.handle, productId, String(listing?.id || ''), JSON.stringify({ media, attributes })],
  )
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: {
      productId,
      listingId: String(listing?.id || ''),
      photos: media.length,
      sizes: variantAttributes.sizes,
      attributes: Object.keys(attributes),
    },
  }
}

/**
 * Дозапись к существующему товару: фото, характеристики и замеры.
 *
 * «Не перетирая то, что там есть» — каждое поле пишется только если у товара
 * оно пустое; существующие значения остаются и перечисляются в отчёте.
 * Цену трогаем только по явному требованию оператора.
 */
export async function attachDavidPhotosAction(input: {
  handle: string
  productId: string
  photoAlts?: string[]
  attributes?: Record<string, unknown>
  zeroPrice?: boolean
  publish?: boolean
}) {
  const product = await getDavidCatalogProduct(input.handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }

  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: input.handle, limit: 200 })
  const ready = photos
    .filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
    .map((photo) => ({ url: photo.s3CleanUrl as string, position: photo.sourcePosition }))
  if (!ready.length) return { success: false as const, error: 'Нет очищенных фото для товара' }

  const current = await railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(input.productId)}`)
  const target = current.product
  if (!target?.id) return { success: false as const, error: 'Товар не найден в Rails' }

  const existingMedia = Array.isArray(target.media) ? target.media : []
  const existingUrls = new Set(existingMedia.map((medium: any) => String(medium.original_url || '')))
  const addedMedia = ready.filter((photo) => !existingUrls.has(photo.url))

  const variantAttributes = davidProductVariantAttributes(product)
  const candidateAttributes = mergeDavidCatalogAttributes(input.attributes || {}, variantAttributes)
  const existingAttributes: Record<string, unknown> = target.catalog_attributes && typeof target.catalog_attributes === 'object'
    ? target.catalog_attributes
    : {}
  const isEmpty = (value: unknown) => value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
  const attributesToWrite: Record<string, unknown> = {}
  const keptAttributes: string[] = []
  for (const [code, value] of Object.entries(candidateAttributes)) {
    if (isEmpty(value)) continue
    if (!isEmpty(existingAttributes[code])) {
      keptAttributes.push(code)
      continue
    }
    attributesToWrite[code] = value
  }

  const isDavidProduct = String(target.external_id || '').startsWith('david-studio-')
  const zeroPrice = input.zeroPrice === true
  const publish = input.publish === true
  const productPatch: Record<string, unknown> = {}
  // Скрытый товар не виден и в Chromoff: публикация включается явно.
  if (publish && String(target.status || '') !== 'active') productPatch.status = 'active'
  if (Object.keys(attributesToWrite).length) productPatch.catalog_attributes = { ...existingAttributes, ...attributesToWrite }
  if (addedMedia.length) {
    const media = buildDavidMediaPayload(
      addedMedia.map((photo) => ({ url: photo.url, position: photo.position })),
      input.photoAlts || [],
      String(target.name || ''),
    )
    productPatch.media = [
      ...existingMedia,
      ...media.map((medium, index) => ({ ...medium, sort_order: existingMedia.length + index })),
    ]
  }

  let zeroedVariants = 0
  if (zeroPrice) {
    productPatch.price_cents = 0
    const existingVariants = Array.isArray(target.variants) ? target.variants : []
    const variants = existingVariants
      .filter((variant: any) => String(variant.sku || '').trim())
      .map((variant: any) => ({
        sku: variant.sku,
        size: variant.size || null,
        color: variant.color || null,
        price_cents: 0,
        status: variant.status || 'active',
      }))
    const knownSizes = new Set(variants.map((variant: any) => variant.size).filter(Boolean))
    for (const size of variantAttributes.sizes) {
      if (knownSizes.has(size)) continue
      variants.push({ size, color: null, price_cents: 0, status: 'active' } as any)
    }
    productPatch.variants = variants.length ? variants : [{ size: null, color: null, price_cents: 0, status: 'active' }]
    zeroedVariants = variants.length
  }

  if (!Object.keys(productPatch).length) {
    return {
      success: true as const,
      data: {
        added: 0,
        skipped: ready.length,
        attributesWritten: [] as string[],
        attributesKept: keptAttributes,
        zeroedVariants: 0,
        isDavidProduct,
        message: 'Всё уже есть у товара: фото, характеристики и замеры',
      },
    }
  }

  await railsFetch(`/admin/products/${encodeURIComponent(input.productId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ product: productPatch }),
  })
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: {
      added: addedMedia.length,
      skipped: ready.length - addedMedia.length,
      attributesWritten: Object.keys(attributesToWrite),
      attributesKept: keptAttributes,
      zeroedVariants,
      sizes: variantAttributes.sizes,
      isDavidProduct,
      published: publish,
      message: [
        addedMedia.length ? `фото +${addedMedia.length}` : 'новых фото нет',
        Object.keys(attributesToWrite).length ? `характеристики: ${Object.keys(attributesToWrite).join(', ')}` : 'характеристик для записи нет',
        keptAttributes.length ? `сохранены прежние: ${keptAttributes.join(', ')}` : '',
        zeroPrice ? `цена 0 у товара и ${zeroedVariants} вариант(ов)` : '',
        publish ? 'товар опубликован' : '',
      ].filter(Boolean).join('; '),
    },
  }
}

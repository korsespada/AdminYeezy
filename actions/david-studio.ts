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
import { buildBatchAiContactSheets, runBatchAiOpenRouter, GLOBAL_BATCH_AI_CATALOG_RULES } from '@/lib/batch-ai'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
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
  davidReadyPhotos,
  getDavidCatalogProduct,
  getDavidDraft,
  markDavidDraftError,
  prepareDavidDraft,
  writeDavidDraftFromRaw,
} from '@/lib/david-studio-ai'
import {
  excludeDavidPhoto,
  listDavidPhotoExclusions,
  restoreDavidPhoto,
} from '@/lib/david-photo-exclusions'

/**
 * Экшены импорта David Studio.
 *
 * Черновик считает модель, выбранная в «Выгрузках» → «Настройки ИИ» (сейчас это
 * BYESU). Вызов идёт с сервера: провайдер BYESU — публичный API, ключи к нему
 * уже настроены в окружении прода.
 */

export async function getDavidProductAction(handle: string) {
  const product = await getDavidCatalogProduct(handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  const [draft, photos] = await Promise.all([
    getDavidDraft(handle),
    listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 }),
  ])
  return {
    success: true as const,
    data: { product, draft, photos, price: davidPriceRange(product) },
  }
}

export async function getDavidDraftAction(handle: string) {
  const draft = await getDavidDraft(handle)
  return { success: true as const, data: { draft } }
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

/**
 * Убирает очищенный кадр из импорта: он не попадёт ни в промпт ИИ, ни в товар.
 * Сам файл в S3 и задание чистки не трогаем — кадр можно вернуть.
 */
export async function excludeDavidPhotoAction(handle: string, sourceKey: string) {
  const key = String(sourceKey || '').trim()
  if (!key) return { success: false as const, error: 'Не указан кадр' }
  const excluded = await excludeDavidPhoto(handle, key)
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: { excluded, message: excluded ? 'Кадр убран из импорта' : 'Кадр уже был убран' },
  }
}

/** Возвращает убранный кадр обратно в импорт. */
export async function restoreDavidPhotoAction(handle: string, sourceKey: string) {
  const key = String(sourceKey || '').trim()
  if (!key) return { success: false as const, error: 'Не указан кадр' }
  const restored = await restoreDavidPhoto(handle, key)
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: { restored, message: restored ? 'Кадр возвращён в импорт' : 'Кадр не был убран' },
  }
}

/** Список убранных кадров товара — для блока «убранные» на экране ревью. */
export async function listDavidPhotoExclusionsAction(handle: string) {
  return { success: true as const, data: await listDavidPhotoExclusions(handle) }
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
 * Считает черновик моделью из «Выгрузок» → «Настройки ИИ» (сейчас BYESU).
 *
 * Вызов серверный: BYESU — публичный API, ключи к нему настроены в окружении
 * прода. Провайдер Cockpit доступен только с локального воркера, поэтому при
 * нём возвращаем понятную ошибку, а не непонятный таймаут.
 */
export async function generateDavidDraftAction(handle: string, targetProductId: string | null = null) {
  const settingsResult = await getBatchAiSettingsAction()
  if (!settingsResult.success || !settingsResult.data) {
    return { success: false as const, error: 'Не удалось прочитать настройки ИИ в «Выгрузках»' }
  }
  const settings = settingsResult.data as any
  const provider = String(settings.provider || '')

  const prepared = await prepareDavidDraft({ handle, targetProductId, settings })
  if (!prepared.success) return prepared

  if (provider === 'cockpit') {
    const error = 'Выбран провайдер Cockpit: он работает только через локальный воркер. Выберите BYESU или OpenRouter в «Выгрузках» → «Настройки ИИ».'
    await markDavidDraftError(handle, error)
    revalidatePath('/admin/chromoff/david-studio')
    return { success: false as const, error }
  }

  const model = provider === 'byesu' ? String(settings.byesuModel || '') : String(settings.openrouterModel || '')
  try {
    const contactSheets = await buildBatchAiContactSheets(prepared.data.photoUrls, {
      additionalHosts: ['static.yeezyunique.ru'],
    })
    const raw = await runBatchAiOpenRouter({
      settings,
      // Как и в «Выгрузках»: обязательные правила каталога действуют для всех
      // категорий и имеют приоритет над сохранённым системным промптом.
      systemPrompt: `${settings.systemPrompt || ''}\n\n${GLOBAL_BATCH_AI_CATALOG_RULES}`,
      userPrompt: prepared.data.userPrompt,
      contactSheets,
    })
    const written = await writeDavidDraftFromRaw({
      handle,
      raw,
      snapshot: prepared.data.snapshot,
    })
    revalidatePath('/admin/chromoff/david-studio')
    if (!written.success) return written
    return {
      success: true as const,
      data: {
        ...written.data,
        provider,
        model,
        photos: prepared.data.photoUrls.length,
        message: `Черновик посчитан: ${provider} / ${model}, фото ${prepared.data.photoUrls.length}`,
      },
    }
  } catch (error: any) {
    const message = String(error?.message || error || 'Модель недоступна')
    await markDavidDraftError(handle, message)
    revalidatePath('/admin/chromoff/david-studio')
    return { success: false as const, error: message }
  }
}

/** Повторный расчёт после ошибки: тот же путь, черновик перезаписывается. */
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

  const ready = await davidReadyPhotos(input.handle)
  if (!ready.length) {
    return {
      success: false as const,
      error: 'Нет очищенных фото для товара: возможно, все кадры убраны вручную',
    }
  }

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

  const ready = await davidReadyPhotos(input.handle)
  if (!ready.length) {
    return {
      success: false as const,
      error: 'Нет очищенных фото для товара: возможно, все кадры убраны вручную',
    }
  }

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

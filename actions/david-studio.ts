'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { scrapingQuery } from '@/lib/db'
import {
  createRailsChromoffListing,
  getRailsCatalogLookups,
  railsFetch,
} from '@/lib/rails-admin'
import {
  enqueuePhotoCleanJobs,
  listPhotoCleanJobs,
  photoCleanStats,
  requeueProblemPhotoCleanJobs,
  countProblemPhotoCleanJobs,
  markPhotoCleanManualBox,
  clearPhotoCleanManualBox,
} from '@/lib/photo-clean-jobs'
import { buildBatchAiContactSheets, runBatchAiOpenRouter, GLOBAL_BATCH_AI_CATALOG_RULES } from '@/lib/batch-ai'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import {
  DAVID_BRAND_NAME,
  DAVID_SUPPLIER_NAME,
  buildDavidMediaPayload,
  buildDavidRailsProductPayload,
  davidPriceRange,
  davidProductVariantAttributes,
  davidScopedPromptText,
  mergeDavidCatalogAttributes,
} from '@/lib/david-studio-import'
import {
  ensureDavidDraftRecord,
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

/** Сколько кадров нужно переочистить: «не найдена», «на глаза», сбои. */
export async function countDavidProblemPhotosAction(handle?: string | null) {
  return {
    success: true as const,
    data: await countProblemPhotoCleanJobs({
      supplier: DAVID_SUPPLIER_NAME,
      sourceProduct: handle || '',
    }),
  }
}

/**
 * Возвращает проблемные кадры в очередь, чтобы воркер прошёл их заново.
 * Без handle — по всем товарам David (кнопка в модалке очереди).
 */
export async function requeueDavidProblemPhotosAction(handle?: string | null) {
  const requeued = await requeueProblemPhotoCleanJobs({
    supplier: DAVID_SUPPLIER_NAME,
    sourceProduct: handle || '',
  })
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: {
      requeued,
      message: requeued ? `В очередь вернулось кадров: ${requeued}` : 'Проблемных кадров нет',
    },
  }
}

export async function startDavidPhotoCleaningAction(handle: string) {
  const product = await getDavidCatalogProduct(handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  if (!product.images?.length) return { success: false as const, error: 'У товара нет фотографий' }

  const queued = await enqueuePhotoCleanJobs({
    supplier: DAVID_SUPPLIER_NAME,
    sourceProduct: handle,
    photos: product.images.map((image, index) => ({ url: image.src, position: image.position ?? index + 1 })),
  })

  await ensureDavidDraftRecord(handle, product)
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

/**
 * Оператор сам обвёл вотермарку на кадре, который детектор не нашёл.
 * Задание возвращается в очередь с приоритетом: воркер берёт его раньше
 * остальных, а чистка идёт ровно по отмеченной рамке.
 */
export async function markDavidWatermarkAction(handle: string, sourceKey: string, box: {
  x1: number
  y1: number
  x2: number
  y2: number
}) {
  const key = String(sourceKey || '').trim()
  if (!key) return { success: false as const, error: 'Не указан кадр' }
  const width = Math.abs(Number(box.x1) - Number(box.x2))
  const height = Math.abs(Number(box.y1) - Number(box.y2))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0.02 || height < 0.01) {
    return { success: false as const, error: 'Обведите надпись рамкой' }
  }
  const marked = await markPhotoCleanManualBox({
    sourceKey: key,
    box: { x1: Number(box.x1), y1: Number(box.y1), x2: Number(box.x2), y2: Number(box.y2) },
  })
  if (!marked) return { success: false as const, error: 'Кадр не найден в очереди чистки' }
  revalidatePath('/admin/chromoff/david-studio')
  return {
    success: true as const,
    data: {
      marked: true,
      handle,
      message: 'Кадр в очереди вне очереди: воркер затирает отмеченную рамку',
    },
  }
}

/** Снимает ручную пометку: кадр снова пойдёт через автоопределение. */
export async function clearDavidWatermarkMarkAction(handle: string, sourceKey: string) {
  const key = String(sourceKey || '').trim()
  if (!key) return { success: false as const, error: 'Не указан кадр' }
  await clearPhotoCleanManualBox(key)
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: { message: 'Пометка снята' } }
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
    await ensureDavidDraftRecord(handle, product)
  }

  if (!products) return { success: false as const, error: 'У выбранных товаров нет фотографий' }
  revalidatePath('/admin/chromoff/david-studio')
  return { success: true as const, data: { products, created, existing, photos } }
}

/**
 * Считает черновик моделью из «Выгрузок» → «Настройки ИИ» (сейчас BYESU).
 *
 * Вызов серверный: BYESU — публичный API, ключи к нему настроены в окружении прода.
 */
/** Обновление списка из фонового расчёта: вне запроса revalidatePath может бросить — это не ошибка расчёта. */
function revalidateDavidPage() {
  try {
    revalidatePath('/admin/chromoff/david-studio')
  } catch {
    // список и так опрашивает сервер, пока очередь не пуста
  }
}

async function loadDavidAiSettings() {
  const settingsResult = await getBatchAiSettingsAction()
  if (!settingsResult.success || !settingsResult.data) return null
  return settingsResult.data as any
}

/**
 * Один расчёт черновика. Общий для кнопки в карточке и для фоновой пачки:
 * провайдер, модель, системный промпт и правила каталога — из «Выгрузок», но без
 * пунктов про одежду и обувь (David — только Chromoff).
 */
async function runDavidDraft(handle: string, settings: any) {
  const provider = String(settings.provider || '')

  const prepared = await prepareDavidDraft({ handle, settings })
  if (!prepared.success) {
    await markDavidDraftError(handle, prepared.error)
    return prepared
  }

  const model = provider === 'byesu' ? String(settings.byesuModel || '') : String(settings.openrouterModel || '')
  try {
    const contactSheets = await buildBatchAiContactSheets(prepared.data.photoUrls, {
      additionalHosts: ['static.yuconcierge.com'],
    })
    const raw = await runBatchAiOpenRouter({
      usageFeature: 'david_studio',
      settings,
      // Как и в «Выгрузках»: обязательные правила каталога действуют для всех
      // категорий и имеют приоритет над сохранённым системным промптом.
      systemPrompt: `${davidScopedPromptText(settings.systemPrompt)}\n\n${davidScopedPromptText(GLOBAL_BATCH_AI_CATALOG_RULES)}`,
      userPrompt: prepared.data.userPrompt,
      contactSheets,
    })
    const written = await writeDavidDraftFromRaw({
      handle,
      raw,
      snapshot: prepared.data.snapshot,
    })
    revalidateDavidPage()
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
    revalidateDavidPage()
    return { success: false as const, error: message }
  }
}

export async function generateDavidDraftAction(handle: string) {
  const settings = await loadDavidAiSettings()
  if (!settings) return { success: false as const, error: 'Не удалось прочитать настройки ИИ в «Выгрузках»' }
  return runDavidDraft(handle, settings)
}

/** Повторный расчёт после ошибки: тот же путь, черновик перезаписывается. */
export async function retryDavidDraftAction(handle: string) {
  return generateDavidDraftAction(handle)
}

// --- пакетный расчёт черновиков из списка выгрузки ----------------------------------
//
// Очередь — сами черновики: статус ai_queued → ai_running → ai_ready/ai_error.
// Обработчик работает в after() (ответ кнопке уходит сразу). Если процесс
// перезапустили посреди пачки, список при опросе вызывает resume: зависшие
// ai_running возвращаются в очередь, и обработчик стартует заново.

const DAVID_AI_STALE_MINUTES = 10
let davidAiQueueActive = false

async function claimNextDavidDraft(): Promise<string | null> {
  const claimed = await scrapingQuery(
    `UPDATE david_import_drafts
        SET status='ai_running', error=NULL, updated_at=NOW()
      WHERE id = (
        SELECT id FROM david_import_drafts
         WHERE status='ai_queued'
         ORDER BY updated_at, handle
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
    RETURNING handle`,
  )
  return claimed.rows[0]?.handle ? String(claimed.rows[0].handle) : null
}

async function processDavidAiQueue(settings: any) {
  if (davidAiQueueActive) return
  davidAiQueueActive = true
  try {
    // Не больше трёх потоков: каждый вызов тащит контактные листы и ждёт модель
    // минуту-две, а провайдер общий с «Выгрузками».
    const threads = Math.max(1, Math.min(3, Number(settings.concurrency) || 2))
    await Promise.all(Array.from({ length: threads }, async () => {
      for (;;) {
        const handle = await claimNextDavidDraft()
        if (!handle) return
        await runDavidDraft(handle, settings).catch((error) => markDavidDraftError(handle, String(error?.message || error)))
      }
    }))
  } finally {
    davidAiQueueActive = false
    revalidateDavidPage()
  }
}

/**
 * «Обработать ИИ выбранные»: ставит черновики в очередь и запускает расчёт в фоне.
 * Берутся только товары с очищенными фото и ещё не опубликованные в Chromoff.
 */
export async function queueDavidDraftsAction(handles: string[]) {
  const unique = [...new Set((handles || []).map((handle) => String(handle || '').trim()).filter(Boolean))].slice(0, 500)
  if (!unique.length) return { success: false as const, error: 'Не выбрано ни одного товара' }
  const settings = await loadDavidAiSettings()
  if (!settings) return { success: false as const, error: 'Не удалось прочитать настройки ИИ в «Выгрузках»' }

  let queued = 0
  let noPhotos = 0
  let published = 0
  for (const handle of unique) {
    const product = await getDavidCatalogProduct(handle)
    if (!product) continue
    const draft = await getDavidDraft(handle)
    if (draft?.rails_product_id) {
      published += 1
      continue
    }
    if (!(await davidReadyPhotos(handle)).length) {
      noPhotos += 1
      continue
    }
    await ensureDavidDraftRecord(handle, product)
    await scrapingQuery(
      `UPDATE david_import_drafts SET status='ai_queued', error=NULL, updated_at=NOW()
        WHERE handle=$1 AND status <> 'ai_running'`,
      [handle],
    )
    queued += 1
  }

  if (queued) after(() => processDavidAiQueue(settings))
  revalidatePath('/admin/chromoff/david-studio')
  const skipped = [
    noPhotos ? `без очищенных фото: ${noPhotos}` : '',
    published ? `уже опубликованы: ${published}` : '',
  ].filter(Boolean).join(', ')
  return {
    success: true as const,
    data: {
      queued,
      noPhotos,
      published,
      message: `В очередь ИИ: ${queued}${skipped ? ` (пропущено — ${skipped})` : ''}`,
    },
  }
}

/** Подхват очереди после перезапуска процесса: зовёт список выгрузки при опросе. */
export async function resumeDavidAiQueueAction() {
  await scrapingQuery(
    `UPDATE david_import_drafts SET status='ai_queued', updated_at=NOW()
      WHERE status='ai_running' AND updated_at < NOW() - ($1 || ' minutes')::interval`,
    [String(DAVID_AI_STALE_MINUTES)],
  )
  const state = await scrapingQuery(
    `SELECT COUNT(*) FILTER (WHERE status='ai_queued')::int AS queued,
            COUNT(*) FILTER (WHERE status='ai_running')::int AS running
       FROM david_import_drafts`,
  )
  const queued = Number(state.rows[0]?.queued || 0)
  const running = Number(state.rows[0]?.running || 0)
  // Пока кто-то считает, второй обработчик не нужен: свободный поток сам возьмёт очередь.
  if (queued && !running && !davidAiQueueActive) {
    const settings = await loadDavidAiSettings()
    if (settings) after(() => processDavidAiQueue(settings))
  }
  return { success: true as const, data: { queued, running } }
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
  /** Цена в рублях. Пусто или 0 — «Цена по запросу». */
  priceRub?: number | null
}) {
  const product = await getDavidCatalogProduct(input.handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }
  if (!input.chromoffCategoryId) return { success: false as const, error: 'Не определена категория Chromoff' }
  if (!input.categoryId) return { success: false as const, error: 'Не определена категория каталога' }
  if (!String(input.name || '').trim()) return { success: false as const, error: 'Пустое название' }
  const priceRub = Math.round(Number(input.priceRub) || 0)
  if (priceRub < 0 || priceRub > 100_000_000) return { success: false as const, error: 'Цена вне допустимого диапазона' }
  // Оператор цену видел и подтвердил: по правилу она или исправлена руками — для каталога это ручная цена.
  const priceSource = priceRub > 0 ? 'manual' : 'not_assigned'

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
    price_source: priceSource,
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
    priceRub,
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
        SET status='created', rails_product_id=$2, chromoff_listing_id=$3, edited=$4::jsonb, price_rub=$5, updated_at=NOW()
      WHERE handle=$1`,
    [input.handle, productId, String(listing?.id || ''), JSON.stringify({ media, attributes }), priceRub || null],
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
      priceRub,
      message: priceRub ? `цена ${priceRub.toLocaleString('ru-RU')} ₽` : 'цена по запросу',
    },
  }
}

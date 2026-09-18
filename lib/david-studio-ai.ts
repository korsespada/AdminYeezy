import { randomUUID } from 'node:crypto'
import { scrapingQuery } from '@/lib/db'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import { getRailsCatalogLookups, listRailsChromoffCategories } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions, filterCatalogAttributeDefinitionsForCategory } from '@/lib/catalog-attribute-registry'
import { listPhotoCleanJobs } from '@/lib/photo-clean-jobs'
import { enqueueDavidAiJob, failDavidAiJob, latestDavidAiJob, type DavidAiJob } from '@/lib/david-ai-jobs'
import { loadDavidStudioCatalog } from '@/lib/david-studio-catalog-server'
import {
  DAVID_SUPPLIER_NAME,
  buildDavidAiPrompt,
  davidProductVariantAttributes,
  mergeDavidCatalogAttributes,
  normalizeDavidAiOutput,
  type DavidCatalogProduct,
} from '@/lib/david-studio-import'

/**
 * Контур ИИ для импорта David Studio.
 *
 * На проде у AdminYeezy нет ни модели, ни ключей. Поэтому сервер только готовит
 * задание (промпт + снимок справочников) и кладёт его в очередь, модель вызывает
 * локальный воркер своими ключами, а нормализация ответа и запись черновика
 * снова происходят здесь. Снимок справочников хранится в самом задании, поэтому
 * завершение не зависит от доступности Rails в момент ответа модели.
 */

export interface DavidDraftAiOutput {
  name: string
  description: string
  h1: string
  seoTitle: string
  seoDescription: string
  brand: string
  category: string
  subcategory: string
  categoryName: string
  subcategoryName: string
  gender: string | null
  attributes: Record<string, unknown>
  sizes: string[]
  measurements: unknown
  photoAlts: string[]
  chromoffCategory: { id: string; name: string; confidence: number; status: string } | null
  raw: unknown
}

/** Черновик создаётся один раз на товар: это состояние экрана ревью. */
export async function ensureDavidDraft(
  handle: string,
  mode: string,
  targetProductId: string | null,
  sourceProduct: DavidCatalogProduct,
) {
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

export async function getDavidDraft(handle: string) {
  const result = await scrapingQuery('SELECT * FROM david_import_drafts WHERE handle=$1', [handle])
  return result.rows[0] || null
}

export async function getDavidCatalogProduct(handle: string): Promise<DavidCatalogProduct | null> {
  const catalog = loadDavidStudioCatalog()
  if (!catalog) return null
  return (catalog.products as DavidCatalogProduct[]).find((item) => item.handle === handle) || null
}

/**
 * Готовит задание ИИ: промпт, адреса очищенных фото и снимок справочников.
 * Модель здесь не вызывается — её вызовет локальный воркер.
 */
export async function enqueueDavidDraftJob(handle: string, targetProductId: string | null = null) {
  const product = await getDavidCatalogProduct(handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }

  const photos = await listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 })
  const ready = photos
    .filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
    .sort((left, right) => (left.sourcePosition || 0) - (right.sourcePosition || 0))
  if (!ready.length) {
    return { success: false as const, error: 'Нет очищенных фото: сначала поставьте их в очередь и дождитесь воркера' }
  }

  await ensureDavidDraft(handle, targetProductId ? 'existing' : 'new', targetProductId, product)

  const [settingsResult, lookups, chromoffCategories, attributeDefinitions] = await Promise.all([
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
    attributes: attributeDefinitions as any,
    chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
  })

  const job = await enqueueDavidAiJob({
    handle,
    payload: {
      handle,
      targetProductId,
      userPrompt,
      systemPrompt: String(settings.systemPrompt || ''),
      photoUrls,
      temperature: Number(settings.temperature) || 0.1,
      maxTokens: Number(settings.maxTokens) || 5000,
      promptProduct,
      // Исходные варианты David: из них детерминированно собираются размеры в
      // сантиметрах и строка замеров, поэтому в снимке нужны именно они.
      productVariants: product.variants || [],
      brands: lookups.brands,
      categories: lookups.categories,
      subcategories: lookups.subcategories,
      chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
      attributeCodes: attributeDefinitions.map((definition) => definition.code),
      attributeDefinitions,
      createdAt: new Date().toISOString(),
    },
  })

  await scrapingQuery(
    `UPDATE david_import_drafts SET status='ai_queued', error=NULL, updated_at=NOW() WHERE handle=$1`,
    [handle],
  )
  return { success: true as const, data: { jobId: job.id, replaced: job.replaced, photos: photoUrls.length } }
}

function lookupName(rows: any[], id: unknown) {
  const value = String(id || '')
  if (!value) return ''
  return String(rows?.find((row) => String(row.id) === value)?.name || '')
}

/** Характеристики только по схеме выбранной категории — требование ревью. */
export function filterDavidAttributesForCategory(
  definitions: any[],
  categoryName: string,
  subcategoryName: string,
  attributes: Record<string, unknown> | null | undefined,
) {
  const allowed = new Set(
    filterCatalogAttributeDefinitionsForCategory(definitions as any, categoryName, subcategoryName)
      .map((definition) => definition.code),
  )
  const result: Record<string, unknown> = {}
  for (const [code, value] of Object.entries(attributes || {})) {
    // Служебные ключи Chromoff и медиа не входят в реестр, но нужны payload.
    if (allowed.has(code) || code.startsWith('chromoff_')) result[code] = value
  }
  return result
}

/**
 * Нормализует ответ модели и записывает черновик. Ошибка нормализации не
 * теряется: она попадает в задание и в текст черновика, чтобы её было видно в UI.
 */
export async function completeDavidDraftJob(input: { jobId: string; leaseToken: string; output: unknown }) {
  const jobResult = await scrapingQuery(
    `SELECT * FROM david_ai_jobs WHERE id=$1 AND status='claimed'`,
    [input.jobId],
  )
  const row = jobResult.rows[0]
  if (!row) return { success: false as const, leaseLost: true, error: 'Задание не найдено или lease потерян' }
  const snapshot = (row.input && typeof row.input === 'object' ? row.input : {}) as Record<string, any>

  try {
    const normalized: any = normalizeDavidAiOutput(input.output, {
      promptProduct: snapshot.promptProduct,
      brands: snapshot.brands || [],
      categories: snapshot.categories || [],
      subcategories: snapshot.subcategories || [],
      attributeCodes: snapshot.attributeCodes || [],
      chromoffCategories: snapshot.chromoffCategories || [],
    })
    const proposed = normalized?.product || {}

    const categoryName = lookupName(snapshot.categories, proposed.category)
    const subcategoryName = lookupName(snapshot.subcategories, proposed.subcategory)
    // normalizeBatchAiOutput отдаёт характеристики в product.attributes:
    // чтение product.catalog_attributes молча теряло весь ответ модели.
    const scopedAttributes = filterDavidAttributesForCategory(
      snapshot.attributeDefinitions || [],
      categoryName,
      subcategoryName,
      proposed.attributes,
    )
    const variantAttributes = davidProductVariantAttributes({
      variants: snapshot.productVariants || snapshot.promptProduct?.variants || [],
    })
    const attributes = mergeDavidCatalogAttributes(scopedAttributes, variantAttributes)

    const aiOutput: DavidDraftAiOutput = {
      name: String(proposed.name || ''),
      description: String(proposed.description || ''),
      h1: String(proposed.h1 || ''),
      seoTitle: String(proposed.seo_title || ''),
      seoDescription: String(proposed.seo_description || ''),
      brand: String(proposed.brand || ''),
      category: String(proposed.category || ''),
      subcategory: String(proposed.subcategory || ''),
      categoryName,
      subcategoryName,
      gender: proposed.gender || null,
      attributes,
      sizes: variantAttributes.sizes,
      measurements: variantAttributes.measurements,
      photoAlts: Array.isArray(proposed.photo_alts) ? proposed.photo_alts.map(String) : [],
      chromoffCategory: attributes.chromoff_category_id
        ? {
            id: String(attributes.chromoff_category_id),
            name: String(attributes.chromoff_category_name || ''),
            confidence: Number(attributes.chromoff_category_confidence || 0),
            status: String(attributes.chromoff_category_status || 'needs_review'),
          }
        : null,
      raw: normalized,
    }

    const written = await scrapingQuery(
      `UPDATE david_import_drafts
          SET ai_output=$2::jsonb, status='ai_ready', error=NULL, updated_at=NOW()
        WHERE handle=$1
      RETURNING id`,
      [String(row.handle), JSON.stringify(aiOutput)],
    )
    // Молчаливый UPDATE здесь означал бы «модель ответила, а черновика нет».
    if (!written.rowCount) throw new Error('Черновик товара не найден: задание ИИ поставлено без черновика')
    return { success: true as const, data: aiOutput }
  } catch (error: any) {
    const message = String(error?.message || error || 'Не удалось нормализовать ответ модели')
    await scrapingQuery(
      `UPDATE david_import_drafts SET status='ai_error', error=$2, updated_at=NOW() WHERE handle=$1`,
      [String(row.handle), message.slice(0, 2000)],
    ).catch(() => undefined)
    return { success: false as const, leaseLost: false, error: message }
  }
}

/** Ошибка модели видна и в задании, и в черновике — интерфейс читает оба. */
export async function failDavidDraftJob(input: { jobId: string; leaseToken: string; error: string }) {
  const jobResult = await scrapingQuery('SELECT handle FROM david_ai_jobs WHERE id=$1', [input.jobId])
  const handle = jobResult.rows[0]?.handle
  const failed = await failDavidAiJob(input.jobId, input.leaseToken, input.error)
  if (handle) {
    await scrapingQuery(
      `UPDATE david_import_drafts SET status='ai_error', error=$2, updated_at=NOW() WHERE handle=$1`,
      [String(handle), String(input.error || 'Ошибка модели').slice(0, 2000)],
    )
  }
  return { success: failed }
}

export async function getDavidAiJobState(handle: string): Promise<DavidAiJob | null> {
  return latestDavidAiJob(handle)
}

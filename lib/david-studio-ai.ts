import { randomUUID } from 'node:crypto'
import { scrapingQuery } from '@/lib/db'
import { getRailsCatalogLookups, listRailsChromoffCategories } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions, filterCatalogAttributeDefinitionsForCategory } from '@/lib/catalog-attribute-registry'
import { listPhotoCleanJobs } from '@/lib/photo-clean-jobs'
import { listDavidPhotoExclusions } from '@/lib/david-photo-exclusions'
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
 * Черновик импорта David Studio.
 *
 * Модель вызывает сам прод (серверный экшен) тем провайдером, который выбран в
 * «Выгрузках» — сейчас это BYESU. Здесь живут только подготовка промпта и
 * нормализация ответа: снимок справочников передаётся в нормализацию целиком,
 * поэтому она не зависит от повторных запросов к Rails.
 */

export interface DavidAiSnapshot {
  promptProduct: Record<string, any>
  productVariants: unknown[]
  brands: any[]
  categories: any[]
  subcategories: any[]
  chromoffCategories: Array<{ id: string; name: string }>
  attributeCodes: string[]
  attributeDefinitions: any[]
}

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

/**
 * Создаёт черновик, если его ещё нет, и обновляет только снимок товара.
 *
 * Нужен постановке фото в очередь чистки: она не выбирает режим импорта, поэтому
 * не должна затирать уже сделанный выбор оператора (`mode`, `target_product_id`).
 */
export async function ensureDavidDraftRecord(handle: string, sourceProduct: DavidCatalogProduct) {
  await scrapingQuery(
    `INSERT INTO david_import_drafts (id, handle, mode, target_product_id, source_product)
     VALUES ($1,$2,'new',NULL,$3::jsonb)
     ON CONFLICT (handle) DO UPDATE
       SET source_product=EXCLUDED.source_product,
           updated_at=NOW()`,
    [randomUUID(), handle, JSON.stringify(sourceProduct)],
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

/** Очищенные фото товара по порядку, без удалённых оператором — источник для ИИ. */
export async function davidReadyPhotos(handle: string): Promise<Array<{
  url: string
  position: number | null
  sourceKey: string
}>> {
  const [photos, excluded] = await Promise.all([
    listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 }),
    listDavidPhotoExclusions(handle).catch(() => [] as string[]),
  ])
  const excludedKeys = new Set(excluded)
  return photos
    .filter((photo) => photo.status === 'done' && photo.s3CleanUrl && !excludedKeys.has(photo.sourceKey))
    .sort((left, right) => (left.sourcePosition || 0) - (right.sourcePosition || 0))
    .map((photo) => ({
      url: photo.s3CleanUrl as string,
      position: photo.sourcePosition,
      sourceKey: photo.sourceKey,
    }))
}

/** Адреса очищенных фото для промпта и payload. */
export async function davidReadyPhotoUrls(handle: string): Promise<string[]> {
  return (await davidReadyPhotos(handle)).map((photo) => photo.url)
}

/**
 * Готовит промпт и снимок справочников. Модель здесь не вызывается — это делает
 * серверный экшен провайдером из «Выгрузок».
 */
export async function prepareDavidDraft(input: {
  handle: string
  targetProductId: string | null
  settings: any
}): Promise<
  | { success: true; data: { promptProduct: Record<string, any>; userPrompt: string; photoUrls: string[]; snapshot: DavidAiSnapshot; product: DavidCatalogProduct } }
  | { success: false; error: string }
> {
  const product = await getDavidCatalogProduct(input.handle)
  if (!product) return { success: false as const, error: 'Товар David Studio не найден' }

  const photoUrls = await davidReadyPhotoUrls(input.handle)
  if (!photoUrls.length) {
    return { success: false as const, error: 'Нет очищенных фото: сначала поставьте их в очередь и дождитесь воркера' }
  }

  await ensureDavidDraft(input.handle, input.targetProductId ? 'existing' : 'new', input.targetProductId, product)

  const [lookups, chromoffCategories, attributeDefinitions] = await Promise.all([
    getRailsCatalogLookups(),
    listRailsChromoffCategories(),
    getCatalogAttributeDefinitions(),
  ])

  const { promptProduct, userPrompt } = buildDavidAiPrompt({
    product,
    photos: photoUrls,
    settings: input.settings,
    brands: lookups.brands as any,
    categories: lookups.categories as any,
    subcategories: lookups.subcategories as any,
    attributes: attributeDefinitions as any,
    chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
  })

  return {
    success: true as const,
    data: {
      promptProduct,
      userPrompt,
      photoUrls,
      product,
      snapshot: {
        promptProduct,
        // Исходные варианты David: из них детерминированно собираются размеры в
        // сантиметрах и строка замеров.
        productVariants: product.variants || [],
        brands: lookups.brands,
        categories: lookups.categories,
        subcategories: lookups.subcategories,
        chromoffCategories: chromoffCategories.map((category) => ({ id: category.id, name: category.name })),
        attributeCodes: attributeDefinitions.map((definition) => definition.code),
        attributeDefinitions,
      },
    },
  }
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
    // Служебные ключи Chromoff не входят в реестр, но нужны payload.
    if (allowed.has(code) || code.startsWith('chromoff_')) result[code] = value
  }
  return result
}

/** Собирает поля ревью из ответа модели: категории, характеристики, размеры, замеры. */
export function buildDavidDraftAiOutput(raw: unknown, snapshot: DavidAiSnapshot): DavidDraftAiOutput {
  const normalized: any = normalizeDavidAiOutput(raw, {
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
  const variantAttributes = davidProductVariantAttributes({ variants: (snapshot.productVariants || []) as any })
  const attributes = mergeDavidCatalogAttributes(scopedAttributes, variantAttributes)

  return {
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
}

/**
 * Записывает черновик. Ошибка нормализации не теряется: она попадает в
 * `david_import_drafts.error`, который показывает экран ревью.
 */
export async function writeDavidDraftFromRaw(input: {
  handle: string
  raw: unknown
  snapshot: DavidAiSnapshot
}): Promise<{ success: true; data: DavidDraftAiOutput } | { success: false; error: string }> {
  try {
    const aiOutput = buildDavidDraftAiOutput(input.raw, input.snapshot)
    const written = await scrapingQuery(
      `UPDATE david_import_drafts
          SET ai_output=$2::jsonb, status='ai_ready', error=NULL, updated_at=NOW()
        WHERE handle=$1
      RETURNING id`,
      [input.handle, JSON.stringify(aiOutput)],
    )
    // Молчаливый UPDATE здесь означал бы «модель ответила, а черновика нет».
    if (!written.rowCount) throw new Error('Черновик товара не найден')
    return { success: true as const, data: aiOutput }
  } catch (error: any) {
    const message = String(error?.message || error || 'Не удалось разобрать ответ модели')
    await scrapingQuery(
      `UPDATE david_import_drafts SET status='ai_error', error=$2, updated_at=NOW() WHERE handle=$1`,
      [input.handle, message.slice(0, 2000)],
    ).catch(() => undefined)
    return { success: false as const, error: message }
  }
}

/** Отмечает ошибку вызова модели: интерфейс читает её из черновика. */
export async function markDavidDraftError(handle: string, error: string) {
  await scrapingQuery(
    `UPDATE david_import_drafts SET status='ai_error', error=$2, updated_at=NOW() WHERE handle=$1`,
    [handle, String(error || 'Ошибка модели').slice(0, 2000)],
  ).catch(() => undefined)
}

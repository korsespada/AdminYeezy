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
  'Клатчи, ремни, картхолдеры и сумки описываются как обычный товар: конструкция, фактура, фурнитура и видимые детали важнее общих слов.',
].join('\n')

/**
 * David — только Chromoff: украшения, картхолдеры, ремни, брелоки, немного сумок.
 * В промпт идёт только то, куда его товары реально попадают; остальные справочники
 * и правила — десятки тысяч лишних символов на каждый товар.
 *
 * Категория каталога → разрешённые подкатегории (null — все). Картхолдеры, ремни,
 * брелоки и пуговицы в каталоге лежат в «Аксессуарах», поэтому оттуда берём только
 * эти три подкатегории.
 */
export const DAVID_CATALOG_SCOPE: Record<string, string[] | null> = {
  'Ювелирные изделия': null,
  Сумки: null,
  Аксессуары: ['Ремни', 'Кошельки и картхолдеры', 'Другое'],
}

/** Корни дерева Chromoff, которые берутся целиком (остальное — по категории каталога). */
export const DAVID_CHROMOFF_ROOTS = ['Изделия из серебра', 'Сумки']

/** Группы характеристик, которые David не нужны, если область состоит только из них. */
const DAVID_EXCLUDED_ATTRIBUTE_SCOPE_PARTS = ['Одежда', 'Обувь', 'Часы', 'Бижутерия', 'Чемоданы', 'Багаж']

const normalizedName = (value: unknown) => String(value || '').trim().toLocaleLowerCase('ru-RU')
const DAVID_CATEGORY_NAMES = new Set(Object.keys(DAVID_CATALOG_SCOPE).map(normalizedName))
const DAVID_EXCLUDED_ATTRIBUTE_PARTS = new Set(DAVID_EXCLUDED_ATTRIBUTE_SCOPE_PARTS.map(normalizedName))

export function isDavidCatalogCategoryName(name: unknown) {
  return DAVID_CATEGORY_NAMES.has(normalizedName(name))
}

/** Группа характеристик не нужна David, если её область — только одежда, обувь, часы и т. п. */
export function isDavidExcludedAttributeScope(scope: string) {
  const parts = String(scope || '').split(/,|\sи\s/u).map((part) => normalizedName(part)).filter(Boolean)
  return parts.length > 0 && parts.every((part) => DAVID_EXCLUDED_ATTRIBUTE_PARTS.has(part))
}

/** Родитель подкатегории в справочнике Rails лежит в `category` (у старых данных — в `parent_id`). */
export function davidSubcategoryParentId(subcategory: Record<string, any>) {
  return String(subcategory?.parent_id || subcategory?.category || '')
}

type RawLookup = Record<string, any>
type RawChromoffCategory = {
  id: string
  name: string
  parent_id?: string | null
  active?: boolean | null
  catalog_category?: { name?: string | null } | null
}

/**
 * Справочники для промпта David: только разрешённые категории, без SEO-текстов.
 * Бренд у David один и подставляется сервером, поэтому весь справочник брендов
 * (~38 тыс. символов) модели не нужен.
 */
export function davidPromptLookups(input: {
  brands: RawLookup[]
  categories: RawLookup[]
  subcategories: RawLookup[]
  chromoffCategories: RawChromoffCategory[]
}) {
  const scopeByName = new Map(Object.entries(DAVID_CATALOG_SCOPE).map(([name, subs]) => [
    normalizedName(name),
    subs ? new Set(subs.map(normalizedName)) : null,
  ]))
  const categories = input.categories
    .filter((category) => isDavidCatalogCategoryName(category.name))
    .map((category) => ({ id: String(category.id), name: String(category.name || '') }))
  const allowedSubsByCategoryId = new Map(
    categories.map((category) => [category.id, scopeByName.get(normalizedName(category.name)) ?? null]),
  )
  const subcategories = input.subcategories
    .filter((subcategory) => {
      const parentId = davidSubcategoryParentId(subcategory)
      if (!allowedSubsByCategoryId.has(parentId)) return false
      const allowed = allowedSubsByCategoryId.get(parentId)
      return !allowed || allowed.has(normalizedName(subcategory.name))
    })
    .map((subcategory) => ({
      id: String(subcategory.id),
      name: String(subcategory.name || ''),
      parent_id: davidSubcategoryParentId(subcategory),
    }))
  const brands = input.brands
    .filter((brand) => normalizedName(brand.name) === normalizedName(DAVID_BRAND_NAME))
    .map((brand) => ({ id: String(brand.id), name: String(brand.name || '') }))

  // Категории Chromoff — дерево. Берём включённые разделы под корнями
  // DAVID_CHROMOFF_ROOTS, а из остальных веток — только разделы, привязанные к
  // разрешённой подкатегории каталога (например «Аксессуары / Ремни»).
  const chromoffById = new Map(input.chromoffCategories.map((category) => [String(category.id), category]))
  const allowedCatalogNames = new Set(subcategories.map((subcategory) => normalizedName(subcategory.name)))
  const roots = new Set(DAVID_CHROMOFF_ROOTS.map(normalizedName))
  const chromoffActive = (category: RawChromoffCategory): boolean => {
    if (category.active === false) return false
    const parent = category.parent_id ? chromoffById.get(String(category.parent_id)) : null
    return parent ? chromoffActive(parent) : true
  }
  const chromoffRoot = (category: RawChromoffCategory): RawChromoffCategory => {
    const parent = category.parent_id ? chromoffById.get(String(category.parent_id)) : null
    return parent ? chromoffRoot(parent) : category
  }
  const chromoffCategories = input.chromoffCategories
    .filter((category) => chromoffActive(category) && (
      roots.has(normalizedName(chromoffRoot(category).name))
      || (Boolean(category.parent_id) && allowedCatalogNames.has(normalizedName(category.catalog_category?.name)))
    ))
    .map((category) => {
      const parent = category.parent_id ? chromoffById.get(String(category.parent_id)) : null
      return { id: String(category.id), name: parent ? `${parent.name} / ${category.name}` : String(category.name) }
    })

  return { brands, categories, subcategories, chromoffCategories }
}

/** Правила категорий «Настроек ИИ» только для категорий David. */
export function davidCategoryRules<T extends { categoryName: string }>(rules: T[] | null | undefined): T[] {
  return (rules || []).filter((rule) => isDavidCatalogCategoryName(rule.categoryName))
}

/**
 * Пункты общих промптов «Выгрузок», которые касаются только одежды и обуви:
 * размерные ряды, комплекты, таблицы замеров, примеры текстов про худи и пуховик.
 * Сопоставление по началу пункта: если текст промпта поменяют, пункт просто
 * останется в запросе — промпт не сломается, станет лишь длиннее.
 */
const DAVID_APPAREL_BULLET_PREFIXES = [
  'Числовые размеры одежды',
  'Для одежды',
  'Для обуви',
  'Не назначай «Комплекты»',
  'Считай вещи только',
  'Карточка, в которой показано несколько вещей',
  'Сначала сопоставь каждую таблицу замеров',
  'Для одного товара сохраняй только одну',
  'Если на одном фото есть одновременно «尺码表',
  'Только для подтверждённого комплекта',
  'measurements заполняй',
]

export function davidScopedPromptText(text: string | null | undefined) {
  const lines = String(text || '').split('\n')
  const kept: string[] = []
  let skippingBullet = false
  let skippingExample = false
  for (const line of lines) {
    const trimmed = line.trim()
    // Примеры текстов для одежды: от «Пример уровня текста для …» до следующего
    // заголовка раздела (строка заглавными буквами).
    if (/^Пример уровня текста для /u.test(trimmed)) {
      skippingExample = true
      continue
    }
    if (skippingExample) {
      if (trimmed && /^[А-ЯЁA-Z][А-ЯЁA-Z ,.-]{3,}$/u.test(trimmed)) skippingExample = false
      else continue
    }
    const bullet = line.match(/^- (.*)$/u)
    if (bullet) {
      skippingBullet = DAVID_APPAREL_BULLET_PREFIXES.some((prefix) => bullet[1].startsWith(prefix))
      if (skippingBullet) continue
    } else if (skippingBullet && /^\s+\S/u.test(line)) {
      // Вложенные подпункты удалённого пункта.
      continue
    } else {
      skippingBullet = false
    }
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * Цена David в рублях по правилу 2026-09-25: большая цена поставщика в USD × 172
 * (× 2 × 86), вверх до целой тысячи. Нет цены у поставщика — null.
 */
export function davidRulePriceRub(product: Pick<DavidCatalogProduct, 'price_min' | 'price_max'>) {
  const usd = Math.max(Number(product.price_max ?? 0) || 0, Number(product.price_min ?? 0) || 0)
  if (!(usd > 0)) return null
  return Math.ceil((usd * 172) / 1000) * 1000
}

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
    // Группы только одежды, обуви, часов, бижутерии и чемоданов David не нужны;
    // смешанные вроде «Одежда, сумки и аксессуары» остаются.
    if (isDavidExcludedAttributeScope(scope)) continue
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
    categoryRules: davidCategoryRules(input.settings.categoryRules),
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
  /** Цена в рублях; 0 — «Цена по запросу» (Rails ставит price_on_request). */
  priceRub?: number | null
}) {
  const sizes = [...new Set((input.sizes || []).map((size) => String(size).trim()).filter(Boolean))]
  const externalId = davidExternalId(input.handle)
  const priceCents = Math.max(0, Math.round(Number(input.priceRub) || 0)) * 100
  const priceSource = priceCents > 0 ? 'manual' : 'not_assigned'
  return {
    external_id: externalId,
    name: input.name,
    description: input.description,
    h1: input.h1 || input.name,
    seo_description: input.seoDescription || '',
    price_cents: priceCents,
    currency: 'RUB',
    status: 'active',
    indexing_status: 'indexable',
    // Товары David продаются только на chromoff.store.
    chromoff_only: true,
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
      price_cents: priceCents,
      status: 'active',
      metadata: { generated_from: 'catalog_attributes.sizes' },
    })),
    media: input.media,
    metadata: {
      source: 'david-studio',
      source_handle: input.handle,
      source_supplier_name: DAVID_SUPPLIER_NAME,
      storefront: 'chromoff',
      price_source: priceSource,
    },
  }
}

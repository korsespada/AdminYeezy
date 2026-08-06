import 'server-only'

import { getRailsCatalogLookups, type RailsChromoffImportPayload } from '@/lib/rails-admin'
import type { ProductMedia } from '@/lib/types'

type SourceCategory = { id: string; name: string }
type SourceSubcategory = { id: string; name: string; category: string }
type SourceProduct = {
  id: string
  name: string
  description?: string | null
  price?: number | string | null
  category: string
  subcategory?: string | null
  photos?: unknown
  meta_description?: string | null
  gender?: string | null
  video_url?: string | null
  external_id?: string | null
  status?: string | null
  sort_order?: number | null
  created_at?: string | null
  pinterest_published?: boolean | null
  tg_published?: boolean | null
  tg_draft?: boolean | null
}

const ROOT_CATEGORY_NAMES: Record<string, string> = {
  'Аксессуары': 'Аксессуары',
  'Бижутерия': 'Бижутерия',
  'Изделия из серебра': 'Ювелирные изделия',
  'Обувь': 'Обувь',
  'Одежда': 'Одежда',
  'Сумки': 'Сумки',
}

const SUBCATEGORY_TARGETS: Record<string, string> = {
  'Бижутерия/Кулоны': 'Бижутерия/Подвеска',
  'Обувь/Кеды': 'Обувь/Кроссовки и кеды',
  'Обувь/Кроссовки': 'Обувь/Кроссовки и кеды',
  'Обувь/Тапки': 'Обувь/Шлепанцы и тапочки',
  'Одежда/Пальто': 'Одежда/Пальто и плащи',
  'Одежда/Худи': 'Одежда/Худи и толстовки',
  'Сумки/Картхолдеры': 'Аксессуары/Кошельки и картхолдеры',
  'Сумки/Кошельки': 'Аксессуары/Кошельки и картхолдеры',
  'Аксессуары/Кепки': 'Аксессуары/Кепки и бейсболки',
}

function sourceConfig() {
  const url = process.env.CHROMOFF_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.CHROMOFF_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Нужны CHROMOFF_SUPABASE_URL и CHROMOFF_SUPABASE_SERVICE_ROLE_KEY в окружении AdminYeezy.')
  }
  return { url, key }
}

async function sourceRows<T>(table: string, select: string): Promise<T[]> {
  const { url, key } = sourceConfig()
  const rows: T[] = []
  const pageSize = 1_000

  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ select, order: 'id.asc', limit: String(pageSize), offset: String(offset) })
    const response = await fetch(`${url}/rest/v1/${table}?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    const page = await response.json().catch(() => [])
    if (!response.ok || !Array.isArray(page)) throw new Error(`Не удалось прочитать ${table} из Chromoff.`)
    rows.push(...page as T[])
    if (page.length < pageSize) return rows
  }
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function slugify(value: string) {
  const letters: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return value.toLocaleLowerCase('ru-RU').split('').map((char) => letters[char] ?? char).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chromoff'
}

function photoUrls(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  return [...new Set(raw
    .map((item) => String(item || '').replace(/[\[\]"]/g, '').trim())
    .filter((url) => /^https:\/\//i.test(url)))]
}

function productMedia(product: SourceProduct): ProductMedia[] {
  return photoUrls(product.photos).map((url, index) => ({
    original_url: url,
    thumb_url: url,
    preview_url: url,
    og_image_url: url,
    alt_text: `${product.name}, фото ${index + 1}`,
    sort_order: index,
    processing_status: 'processed',
  }))
}

export async function buildChromoffImportPayload(): Promise<RailsChromoffImportPayload> {
  const [sourceCategories, sourceSubcategories, sourceProducts, catalog] = await Promise.all([
    sourceRows<SourceCategory>('categories', 'id,name'),
    sourceRows<SourceSubcategory>('subcategories', 'id,name,category'),
    sourceRows<SourceProduct>('products', 'id,name,description,price,category,subcategory,photos,meta_description,gender,video_url,external_id,status,sort_order,created_at,pinterest_published,tg_published,tg_draft'),
    getRailsCatalogLookups(),
  ])
  const sourceCategoryById = new Map(sourceCategories.map((category) => [category.id, category]))
  const rootCatalogId = new Map<string, string>()
  for (const [sourceName, railsName] of Object.entries(ROOT_CATEGORY_NAMES)) {
    const match = catalog.categories.find((category) => normalize(category.name) === normalize(railsName))
    if (!match) throw new Error(`В YeezyUnique не найдена корневая категория «${railsName}».`)
    rootCatalogId.set(sourceName, match.id)
  }
  const categoryTargetId = (sourceRootName: string, sourceSubcategoryName?: string) => {
    const fullSourceName = sourceSubcategoryName ? `${sourceRootName}/${sourceSubcategoryName}` : sourceRootName
    const target = SUBCATEGORY_TARGETS[fullSourceName] || (sourceSubcategoryName
      ? `${ROOT_CATEGORY_NAMES[sourceRootName] || sourceRootName}/${sourceSubcategoryName}`
      : sourceRootName)
    const [targetRootName, targetChildName] = target.split('/', 2)
    if (!targetChildName) return rootCatalogId.get(sourceRootName) || ''
    const targetRootId = catalog.categories.find((category) => normalize(category.name) === normalize(targetRootName))?.id
    const child = catalog.subcategories.find((category) => category.category === targetRootId && normalize(category.name) === normalize(targetChildName))
    return child?.id || rootCatalogId.get(sourceRootName) || ''
  }

  const categories: RailsChromoffImportPayload['categories'] = sourceCategories.map((category) => ({
    source_id: category.id,
    parent_source_id: null,
    catalog_category_id: categoryTargetId(category.name),
    name: category.name,
    slug: slugify(category.name),
    sort_order: 0,
  }))
  categories.push(...sourceSubcategories.map((subcategory) => {
    const root = sourceCategoryById.get(subcategory.category)
    if (!root) throw new Error(`У подкатегории «${subcategory.name}» не найдена категория Chromoff.`)
    return {
      source_id: subcategory.id,
      parent_source_id: root.id,
      catalog_category_id: categoryTargetId(root.name, subcategory.name),
      name: subcategory.name,
      slug: slugify(subcategory.name),
      sort_order: 0,
    }
  }))

  return {
    categories,
    products: sourceProducts.map((product) => ({
      source_product_id: product.id,
      category_source_id: product.subcategory || product.category,
      legacy_slug: `${slugify(product.name)}-${product.id}`,
      name: product.name,
      description: product.description || '',
      price_cents: Math.max(0, Math.round(Number(product.price || 0) * 100)),
      gender: product.gender || null,
      video_url: product.video_url || null,
      source_external_id: product.external_id || null,
      source_status: product.status || null,
      published: product.status === 'active',
      source_metadata: {
        source_created_at: product.created_at || null,
        pinterest_published: product.pinterest_published ?? null,
        tg_published: product.tg_published ?? null,
        tg_draft: product.tg_draft ?? null,
      },
      sort_order: Number(product.sort_order || 0),
      seo_description: product.meta_description || '',
      h1: product.name,
      media: productMedia(product),
    })),
  }
}

import { listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { loadDavidStudioCatalog } from '@/lib/david-studio-catalog-server'
import { davidExternalId } from '@/lib/david-studio-import'
import type { RingAnchor, RingCandidate } from '@/lib/david-ring-match'

/**
 * Загрузка двух наборов для сопоставления.
 *
 * «Якоря» — уже опубликованные старые кольца Chromoff: у них живой URL, цена и
 * история, поэтому они и остаются каноном. «Кандидаты» — все кольца David Studio
 * из выгрузки; у тех, что уже созданы в Chromoff, берутся очищенные фото из S3,
 * у остальных — исходные фото выгрузки.
 *
 * Пагинация холодного старта — около десяти запросов к Rails, поэтому результат
 * кэшируется на минуту: экран и батч читают набор многократно. Мутирующие экшены
 * сбрасывают кэш явно, иначе после удаления дубля список остался бы старым.
 */

const PAGE_SIZE = 60
const CACHE_TTL_MS = 60_000

export interface RingMatchCatalog {
  categoryId: string
  categoryName: string
  anchors: RingAnchor[]
  candidates: RingCandidate[]
  /** Кольца David из выгрузки, у которых ещё нет карточки в Chromoff. */
  skippedNotImported: string[]
}

let cache: { at: number; value: RingMatchCatalog } | null = null

export function invalidateRingMatchCatalog() {
  cache = null
}

async function resolveRingsCategory() {
  const categories = await listRailsChromoffCategories()
  const rings = categories.find((category) => category.slug === 'koltsa')
    || categories.find((category) => category.name.trim().toLocaleLowerCase('ru-RU') === 'кольца')
  if (!rings) throw new Error('В Chromoff нет категории «Кольца» (koltsa)')
  return rings
}

async function loadCategoryListings(categoryId: string) {
  const items: any[] = []
  // Страховка от бесконечного цикла: у категории колец заведомо меньше 20 страниц.
  for (let page = 1; page <= 20; page += 1) {
    const result = await listRailsChromoffListings({ categoryId, published: true, page, perPage: PAGE_SIZE })
    items.push(...result.items)
    if (result.items.length < PAGE_SIZE) break
  }
  return items
}

function mediaUrls(listing: any): string[] {
  const media = Array.isArray(listing?.media) ? listing.media : []
  return media.map((medium: any) => String(medium?.original_url || '')).filter((url: string) => url.startsWith('http'))
}

/**
 * Текст характеристики. В каталоге значения структурированы
 * (`{ filter_value, display_value, values }`), поэтому `String(value)` дал бы
 * «[object Object]» и подсунул бы модели мусорные токены вроде «objec».
 */
function attributeText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (Array.isArray(value)) {
    return value.map(attributeText).filter(Boolean).join(' ').trim()
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['display_value', 'value', 'values', 'names', 'raw_values']) {
      const text = attributeText(record[key])
      if (text) return text
    }
  }
  return ''
}

/**
 * Кольца ли это. Определяем по типу товара и категории выгрузки: по handle
 * отметку «ring» ставить нельзя — под неё попадают серьги (earring).
 */
function isRingProduct(product: any): boolean {
  const type = String(product?.product_type || '').trim().toLocaleLowerCase('en-US')
  const category = String(product?.category || '').trim().toLocaleLowerCase('en-US')
  return type === 'rings' || category === 'rings' || category === 'chrome-hearts-cross-rings'
}

export async function loadRingMatchCatalog(options: { force?: boolean } = {}): Promise<RingMatchCatalog> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  const category = await resolveRingsCategory()
  const listings = await loadCategoryListings(category.id)
  const catalog = loadDavidStudioCatalog()

  const listingsByExternalId = new Map<string, any>()
  for (const listing of listings) {
    const externalId = String(listing?.external_id || '').trim()
    if (externalId) listingsByExternalId.set(externalId, listing)
  }

  const anchors: RingAnchor[] = listings
    .filter((listing) => !String(listing?.external_id || '').startsWith('david-studio-'))
    .map((listing) => ({
      listingId: String(listing.id || ''),
      productId: String(listing.product_id || ''),
      slug: String(listing.legacy_slug || listing.slug || ''),
      name: String(listing.name || ''),
      priceCents: Number(listing.price_cents || 0),
      photos: mediaUrls(listing),
      modelName: attributeText(listing.catalog_attributes?.model_name),
      seoArticle: String(listing.seo_article || ''),
    }))
    .filter((anchor) => anchor.listingId && anchor.productId && anchor.photos.length > 0)

  const candidates: RingCandidate[] = []
  const skippedNotImported: string[] = []

  for (const product of (catalog?.products || []) as any[]) {
    if (!isRingProduct(product)) continue
    const handle = String(product.handle || '')
    if (!handle) continue
    const listing = listingsByExternalId.get(davidExternalId(handle))
    const cleanedPhotos = listing ? mediaUrls(listing) : []

    // Сравнивать можно только кольца, у которых есть карточка в Chromoff: их фото
    // лежат на нашем S3. Исходные фото выгрузки — на CDN поставщика, он бывает
    // недоступен и роняет весь запрос, а перенести контент из неимпортированного
    // кольца всё равно нельзя. Такие кольца показываем отдельным счётчиком.
    if (!listing || !cleanedPhotos.length) {
      skippedNotImported.push(handle)
      continue
    }

    candidates.push({
      handle,
      externalId: davidExternalId(handle),
      title: String(listing?.name || product.title || handle),
      productId: String(listing.product_id || '') || null,
      listingId: String(listing.id || '') || null,
      slug: String(listing.legacy_slug || '') || null,
      photos: cleanedPhotos,
      created: true,
      priceCents: Number(listing.price_cents || 0),
      photoSource: 'chromoff',
    })
  }

  const value: RingMatchCatalog = {
    categoryId: String(category.id),
    categoryName: String(category.name || 'Кольца'),
    anchors,
    candidates,
    skippedNotImported,
  }
  cache = { at: Date.now(), value }
  return value
}

/**
 * Хосты фото, которые нужно разрешить для contact sheet'ов. Очищенные фото David
 * уже лежат на нашем S3, а исходные фото выгрузки — на CDN поставщика; его и надо
 * добавить, иначе `buildBatchAiContactSheets` выбросит плитки и сравнение не
 * состоится.
 */
export function ringMatchPhotoHosts(candidates: RingCandidate[]): string[] {
  const hosts = new Set<string>()
  for (const candidate of candidates) {
    for (const url of candidate.photos.slice(0, 3)) {
      try {
        hosts.add(new URL(url).hostname.toLowerCase())
      } catch {
        // Некорректный адрес просто не попадает в список хостов.
      }
    }
  }
  return [...hosts]
}

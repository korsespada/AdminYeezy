/**
 * Фильтры внутри подкатегории chromoff.store («Levi's / Carhartt» в джинсах,
 * ширина полотна у ремней). Источник правды — Rails `Chromoff::SubcategoryFilters`:
 * он считает `chromoff_filter` для витрины. Здесь та же логика нужна для живого
 * предпросмотра в редакторе, пока правила ещё не сохранены — меняйте их вместе.
 */

export interface ChromoffSubcategoryFilter {
  slug: string
  label: string
  keywords: string[]
}

export const CHROMOFF_FILTER_NONE = 'none'
export const CHROMOFF_FILTER_OVERRIDE_KEY = 'chromoff_filter'

export type ChromoffFilterMatch =
  | { slug: string; reason: 'manual' }
  | { slug: string; reason: 'keyword'; keyword: string; source: 'name' | 'model' | 'description' }

interface MatchableListing {
  name: string
  description?: string | null
  catalog_attributes?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

function normalize(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function modelName(listing: MatchableListing) {
  const value = listing.catalog_attributes?.model_name
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) return String((value as { value?: unknown }).value || '')
  return ''
}

export function chromoffFilterOverride(listing: MatchableListing) {
  const value = listing.metadata?.[CHROMOFF_FILTER_OVERRIDE_KEY]
  return typeof value === 'string' && value ? value : null
}

/**
 * Товар попадает ровно в один фильтр. Название надёжнее описания, поэтому
 * источники проверяются по очереди, а внутри источника побеждает слово,
 * встретившееся раньше. Ручная привязка важнее слов, `none` — вне фильтров.
 */
export function matchChromoffFilter(listing: MatchableListing, filters: ChromoffSubcategoryFilter[]): ChromoffFilterMatch | null {
  if (filters.length === 0) return null

  const override = chromoffFilterOverride(listing)
  if (override === CHROMOFF_FILTER_NONE) return null
  if (override && filters.some((filter) => filter.slug === override)) return { slug: override, reason: 'manual' }

  const sources = [
    ['name', listing.name],
    ['model', modelName(listing)],
    ['description', listing.description || ''],
  ] as const

  for (const [source, value] of sources) {
    const text = normalize(value)
    if (!text) continue

    let best: { slug: string; keyword: string; index: number } | null = null
    for (const filter of filters) {
      for (const keyword of filter.keywords) {
        const needle = normalize(keyword.trim())
        if (!needle) continue
        const index = text.indexOf(needle)
        if (index !== -1 && (!best || index < best.index)) best = { slug: filter.slug, keyword: needle, index }
      }
    }

    if (best) return { slug: best.slug, reason: 'keyword', keyword: best.keyword, source }
  }

  return null
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Slug для `?f=` в адресе витрины. Клиентский двойник slugify из chromoff-source (тот server-only). */
export function chromoffFilterSlug(label: string) {
  return label.toLocaleLowerCase('ru-RU').split('').map((char) => TRANSLIT[char] ?? char).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Ключевые слова в поле ввода — через запятую или с новой строки. */
export function parseChromoffFilterKeywords(value: string) {
  return [...new Set(value.split(/[,\n]/).map((keyword) => keyword.trim().toLocaleLowerCase('ru-RU')).filter(Boolean))]
}

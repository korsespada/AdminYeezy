import { seoSlug } from '@/lib/product-media-seo'
import type { HardwareKind } from '@/lib/video-match-fields'
import { type HermesCardFacts } from '@/lib/hermes-card-facts'

/**
 * Slug товара поставщика Hermes:
 * `hermes-{модель}-{размер}-{цвет}-{фурнитура}-{материал}-{артикул}`.
 *
 * Примеры: `hermes-birkin-25-89-noir-silver-swift-her-46911`,
 * `hermes-lindy-26-18-etoupe-gold-clemence-her-10993`.
 *
 * Слаги считает Rails (`Catalog::ProductSlug`), и он перезаписывает присланный
 * slug на каждой записи, поэтому адрес из этого модуля применяется отдельным
 * явным вызовом (см. документацию раздела). Здесь только сборка значений:
 * фурнитура и материал берутся латиницей из описания, если она там есть,
 * иначе транслитерируются.
 */

const HARDWARE_SLUG: Record<Exclude<HardwareKind, 'other'>, string> = {
  silver: 'silver',
  gold: 'gold',
  rose: 'rose-gold',
  black: 'black',
}

/** Русские названия материалов, которые в описании идут без латиницы. */
const MATERIAL_WORDS: Array<[RegExp, string]> = [
  [/козь[яеи]\s+кож/i, 'goat-leather'],
  [/овеч[ья][яи]\s+кож/i, 'sheep-leather'],
  [/теляч[ья][яи]\s+кож/i, 'calfskin'],
  [/кож[аи]\s+ящериц/i, 'lizard'],
  [/кож[аи]\s+ягн[её]нк/i, 'lambskin'],
  [/натуральн[а-я]+\s+кож/i, 'leather'],
  [/замш/i, 'suede'],
  [/аллигатор/i, 'alligator'],
  [/крокодил/i, 'crocodile'],
  [/парусин|холст/i, 'canvas'],
  [/нейлон/i, 'nylon'],
  [/резин|каучук/i, 'rubber'],
  [/текстил/i, 'textile'],
  [/трикотаж/i, 'knit'],
  [/мех/i, 'fur'],
]

/**
 * Транслитерация как в Rails (`Catalog::Slug::CYRILLIC_TRANSLITERATION`).
 * Локальный `seoSlug` декомпозирует строку до NFKD и теряет «й» → «и»,
 * поэтому кириллицу переводим заранее и уже потом параметризуем.
 */
const RAILS_TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

export function transliterateCyrillic(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .split('')
    .map((character) => RAILS_TRANSLITERATION[character] ?? character)
    .join('')
}

/** Параметризация значения для адреса. */
function slugPart(value: unknown): string {
  return seoSlug(transliterateCyrillic(value), '')
}

/**
 * Цвет для адреса: только первый код и первое имя. У мультицветных сумок
 * в описании перечислены все цвета («37/Gold/2S/Sesame»), в адрес уходит
 * «37/Gold» — адрес остаётся читаемым, а полный цвет сохраняется в названии.
 */
export function colourSlugValue(colour?: string | null): string | null {
  const value = String(colour ?? '').trim()
  if (!value) return null
  const segments = value.split('/').map((part) => part.trim()).filter(Boolean)
  if (segments.length === 0) return null
  const primary = segments.slice(0, 2).join('/')
  return slugPart(primary) || null
}

const MATERIAL_STOP_WORDS = new Set([
  'from', 'france', 'imported', 'import', 'originally', 'which', 'the', 'and', 'with',
  'matte', 'grain', 'veau', 'de', 'la', 'le', 'du', 'привезен', 'french',
])

export const SLUG_MAX_LENGTH = 160

/** Фурнитура латиницей: сначала слово из описания, затем словарь по виду. */
export function hardwareSlugValue(kind: HardwareKind | null, raw?: string | null): string | null {
  const text = String(raw || '')
  if (/паллад/i.test(text)) return 'palladium'
  const latin = text.match(/[A-Za-z][A-Za-z-]{2,}/g) || []
  const fromText = latin
    .map((token) => token.toLowerCase())
    .find((token) => ['silver', 'gold', 'palladium', 'rose', 'black', 'graphite', 'bronze'].includes(token))
  if (fromText) return fromText === 'rose' ? 'rose-gold' : fromText
  if (!kind || kind === 'other') return null
  return HARDWARE_SLUG[kind]
}

/** Материал латиницей: слово из описания, иначе русское название, иначе транслит. */
export function materialSlugValue(material?: string | null): string | null {
  const text = String(material || '').trim()
  if (!text) return null

  const latin = (text.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}/g) || [])
    .filter((token) => !MATERIAL_STOP_WORDS.has(token.toLowerCase()))
  if (latin.length > 0) return latin[0].toLowerCase()

  const mapped: string[] = []
  for (const [pattern, value] of MATERIAL_WORDS) {
    if (!pattern.test(text)) continue
    // Конкретный вид кожи важнее общего «кожа»: «натуральная кожа ягненка» → lambskin.
    if (value === 'leather' && mapped.some((item) => item !== 'leather')) continue
    if (value !== 'leather' && mapped.includes('leather')) mapped.splice(mapped.indexOf('leather'), 1)
    if (!mapped.includes(value)) mapped.push(value)
    if (mapped.length === 2) break
  }
  if (mapped.length > 0) return mapped.join('-')
  // Общая кожа — только если конкретный вид кожи в описании не назван.
  if (/кож/i.test(text)) return 'leather'

  const transliterated = slugPart(text.split(/[.,;]/)[0])
  return transliterated ? transliterated.slice(0, 24).replace(/-+$/g, '') : null
}

export interface HermesSlugInput {
  /** Slug бренда каталога: «hermes». */
  brandSlug?: string | null
  /** Внутренний SEO-артикул товара: «HER-46911». */
  article?: string | null
  modelName?: string | null
  sizeToken?: string | null
  colour?: string | null
  hardwareKind?: HardwareKind | null
  hardwareRaw?: string | null
  material?: string | null
  kind?: 'bag' | 'shoe'
}

export interface HermesSlugProposal {
  slug: string
  parts: Record<string, string | null>
  warnings: string[]
}

/** Собирает адрес из подтверждённых частей, сохраняя артикул в конце. */
export function buildHermesCardSlug(input: HermesSlugInput): HermesSlugProposal {
  const warnings: string[] = []
  const parts: Record<string, string | null> = {
    brand: slugPart(input.brandSlug || 'hermes') || 'hermes',
    model: input.modelName ? slugPart(input.modelName) || null : null,
    size: input.kind === 'shoe' ? null : (input.sizeToken ? slugPart(input.sizeToken) || null : null),
    colour: colourSlugValue(input.colour),
    hardware: hardwareSlugValue(input.hardwareKind || null, input.hardwareRaw),
    material: materialSlugValue(input.material),
    article: input.article ? slugPart(input.article) || null : null,
  }
  if (!parts.article) warnings.push('артикул не найден: адрес без артикула применяться не должен')
  if (!parts.model) warnings.push('модель не распознана: адрес собран без модели')
  if (!parts.colour) warnings.push('цвет не распознан: адрес собран без цвета')

  const ordered = ['brand', 'model', 'size', 'colour', 'hardware', 'material', 'article'] as const
  const build = (skip: string[] = []) => ordered
    .filter((key) => !skip.includes(key))
    .map((key) => parts[key])
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')

  let slug = seoSlug(build(), 'product')
  if (slug.length > SLUG_MAX_LENGTH && parts.material) {
    warnings.push('адрес длиннее 160 знаков: материал из адреса убран')
    slug = seoSlug(build(['material']), 'product')
  }
  if (slug.length > SLUG_MAX_LENGTH && parts.hardware) {
    warnings.push('адрес длиннее 160 знаков: фурнитура из адреса убрана')
    slug = seoSlug(build(['material', 'hardware']), 'product')
  }
  return { slug: slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, ''), parts, warnings }
}

/** Собирает адрес прямо из фактов карточки и предложения по ней. */
export function buildHermesSlugFromFacts(
  facts: HermesCardFacts,
  input: Omit<HermesSlugInput, 'colour' | 'hardwareKind' | 'hardwareRaw'>,
): HermesSlugProposal {
  return buildHermesCardSlug({
    ...input,
    colour: facts.colourDisplay,
    hardwareKind: facts.hardwareKind,
    hardwareRaw: facts.hardwareRaw,
    material: input.material || facts.material,
  })
}

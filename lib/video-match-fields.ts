/**
 * Разбор и сравнение атрибутов для сопоставления альбомов с видео из выгрузки
 * поставщика с товарами опубликованного каталога.
 *
 * Поставщик пишет характеристики одной строкой на английском
 * (`Style：Kelly Colour：18/Etoupe Size：25*20*13cm Leather：Epsom Hardware：silver`),
 * каталог хранит их блоками на русском (`Стиль: Kelly`, `Цвет: 18/Etoupe`,
 * `Размер: 25 x 20 x 13 см`, `Кожа: Epsom`, `Фурнитура: серебро`).
 * Значения написаны в разном регистре и с опечатками, поэтому сравнение идёт
 * по нормализованным формам, а не по строкам.
 */

export interface AlbumFields {
  style: string | null
  colour: string | null
  size: string | null
  leather: string | null
  hardware: string | null
}

export type HardwareKind = 'silver' | 'gold' | 'rose' | 'black' | 'other'

export interface NormalizedFields {
  style: string | null
  /** Тот же стиль, но с отсортированными словами: «Kelly mini 2» и «mini kelly 2» — одна модель. */
  styleSignature: string | null
  colourCode: string | null
  colourName: string | null
  size: string | null
  sizeSorted: string | null
  leather: string | null
  hardware: HardwareKind | null
}

export interface FieldDifference {
  field: 'style' | 'colour' | 'size' | 'leather' | 'hardware'
  catalog: string | null
  album: string | null
  verdict: 'match' | 'partial' | 'mismatch' | 'unknown'
}

export interface MatchComparison {
  score: number
  confidence: 'exact' | 'strong' | 'probable' | 'weak' | 'none'
  differences: FieldDifference[]
}

const SOURCE_FIELD_KEYS: Record<string, keyof AlbumFields> = {
  style: 'style',
  colour: 'colour',
  color: 'colour',
  size: 'size',
  leather: 'leather',
  hardware: 'hardware',
  haedware: 'hardware',
}

const CATALOG_FIELD_KEYS: Record<string, keyof AlbumFields> = {
  'стиль': 'style',
  'цвет': 'colour',
  'размер': 'size',
  'кожа': 'leather',
  'фурнитура': 'hardware',
}

const SOURCE_KEY_RE = /(style|colour|color|size|leather|hardware|haedware)\s*[：:]/gi
const CATALOG_KEY_RE = /(стиль|цвет|размер|кожа|фурнитура)\s*:/gi

function tidyValue(value: string) {
  return value
    .replace(/[\u200b\u200e\u200f\ufeff\ufffd]/g, '')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/[\u2190-\u21ff\u2600-\u27bf\ufe0f\u2b00-\u2bff\u2b50\u203c\u2049]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:：,;.;]+|[\s\-–—:：,;.;]+$/g, '')
    .trim()
}

/** Разбирает характеристики из текста поставщика: ключи идут в произвольном порядке. */
export function parseAlbumFields(text: string | null | undefined): AlbumFields {
  const fields: AlbumFields = { style: null, colour: null, size: null, leather: null, hardware: null }
  const source = String(text || '')
  const matches = [...source.matchAll(SOURCE_KEY_RE)]
  matches.forEach((match, index) => {
    const key = SOURCE_FIELD_KEYS[match[1].toLowerCase()]
    if (!key || fields[key]) return
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index || source.length : source.length
    const value = tidyValue(source.slice(start, end))
    if (value) fields[key] = value
  })
  return fields
}

/** Разбирает блок характеристик из описания товара каталога. */
export function parseCatalogFields(description: string | null | undefined): AlbumFields {
  const fields: AlbumFields = { style: null, colour: null, size: null, leather: null, hardware: null }
  const source = String(description || '')
  const matches = [...source.matchAll(CATALOG_KEY_RE)]
  matches.forEach((match, index) => {
    const key = CATALOG_FIELD_KEYS[match[1].toLowerCase()]
    if (!key || fields[key]) return
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index || source.length : source.length
    const value = tidyValue(source.slice(start, end).split(/\r?\n/)[0] || '')
    if (value) fields[key] = value
  })
  return fields
}

function normalizeStyle(value: string | null) {
  if (!value) return null
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9а-я/ ]+/gi, ' ')
    .replace(/\bcm\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

function styleSignature(style: string | null) {
  if (!style) return null
  return style.split(' ').filter(Boolean).sort().join(' ') || null
}

function normalizeColour(value: string | null) {
  if (!value) return { code: null, name: null }
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[^a-z0-9а-я/ ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return { code: null, name: null }
  const segments = cleaned.split('/').map((part) => part.trim()).filter(Boolean)
  if (segments.length === 0) return { code: null, name: null }
  const looksLikeCode = segments.length > 1 || /^[a-z0-9]{1,4}$/.test(segments[0])
  return {
    code: looksLikeCode ? segments[0] : null,
    name: segments.slice(looksLikeCode ? 1 : 0).join(' ') || null,
  }
}

function normalizeSize(value: string | null) {
  if (!value) return { size: null, sorted: null }
  const numbers = String(value).replace(/,/g, '.').match(/\d+(?:\.\d+)?/g)
  if (!numbers || numbers.length === 0) return { size: null, sorted: null }
  const parts = numbers.slice(0, 3).map((number) => String(Number(number)))
  return { size: parts.join('x'), sorted: [...parts].sort((a, b) => Number(a) - Number(b)).join('x') }
}

function normalizeLeather(value: string | null) {
  if (!value) return null
  const cleaned = String(value)
    .toLowerCase()
    .split(/\bfrom\b|\bimported\b|\bwhich\b/)[0]
    .replace(/[^a-zа-я ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

export function normalizeHardware(value: string | null): HardwareKind | null {
  const text = String(value || '').toLowerCase()
  if (!text.trim()) return null
  if (/silver|sliver|серебр|steel|стальн|pallad|паллад/.test(text)) return 'silver'
  if (/rose gold|розов/.test(text)) return 'rose'
  if (/gold|золот/.test(text)) return 'gold'
  if (/black|чёрн|черн|нойр|noir/.test(text)) return 'black'
  return 'other'
}

export function normalizeFields(fields: AlbumFields): NormalizedFields {
  const style = normalizeStyle(fields.style)
  const { code, name } = normalizeColour(fields.colour)
  const { size, sorted } = normalizeSize(fields.size)
  return {
    style,
    styleSignature: styleSignature(style),
    colourCode: code,
    colourName: name,
    size,
    sizeSorted: sorted,
    leather: normalizeLeather(fields.leather),
    hardware: normalizeHardware(fields.hardware),
  }
}

function tokens(value: string | null) {
  return new Set(String(value || '').split(' ').map((token) => token.trim()).filter(Boolean))
}

function tokenOverlap(left: string | null, right: string | null) {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  a.forEach((token) => { if (b.has(token)) shared += 1 })
  return shared / Math.max(a.size, b.size)
}

function verdictFor(match: boolean, partial: boolean, catalogValue: string | null, albumValue: string | null): FieldDifference['verdict'] {
  if (match) return 'match'
  if (!catalogValue || !albumValue) return 'unknown'
  return partial ? 'partial' : 'mismatch'
}

const WEIGHTS = { style: 40, colour: 25, size: 20, leather: 10, hardware: 5 } as const

/**
 * Сравнивает характеристики товара каталога и альбома поставщика.
 * Порядок аргументов: первым идёт товар каталога.
 */
export function compareFields(catalog: NormalizedFields, album: NormalizedFields): MatchComparison {
  const differences: FieldDifference[] = []
  let score = 0

  const styleMatch = Boolean(catalog.style && album.style && catalog.style === album.style)
  const styleSignatureMatch = Boolean(
    !styleMatch && catalog.styleSignature && album.styleSignature && catalog.styleSignature === album.styleSignature,
  )
  const stylePartial = Boolean(
    !styleMatch && !styleSignatureMatch && catalog.style && album.style
    && (catalog.style.includes(album.style) || album.style.includes(catalog.style)),
  )
  if (styleMatch) score += WEIGHTS.style
  else if (styleSignatureMatch) score += WEIGHTS.style - 6
  else if (stylePartial) score += WEIGHTS.style - 20
  differences.push({
    field: 'style',
    catalog: catalog.style,
    album: album.style,
    verdict: verdictFor(styleMatch, styleSignatureMatch || stylePartial, catalog.style, album.style),
  })

  const colourCodeMatch = Boolean(catalog.colourCode && album.colourCode && catalog.colourCode === album.colourCode)
  const colourNameMatch = Boolean(catalog.colourName && album.colourName && catalog.colourName === album.colourName)
  const colourOverlap = tokenOverlap(catalog.colourName, album.colourName)
  if (colourCodeMatch) score += WEIGHTS.colour
  else if (colourNameMatch) score += WEIGHTS.colour - 3
  else if (colourOverlap >= 0.5) score += WEIGHTS.colour - 12
  differences.push({
    field: 'colour',
    catalog: [catalog.colourCode, catalog.colourName].filter(Boolean).join('/') || null,
    album: [album.colourCode, album.colourName].filter(Boolean).join('/') || null,
    verdict: verdictFor(
      colourCodeMatch || colourNameMatch,
      colourOverlap >= 0.5,
      catalog.colourCode || catalog.colourName,
      album.colourCode || album.colourName,
    ),
  })

  const sizeMatch = Boolean(catalog.size && album.size && catalog.size === album.size)
  const sizeSortedMatch = Boolean(!sizeMatch && catalog.sizeSorted && album.sizeSorted && catalog.sizeSorted === album.sizeSorted)
  if (sizeMatch) score += WEIGHTS.size
  else if (sizeSortedMatch) score += WEIGHTS.size - 8
  differences.push({
    field: 'size',
    catalog: catalog.size,
    album: album.size,
    verdict: verdictFor(sizeMatch, sizeSortedMatch, catalog.size, album.size),
  })

  const leatherMatch = Boolean(catalog.leather && album.leather && catalog.leather === album.leather)
  const leatherOverlap = tokenOverlap(catalog.leather, album.leather)
  if (leatherMatch) score += WEIGHTS.leather
  else if (leatherOverlap >= 0.5) score += WEIGHTS.leather - 4
  differences.push({
    field: 'leather',
    catalog: catalog.leather,
    album: album.leather,
    verdict: verdictFor(leatherMatch, leatherOverlap >= 0.5, catalog.leather, album.leather),
  })

  const hardwareMatch = Boolean(catalog.hardware && album.hardware && catalog.hardware === album.hardware)
  if (hardwareMatch) score += WEIGHTS.hardware
  differences.push({
    field: 'hardware',
    catalog: catalog.hardware,
    album: album.hardware,
    verdict: verdictFor(hardwareMatch, false, catalog.hardware, album.hardware),
  })

  const confidence: MatchComparison['confidence'] = score >= 100
    ? 'exact'
    : score >= 90
      ? 'strong'
      : score >= 70
        ? 'probable'
        : score > 0
          ? 'weak'
          : 'none'

  return { score, confidence, differences }
}

/** Минимальный балл, при котором альбом вообще считается вариантом товара. */
export const MIN_CANDIDATE_SCORE = 70

/**
 * Вариантом считается только тот альбом, у которого совпали модель и размер:
 * остальные поля уточняют уровень уверенности, но не создают пару.
 */
export function isCandidate(comparison: MatchComparison) {
  if (comparison.score < MIN_CANDIDATE_SCORE) return false
  const style = comparison.differences.find((difference) => difference.field === 'style')?.verdict
  const size = comparison.differences.find((difference) => difference.field === 'size')?.verdict
  return (style === 'match' || style === 'partial') && size === 'match'
}

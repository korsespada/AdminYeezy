import type { MeasurementTable } from '@/lib/measurement-templates'

/**
 * Размеры товаров David Studio → сантиметры и строка замеров.
 *
 * Поставщик отдаёт Shopify-варианты с одной осью «размер», где реально лежат
 * разные вещи: дюймы с сантиметрами (`6.3 IN / 16 CM`), подсказка о посадке
 * (`（Suitable For Wrists 14CM）`), обхват пояса с длиной ремня
 * (`Waist Circumference 28IN（Belt Length 84CM）`), размеры колец в US
 * (`US4.5`), буквенные размеры и вовсе не размеры (цвета, `Pendant Only`,
 * `Per Piece`, `Choose an option`).
 *
 * Поэтому разбор детерминированный и опирается только на исходную строку:
 * единица измерения берётся у поставщика, дюймы переводятся в сантиметры,
 * а US-размеры колец остаются как есть — таблицу соответствия US→мм мы не
 * выдумываем и диаметр кольца не сочиняем.
 */

export type DavidSizeKind = 'measure' | 'letter' | 'us_ring'

export interface DavidSizeInfo {
  /** Исходная строка варианта, как её отдал поставщик. */
  raw: string
  /** Значение размера для варианта и строки замеров; null — это не размер. */
  size: string | null
  /** Пояснение к размеру: «подходит для запястья 14 см». */
  fit: string
  kind: DavidSizeKind | null
}

const FOOT_TO_CM = 2.54

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^suitable\s+for\b/i, 'подходит для'],
  [/\bwrist\s+circumference\b/i, 'обхвата запястья'],
  [/\bwrists?\b/i, 'запястья'],
  [/\bfingers?\b/i, 'пальца'],
  [/\bneck\b/i, 'шеи'],
  [/\bankle\b/i, 'щиколотки'],
  [/\bwaist\b/i, 'талии'],
  [/\bbelow\b/i, 'до'],
  [/\babove\b/i, 'свыше'],
  [/\badjustable\b/i, 'регулируемый'],
  [/\bpendant\s+only\b/i, 'только подвеска'],
]

const SIZE_MEASURE_WORDS: Array<[RegExp, string]> = [
  [/\bbelt\s+length\b/i, 'длина ремня'],
  [/\bwaist\s+circumference\b/i, 'обхват пояса'],
  [/\bwrist\s+circumference\b/i, 'обхват запястья'],
  [/\bsuitable\s+for\b/i, 'подходит для'],
]

const PURCHASE_UNIT_PARENS = /\((?:single|per\s+piece|per\s+pair|1\s*pc|1\s*piece)\)/i
const INTERNATIONAL_SIZE = /^(?:3XS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL)$/i
const NOT_A_SIZE = /^(?:choose\s+an\s+option|one\s+size|default\s+title|per\s+piece|per\s+pair|pendant\s+only|-|—)$/i

/** Полноширинные скобки и тире приводим к обычным, пробелы — к одному. */
export function normalizeDavidSizeText(value: unknown) {
  return String(value ?? '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[－–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Уже разобранные значения («84 см») должны читаться повторно: разбор идемпотентен.
    .replace(/см/gi, 'cm')
    .replace(/мм/gi, 'mm')
}

function ruNumber(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(numeric)) return String(value)
  const rounded = Math.round(numeric * 100) / 100
  return String(rounded).replace('.', ',')
}

function formatRange(min: number, max: number, unit: string) {
  return `${ruNumber(min)}–${ruNumber(max)} ${unit}`
}

function formatSingle(value: number, unit: string) {
  return `${ruNumber(value)} ${unit}`
}

/** «14CM» → «14 см», «13-14CM» → «13–14 см», «17.5MM» → «17,5 мм». */
function translateUnits(text: string) {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:-|to|~)\s*(\d+(?:[.,]\d+)?)\s*cm\b/gi,
      (_, min, max) => formatRange(Number(String(min).replace(',', '.')), Number(String(max).replace(',', '.')), 'см'))
    .replace(/(\d+(?:[.,]\d+)?)\s*cm\b/gi, (_, value) => formatSingle(Number(String(value).replace(',', '.')), 'см'))
    .replace(/(\d+(?:[.,]\d+)?)\s*mm\b/gi, (_, value) => formatSingle(Number(String(value).replace(',', '.')), 'мм'))
    .replace(/(\d+(?:[.,]\d+)?)\s*in\b/gi, (_, value) => `${ruNumber(value)} in`)
}

function translateWords(text: string, dictionary: Array<[RegExp, string]>) {
  let result = text
  for (const [pattern, replacement] of dictionary) result = result.replace(pattern, replacement)
  return result
}

function collapseSpaces(text: string) {
  return text
    .replace(/\s+/g, ' ')
    // Поставщик пишет «28IN（Belt Length 84CM）» без пробела: в русском тексте он нужен.
    .replace(/(\S)\(/g, '$1 (')
    .replace(/\s+([,.;])/g, '$1')
    .trim()
}

interface MeasureUnit {
  cm: number[]
  mm: number[]
  inch: number[]
  cmRange: [number, number] | null
  mmRange: [number, number] | null
  inchRange: [number, number] | null
}

function numeric(value: unknown) {
  return Number(String(value).replace(',', '.'))
}

/**
 * Диапазоны ищем раньше одиночных значений: в «14-17 CM» одиночный шаблон
 * поймал бы только 17 и потерял бы нижнюю границу.
 */
function collectMeasures(text: string): MeasureUnit {
  const result: MeasureUnit = { cm: [], mm: [], inch: [], cmRange: null, mmRange: null, inchRange: null }
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|to|~)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|in)\b/gi)) {
    const min = numeric(match[1])
    const max = numeric(match[2])
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue
    const pair: [number, number] = [Math.min(min, max), Math.max(min, max)]
    const unit = match[3].toLowerCase()
    if (unit === 'cm') result.cmRange = pair
    else if (unit === 'mm') result.mmRange = pair
    else result.inchRange = pair
  }
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(cm|mm|in)\b/gi)) {
    const value = numeric(match[1])
    if (!Number.isFinite(value)) continue
    const unit = match[2].toLowerCase()
    if (unit === 'cm') result.cm.push(value)
    else if (unit === 'mm') result.mm.push(value)
    else result.inch.push(value)
  }
  return result
}

/** Значение размера в сантиметрах или миллиметрах: диапазон важнее одиночного числа. */
function measureSize(measures: MeasureUnit): { size: string; kind: DavidSizeKind } | null {
  if (measures.cmRange) return { size: formatRange(measures.cmRange[0], measures.cmRange[1], 'см'), kind: 'measure' }
  if (measures.cm.length > 1) {
    return { size: formatRange(Math.min(...measures.cm), Math.max(...measures.cm), 'см'), kind: 'measure' }
  }
  if (measures.cm.length === 1) return { size: formatSingle(measures.cm[0], 'см'), kind: 'measure' }

  const inches = measures.inchRange
    ? measures.inchRange.map((value) => value * FOOT_TO_CM)
    : measures.inch.map((value) => value * FOOT_TO_CM)
  if (inches.length > 1) {
    return { size: formatRange(Math.min(...inches), Math.max(...inches), 'см'), kind: 'measure' }
  }
  if (inches.length === 1) return { size: formatSingle(inches[0], 'см'), kind: 'measure' }

  if (measures.mmRange) return { size: formatRange(measures.mmRange[0], measures.mmRange[1], 'мм'), kind: 'measure' }
  if (measures.mm.length > 1) {
    return { size: formatRange(Math.min(...measures.mm), Math.max(...measures.mm), 'мм'), kind: 'measure' }
  }
  if (measures.mm.length === 1) return { size: formatSingle(measures.mm[0], 'мм'), kind: 'measure' }
  return null
}

/** «Suitable For Wrists 14CM» → «подходит для запястья 14 см». */
function translateFitClause(clause: string) {
  const translated = translateUnits(translateWords(clause, UNIT_WORDS))
  return collapseSpaces(translated)
    .replace(/\s*-\s*/g, '–')
    .toLowerCase()
    .trim()
}

/** «Waist Circumference 28IN» → «обхват пояса 28 in». */
function describeExtraMeasure(text: string) {
  const translated = translateUnits(translateWords(text, SIZE_MEASURE_WORDS))
  return collapseSpaces(translated)
    .replace(/\s*-\s*/g, '–')
    .toLowerCase()
    .trim()
}

export function parseDavidVariantSize(rawValue: unknown): DavidSizeInfo {
  const raw = normalizeDavidSizeText(rawValue)
  if (!raw) return { raw, size: null, fit: '', kind: null }

  const fitMatch = raw.match(/\(([^)]*(?:suitable|wrist|finger|neck|ankle|circumference|adjustable)[^)]*)\)/i)
  const fitClause = fitMatch ? translateFitClause(fitMatch[1]) : ''
  const base = collapseSpaces(fitMatch ? raw.replace(fitMatch[0], ' ') : raw)

  if (NOT_A_SIZE.test(base)) return { raw, size: null, fit: '', kind: null }

  const measures = collectMeasures(base)
  const measured = measureSize(measures)
  if (measured) {
    return { raw, size: measured.size, fit: fitClause || describeExtraMeasure(base), kind: measured.kind }
  }

  const usRing = base.match(/^us\s*(\d+(?:[.,]\d+)?)$/i)
  if (usRing) {
    // Таблицу US→мм не подставляем: это была бы выдуманная характеристика товара.
    return { raw, size: `US ${ruNumber(usRing[1])}`, fit: fitClause, kind: 'us_ring' }
  }

  const letter = collapseSpaces(base.replace(PURCHASE_UNIT_PARENS, ' ')).toUpperCase()
  if (INTERNATIONAL_SIZE.test(letter)) return { raw, size: letter, fit: fitClause, kind: 'letter' }

  return { raw, size: null, fit: fitClause, kind: null }
}

/** Размеры товара из его вариантов: уникальные, в порядке вариантов. */
export function davidVariantSizes(variants: unknown): string[] {
  const sizes: string[] = []
  for (const variant of Array.isArray(variants) ? variants : []) {
    const parsed = parseDavidVariantSize((variant as { size?: unknown })?.size)
    if (parsed.size && !sizes.includes(parsed.size)) sizes.push(parsed.size)
  }
  return sizes
}

/**
 * Таблица замеров: одна строка на размер. Колонка «Посадка» несёт пояснение
 * поставщика («подходит для запястья 14 см»), а размер уже выражен в см.
 */
export function buildDavidMeasurementTable(variants: unknown): MeasurementTable | null {
  const rows: MeasurementTable['rows'] = []
  let convertedFromInches = false
  for (const variant of Array.isArray(variants) ? variants : []) {
    const parsed = parseDavidVariantSize((variant as { size?: unknown })?.size)
    if (!parsed.size) continue
    if (parsed.kind === 'measure' && /\bin\b/i.test(parsed.raw) && !/cm/i.test(parsed.raw)) convertedFromInches = true
    if (rows.some((row) => row.size === parsed.size)) continue
    rows.push({ size: parsed.size, values: { fit: parsed.fit } })
  }
  if (!rows.length) return null

  return {
    unit: 'см',
    columns: [{ key: 'fit', label: 'Посадка' }],
    rows,
    note: convertedFromInches ? 'Размеры поставщика переведены из дюймов.' : '',
  }
}

export interface DavidVariantAttributes {
  sizes: string[]
  measurements: MeasurementTable | null
  /** Строки, которые поставщик выдал как размер, но размером не являются. */
  notSizes: string[]
}

export function davidVariantAttributes(variants: unknown): DavidVariantAttributes {
  const notSizes: string[] = []
  for (const variant of Array.isArray(variants) ? variants : []) {
    const parsed = parseDavidVariantSize((variant as { size?: unknown })?.size)
    if (!parsed.size && parsed.raw && !notSizes.includes(parsed.raw)) notSizes.push(parsed.raw)
  }
  return {
    sizes: davidVariantSizes(variants),
    measurements: buildDavidMeasurementTable(variants),
    notSizes,
  }
}

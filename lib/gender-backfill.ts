import type { Product } from '@/lib/types'

export const GENDER_VALUES = ['Для мужчин', 'Для женщин', 'Унисекс'] as const

export type GenderValue = typeof GENDER_VALUES[number]

export type GenderBackfillStatus =
  | 'ready'
  | 'needs_review'
  | 'not_found'
  | 'has_gender'
  | 'applied'
  | 'skipped'
  | 'error'

export interface GenderCsvRow {
  rowNumber: number
  productId: string
  name: string
  description: string
  raw: Record<string, string>
}

export interface GenderSuggestion {
  gender: GenderValue | ''
  confidence: number
  reason: string
}

export interface GenderBackfillPreviewRow {
  rowNumber: number
  csvProductId: string
  csvName: string
  csvDescription: string
  product?: {
    id: string
    productId: string
    external_id?: string
    sku?: string
    category?: string
    name: string
    description: string
    gender: string
    thumb: string
    status: Product['status']
  }
  suggestedGender: GenderValue | ''
  selectedGender: GenderValue | ''
  confidence: number
  reason: string
  status: GenderBackfillStatus
  selected: boolean
  message?: string
}

export interface GenderBackfillProductSummary {
  id: string
  productId: string
  external_id?: string
  sku?: string
  name: string
  description: string
  gender: string
  thumb: string
  status: Product['status']
  category?: string
}

const SHOES_CATEGORY_IDS = new Set(['nzg3vsvajpiv1e8'])

export function isGenderValue(value: string): value is GenderValue {
  return (GENDER_VALUES as readonly string[]).includes(value)
}

function detectDelimiter(firstLine: string) {
  const candidates = [';', ',', '\t']
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter
}

function parseCsvRows(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    const next = normalized[i + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        value += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      row.push(value.trim())
      value = ''
    } else if (char === '\n' && !quoted) {
      row.push(value.trim())
      if (row.some((item) => item.trim())) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  row.push(value.trim())
  if (row.some((item) => item.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, '').trim()
}

function normalizeId(value: unknown) {
  return String(value || '').trim()
}

function valueByAliases(row: Record<string, string>, aliases: string[]) {
  const exact = aliases.find((alias) => row[alias] !== undefined)
  if (exact) return row[exact]

  const lowerAliases = new Set(aliases.map((alias) => alias.toLowerCase()))
  const key = Object.keys(row).find((item) => lowerAliases.has(item.toLowerCase().trim()))
  return key ? row[key] : ''
}

export function parseGenderCsv(text: string): GenderCsvRow[] {
  const normalized = text.replace(/^\uFEFF/, '')
  const firstLine = normalized.split(/\r?\n/, 1)[0] || ''
  const delimiter = detectDelimiter(firstLine)
  const parsedRows = parseCsvRows(normalized, delimiter)
  if (parsedRows.length < 2) return []

  const headers = parsedRows[0].map(normalizeHeader)
  return parsedRows.slice(1).map((values, index) => {
    const raw: Record<string, string> = {}
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex] || ''
    })

    return {
      rowNumber: index + 2,
      productId: normalizeId(valueByAliases(raw, ['productId', 'product_id', 'external_id', 'sku', 'id', 'артикул'])),
      name: valueByAliases(raw, ['name', 'title', 'название', 'товар']),
      description: valueByAliases(raw, ['description', 'desc', 'описание']),
      raw,
    }
  }).filter((row) => row.productId)
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function explicitGenderFromText(text: string): GenderSuggestion | null {
  const female = /(для женщин|женск|woman|women|female|lady|ladies|女款|女士|女鞋)/i.test(text)
  const male = /(для мужчин|мужск|man|men|male|gentlemen|男款|男士|男鞋)/i.test(text)
  const unisex = /(унисекс|unisex|男女同款|男女款)/i.test(text)

  if (unisex || (female && male)) {
    return { gender: 'Унисекс', confidence: 0.98, reason: 'Явный unisex/оба гендера в тексте' }
  }
  if (female) return { gender: 'Для женщин', confidence: 0.96, reason: 'Явный женский маркер в тексте' }
  if (male) return { gender: 'Для мужчин', confidence: 0.96, reason: 'Явный мужской маркер в тексте' }
  return null
}

function isLikelyShoes(row: GenderCsvRow, product?: Pick<Product, 'name' | 'description' | 'category'> | GenderBackfillProductSummary) {
  const text = `${row.name} ${row.description} ${product?.name || ''} ${product?.description || ''}`
  const category = String(row.raw.category || product?.category || '')
  if (SHOES_CATEGORY_IDS.has(category)) return true
  return /(обув|кроссов|лофер|ботин|сапог|сандал|туфл|балет|мюли|кеды|sneaker|shoe|boot|loafer|sandal|heel|鞋|靴|凉鞋)/i.test(text)
}

function shoeSizeGenderFromText(text: string, row: GenderCsvRow, product?: Pick<Product, 'name' | 'description' | 'category'> | GenderBackfillProductSummary): GenderSuggestion | null {
  if (!isLikelyShoes(row, product)) return null

  const ranges = [...text.matchAll(/(?:размеры?|sizes?|size|码数|尺码)?\s*[:：]?\s*(3[4-9]|4[0-9])\s*[-–—]\s*(3[5-9]|4[0-9])/gi)]
    .map((match) => [Number(match[1]), Number(match[2])])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start <= end)

  if (ranges.length === 0) return null

  let female = false
  let male = false
  let unisex = false

  for (const [start, end] of ranges) {
    if (start <= 36 && end >= 44) unisex = true
    else if (start >= 39 && end >= 44) male = true
    else if (start <= 36 && end <= 42) female = true
    else if (start <= 38 && end <= 41) female = true
  }

  const reason = `Размерный ряд обуви: ${ranges.map((range) => range.join('-')).join(', ')}`
  if (unisex || (female && male)) return { gender: 'Унисекс', confidence: 0.94, reason }
  if (male) return { gender: 'Для мужчин', confidence: 0.92, reason }
  if (female) return { gender: 'Для женщин', confidence: 0.92, reason }
  return null
}

export function suggestGender(row: GenderCsvRow, product?: Pick<Product, 'name' | 'description' | 'category'> | GenderBackfillProductSummary): GenderSuggestion {
  const text = normalizeText(`${row.name}\n${row.description}\n${product?.name || ''}\n${product?.description || ''}`)
  return explicitGenderFromText(text)
    || shoeSizeGenderFromText(text, row, product)
    || { gender: '', confidence: 0, reason: 'Нет явных маркеров; нужен ручной выбор' }
}

export function productMatchIds(product: Pick<Product, 'id' | 'external_id' | 'sku' | 'productId'>) {
  return [product.external_id, product.sku, product.productId, product.id]
    .map(normalizeId)
    .filter(Boolean)
}

export function findExactProductMatch(products: Product[], productId: string) {
  const needle = normalizeId(productId)
  return products.find((product) => productMatchIds(product).includes(needle))
}

export function buildPreviewRow(row: GenderCsvRow, product?: Product | GenderBackfillProductSummary): GenderBackfillPreviewRow {
  if (!product) {
    return {
      rowNumber: row.rowNumber,
      csvProductId: row.productId,
      csvName: row.name,
      csvDescription: row.description,
      suggestedGender: '',
      selectedGender: '',
      confidence: 0,
      reason: 'Товар не найден в Rails CRM по точному id',
      status: 'not_found',
      selected: false,
    }
  }

  if (product.status === 'archived') {
    return {
      rowNumber: row.rowNumber,
      csvProductId: row.productId,
      csvName: row.name,
      csvDescription: row.description,
      product: compactProduct(product),
      suggestedGender: '',
      selectedGender: '',
      confidence: 0,
      reason: 'Archived товары не обновляются',
      status: 'skipped',
      selected: false,
    }
  }

  if (product.gender) {
    return {
      rowNumber: row.rowNumber,
      csvProductId: row.productId,
      csvName: row.name,
      csvDescription: row.description,
      product: compactProduct(product),
      suggestedGender: '',
      selectedGender: '',
      confidence: 1,
      reason: 'У товара уже заполнен gender',
      status: 'has_gender',
      selected: false,
    }
  }

  const suggestion = suggestGender(row, product)
  const ready = Boolean(suggestion.gender)

  return {
    rowNumber: row.rowNumber,
    csvProductId: row.productId,
    csvName: row.name,
    csvDescription: row.description,
    product: compactProduct(product),
    suggestedGender: suggestion.gender,
    selectedGender: suggestion.gender,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    status: ready ? 'ready' : 'needs_review',
    selected: ready,
  }
}

export function compactProduct(product: Product | GenderBackfillProductSummary): GenderBackfillPreviewRow['product'] {
  return {
    id: product.id,
    productId: product.productId,
    external_id: product.external_id,
    sku: product.sku,
    category: product.category,
    name: product.name,
    description: product.description,
    gender: product.gender,
    thumb: product.thumb,
    status: product.status,
  }
}

export function compactProductSummary(product: Product): GenderBackfillProductSummary {
  return {
    id: product.id,
    productId: product.productId,
    external_id: product.external_id,
    sku: product.sku,
    category: product.category,
    name: product.name,
    description: product.description,
    gender: product.gender,
    thumb: product.thumb,
    status: product.status,
  }
}

export function serializeGenderBackfillReport(rows: GenderBackfillPreviewRow[]) {
  const headers = [
    'status',
    'csvProductId',
    'dbId',
    'sku',
    'productName',
    'csvName',
    'selectedGender',
    'suggestedGender',
    'confidence',
    'reason',
    'message',
  ]

  const escape = (value: unknown) => {
    const raw = value == null ? '' : String(value)
    return /[",;\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
  }

  return [
    headers.join(';'),
    ...rows.map((row) => [
      row.status,
      row.csvProductId,
      row.product?.id || '',
      row.product?.sku || '',
      row.product?.name || '',
      row.csvName,
      row.selectedGender,
      row.suggestedGender,
      row.confidence,
      row.reason,
      row.message || '',
    ].map(escape).join(';')),
  ].join('\n')
}

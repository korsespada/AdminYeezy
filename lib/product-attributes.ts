export type ProductAttributeValue = string | number | boolean | null | ProductAttributeValue[]

export type ProductAttributes = Record<string, ProductAttributeValue>

export const CORE_PRODUCT_FIELDS = new Set([
  'id',
  'external_id',
  'name',
  'description',
  'h1',
  'seo_title',
  'seo_description',
  'price',
  'price_source',
  'status',
  'brand',
  'category',
  'subcategory',
  'gender',
  'photos',
  'batch_id',
  'batchid',
  'ai_processed',
  'ai_sampled',
  'variant_group_key',
  'ai_error',
  'ai_confidence',
  'source_position',
  'attributes',
  'created_at',
  'updated_at',
])

function isAttributeValue(value: unknown): value is ProductAttributeValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  return Array.isArray(value) && value.every(isAttributeValue)
}

export function normalizeProductAttributes(value: unknown): ProductAttributes {
  if (!value) return {}

  let parsed = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const result: ProductAttributes = {}
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = rawKey.trim()
    if (!key || CORE_PRODUCT_FIELDS.has(key.toLowerCase()) || !isAttributeValue(rawValue)) continue
    result[key] = rawValue
  }
  return result
}

export function extractProductAttributes(row: Record<string, unknown>): ProductAttributes {
  const result = normalizeProductAttributes(row.attributes)

  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.trim()
    if (!key || CORE_PRODUCT_FIELDS.has(key.toLowerCase()) || value === undefined || value === null || value === '') continue
    if (isAttributeValue(value)) result[key] = value
    else if (typeof value === 'string') result[key] = value
  }

  return {
    ...extractExplicitShoeAttributes(`${row.name || ''}\n${row.description || ''}`),
    ...result,
  }
}

export function hasProductAttributes(value: unknown): boolean {
  return Object.keys(normalizeProductAttributes(value)).length > 0
}

/**
 * Conservative first-pass rules for supplier text. Only explicitly labelled
 * values are accepted here; ambiguous prose is left to AI/review.
 */
export function extractExplicitShoeAttributes(textValue: unknown): ProductAttributes {
  const text = String(textValue || '').replace(/\\n/g, '\n')
  if (!text.trim()) return {}

  const attributes: ProductAttributes = {}
  const sizesRaw = labelledValue(text, /(?:(?:доступные|available)\s+)?(?:размеры?|sizes?)/i)
  const sizes = normalizeNumericSizes(sizesRaw)
  if (sizes.length > 0) attributes.sizes = sizes

  const sizeSystem = sizesRaw.match(/\b(EU|US|UK|IT|RU)\b/i)?.[1]
  if (sizeSystem) attributes.size_system = sizeSystem.toUpperCase()

  assignLabelled(attributes, 'colors', text, /(?:цвета?|colors?)/i, true)
  assignLabelled(attributes, 'upper_material', text, /(?:материал\s+верха|верх|upper(?:\s+material)?)/i)
  assignLabelled(attributes, 'lining_material', text, /(?:материал\s+подкладки|подкладка|lining(?:\s+material)?)/i)
  assignLabelled(attributes, 'sole_material', text, /(?:материал\s+подошвы|подошва|sole(?:\s+material)?)/i)
  assignLabelled(attributes, 'model_name', text, /(?:модель|model)/i)

  const heel = text.match(/(?:высота\s+каблука|каблук|heel\s+height)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(см|mm|мм|cm)(?=\s|$)/i)
  if (heel) attributes.heel_height = `${heel[1].replace(',', '.')} ${normalizeUnit(heel[2])}`

  return attributes
}

function labelledValue(text: string, label: RegExp): string {
  const match = text.match(new RegExp(`(?:^|\\n|[.!?]\\s+)\\s*${label.source}\\s*[:\\-]\\s*([^\\n.!?]+)`, 'i'))
  return match?.[1]?.trim() || ''
}

function assignLabelled(
  attributes: ProductAttributes,
  code: string,
  text: string,
  label: RegExp,
  multiple = false,
) {
  const value = labelledValue(text, label)
  if (!value) return
  attributes[code] = multiple
    ? value.split(/[,;/|]+/).map((item) => item.trim()).filter(Boolean)
    : value
}

function normalizeNumericSizes(raw: string): string[] {
  if (!raw) return []
  const cleaned = raw
    .replace(/\b(?:EU|US|UK|IT|RU)\b/gi, '')
    .replace(/\s*(?:размер(?:ы|ный ряд)?|sizes?)\s*$/i, '')
    .trim()
  const range = cleaned.match(/^(\d{1,3}(?:[.,]5)?)\s*[-–—]\s*(\d{1,3}(?:[.,]5)?)$/)
  if (range) {
    const from = Number(range[1].replace(',', '.'))
    const to = Number(range[2].replace(',', '.'))
    const step = Number.isInteger(from) && Number.isInteger(to) ? 1 : 0.5
    const count = Math.floor((to - from) / step) + 1
    if (to >= from && count <= 20) {
      return Array.from({ length: count }, (_, index) => formatSize(from + index * step))
    }
  }

  return [...new Set(cleaned
    .split(/[,;/|]+/)
    .map((item) => item.trim().replace(',', '.').replace(/[^\d.]+$/g, ''))
    .filter((item) => /^(?:\d{1,3})(?:\.5)?$/.test(item)))]
}

function formatSize(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function normalizeUnit(value: string) {
  return /^(?:мм|mm)$/i.test(value) ? 'мм' : 'см'
}

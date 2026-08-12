export const MEASUREMENT_TEMPLATE_GARMENTS = [
  { value: 'pants', label: 'Штаны' },
  { value: 'zip_hoodie', label: 'Зип-худи' },
  { value: 'hoodie', label: 'Худи' },
  { value: 'shorts', label: 'Шорты' },
  { value: 'waffle_longsleeve', label: 'Вафельный лонгслив' },
  { value: 'other', label: 'Другое' },
] as const

export type MeasurementTemplateGarment = typeof MEASUREMENT_TEMPLATE_GARMENTS[number]['value']

export type MeasurementColumn = { key: string; label: string }
export type MeasurementRow = { size: string; values: Record<string, string> }
export type MeasurementTable = {
  unit: string
  columns: MeasurementColumn[]
  rows: MeasurementRow[]
  note?: string
}

export type MeasurementTemplate = {
  id: number
  supplierId: number
  supplierName?: string
  name: string
  garmentType: MeasurementTemplateGarment
  measurements: MeasurementTable
  sourceImageUrl: string | null
  notes: string
  createdAt?: string
  updatedAt?: string
}

export function measurementTemplateGarmentLabel(value: string) {
  return MEASUREMENT_TEMPLATE_GARMENTS.find((item) => item.value === value)?.label || 'Другое'
}

function normalizedProductTypeText(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

export function measurementTemplateGarmentForProduct(value: {
  name?: unknown
  h1?: unknown
  subcategoryName?: unknown
}): MeasurementTemplateGarment | null {
  // Description deliberately does not participate: it can mention a matching
  // item as an outfit suggestion and must not cause a wrong size chart.
  const text = [value.name, value.h1, value.subcategoryName]
    .map(normalizedProductTypeText)
    .filter(Boolean)
    .join(' ')
  if (!text) return null

  const matches = new Set<MeasurementTemplateGarment>()
  if (/(вафельн\w*\s+лонгслив|лонгслив\w*\s+вафельн)/i.test(text)) matches.add('waffle_longsleeve')
  if (/(зип\s*худи|zip\s*hoodie|худи.{0,24}(молни|zip)|(?:кофта|толстовка).{0,24}(молни|zip))/i.test(text)) {
    matches.add('zip_hoodie')
  } else if (/(?:^|\s)(?:худи|hoodie|толстовк\w*)(?:\s|$)/i.test(text)) {
    matches.add('hoodie')
  }
  if (/(шорт\w*|бермуд\w*|\bshorts?\b)/i.test(text)) matches.add('shorts')
  if (/(брюк\w*|штан\w*|джоггер\w*|треник\w*|\b(?:pants|trousers|sweatpants)\b)/i.test(text)) matches.add('pants')

  return matches.size === 1 ? [...matches][0] : null
}

export function measurementTemplateForProduct(
  templates: MeasurementTemplate[],
  product: { name?: unknown; h1?: unknown; subcategoryName?: unknown },
) {
  const garmentType = measurementTemplateGarmentForProduct(product)
  if (!garmentType) return null
  const candidates = templates.filter((template) => template.garmentType === garmentType)
  return candidates.length === 1 ? candidates[0] : null
}

function shortText(value: unknown, limit: number) {
  return String(value ?? '').trim().slice(0, limit)
}

function normalizedKey(value: unknown, fallback: string, used: Set<string>) {
  const base = shortText(value, 48).toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback
  let key = base
  let suffix = 2
  while (used.has(key)) key = `${base}_${suffix++}`
  used.add(key)
  return key
}

export function normalizeMeasurementTable(value: unknown): MeasurementTable | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.columns) || !Array.isArray(source.rows)) return null

  const usedKeys = new Set<string>()
  const columns = source.columns.slice(0, 12).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    const label = shortText(item.label || item.key, 80)
    if (!label) return []
    return [{ key: normalizedKey(item.key, `measurement_${index + 1}`, usedKeys), label }]
  })
  if (!columns.length) return null

  const allowedKeys = new Set(columns.map((column) => column.key))
  const rows = source.rows.slice(0, 40).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    const size = shortText(item.size, 40)
    const rawValues = item.values && typeof item.values === 'object' && !Array.isArray(item.values)
      ? item.values as Record<string, unknown>
      : {}
    const values = Object.fromEntries(
      Object.entries(rawValues)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, cell]) => [key, shortText(cell, 80)]),
    )
    return [{ size, values }]
  })
  if (!rows.length) return null

  return {
    unit: shortText(source.unit || 'см', 16) || 'см',
    columns,
    rows,
    note: shortText(source.note, 1000),
  }
}

export function normalizeMeasurementTemplateInput(value: {
  id?: unknown
  supplierId?: unknown
  name?: unknown
  garmentType?: unknown
  measurements?: unknown
  sourceImageUrl?: unknown
  notes?: unknown
}) {
  const garmentType = MEASUREMENT_TEMPLATE_GARMENTS.some((item) => item.value === value.garmentType)
    ? value.garmentType as MeasurementTemplateGarment
    : 'other'
  const sourceImageUrl = shortText(value.sourceImageUrl, 2000)
  if (sourceImageUrl && !/^https?:\/\//i.test(sourceImageUrl)) throw new Error('Ссылка на скриншот должна начинаться с http:// или https://')
  const measurements = normalizeMeasurementTable(value.measurements)
  if (!measurements) throw new Error('Добавьте хотя бы одну колонку и строку в таблицу замеров')
  const name = shortText(value.name, 160)
  if (!name) throw new Error('Укажите название шаблона')
  const supplierId = Number(value.supplierId)
  if (!Number.isInteger(supplierId) || supplierId <= 0) throw new Error('Выберите поставщика для шаблона')

  return {
    id: Number.isInteger(Number(value.id)) && Number(value.id) > 0 ? Number(value.id) : null,
    supplierId,
    name,
    garmentType,
    measurements,
    sourceImageUrl: sourceImageUrl || null,
    notes: shortText(value.notes, 2000),
  }
}

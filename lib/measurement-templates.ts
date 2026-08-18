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

export type MeasurementTab = MeasurementTable & {
  label: string
}

export type ProductMeasurements = MeasurementTable | {
  tabs: MeasurementTab[]
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

/** Размеры, указанные строками таблицы, используются также как варианты товара. */
export function measurementTableSizes(value: unknown): string[] {
  const table = normalizeMeasurementTable(value)
  if (!table) return []
  return [...new Set(table.rows
    .map((row) => String(row.size || '').trim())
    .filter(Boolean))]
}

/** Named tables are used only for multi-piece products. A legacy single table stays tab-free. */
export function measurementTables(value: unknown): MeasurementTab[] {
  const normalized = normalizeProductMeasurements(value)
  return normalized && 'tabs' in normalized ? normalized.tabs : []
}

export function productMeasurementSizes(value: unknown): string[] {
  const normalized = normalizeProductMeasurements(value)
  if (!normalized) return []
  if ('tabs' in normalized) return normalized.tabs.flatMap(measurementTableSizes)
  return measurementTableSizes(normalized)
}

export function applyMeasurementTableAttributes(
  attributes: Record<string, any> | null | undefined,
  measurements: unknown,
) {
  const normalizedMeasurements = normalizeProductMeasurements(measurements)
  const next: Record<string, any> = {
    ...(attributes || {}),
    measurements: normalizedMeasurements || measurements,
  }
  const sizes = productMeasurementSizes(normalizedMeasurements)
  if (!sizes.length) return next

  const existing = next.sizes
  const existingValues = Array.isArray(existing)
    ? existing.map(String)
    : existing && typeof existing === 'object' && Array.isArray(existing.values)
      ? existing.values.map(String)
      : existing === undefined || existing === null || existing === '' ? [] : [String(existing)]
  const mergedSizes = [...new Set([...existingValues, ...sizes].map((value) => value.trim()).filter(Boolean))]
  next.sizes = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing, values: mergedSizes }
    : mergedSizes
  if (!next.size_system && mergedSizes.some((size) => /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)$/i.test(size))) {
    next.size_system = 'International'
  }
  return next
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

const MEASUREMENT_KEY_ALIASES: Record<string, string> = {
  shoulder: 'shoulders',
  shoulders: 'shoulders',
  shoulder_width: 'shoulders',
  shoulderwidth: 'shoulders',
  sleeve: 'sleeve',
  sleeve_length: 'sleeve',
  sleevelength: 'sleeve',
  chest: 'chest',
  bust: 'chest',
  chest_girth: 'chest',
  chest_circ: 'chest',
  chest_circumference: 'chest',
  chest_width: 'chest',
  hip: 'hips',
  hips: 'hips',
  back_length: 'length',
  garment_length: 'length',
  length: 'length',
}

function measurementToken(value: unknown) {
  return shortText(value, 80).toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function canonicalMeasurementKey(key: unknown, label: unknown) {
  const keyToken = measurementToken(key)
  const labelToken = measurementToken(label)
  return MEASUREMENT_KEY_ALIASES[keyToken] || MEASUREMENT_KEY_ALIASES[labelToken] || keyToken || labelToken
}

function parseMeasurementValue(value: unknown) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!/^[\[{]/u.test(text)) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

export function normalizeMeasurementTable(value: unknown): MeasurementTable | null {
  const parsed = parseMeasurementValue(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const source = parsed as Record<string, unknown>
  if (!Array.isArray(source.columns) || !Array.isArray(source.rows)) return null

  const usedKeys = new Set<string>()
  const sourceKeys = new Map<string, string>()
  const canonicalKeys = new Map<string, string>()
  const columns = source.columns.slice(0, 12).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    const label = shortText(item.label || item.key, 80)
    if (!label) return []
    const canonicalKey = canonicalMeasurementKey(item.key, item.label)
    const key = normalizedKey(canonicalKey, `measurement_${index + 1}`, usedKeys)
    for (const alias of [item.key, item.label, canonicalKey].map(measurementToken).filter(Boolean)) {
      if (!sourceKeys.has(alias)) sourceKeys.set(alias, key)
    }
    if (!canonicalKeys.has(canonicalKey)) canonicalKeys.set(canonicalKey, key)
    return [{ key, label }]
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
    const values = Object.fromEntries(Object.entries(rawValues).flatMap(([key, cell]) => {
      const token = measurementToken(key)
      const outputKey = sourceKeys.get(token)
        || canonicalKeys.get(canonicalMeasurementKey(key, ''))
        || (allowedKeys.has(key) ? key : '')
      return outputKey ? [[outputKey, shortText(cell, 80)]] : []
    }))
    return [{ size, values }]
  })
  if (!rows.length) return null

  return {
    unit: shortText(source.unit || 'см', 16) || 'см',
    columns,
    rows,
    ...(source.note !== undefined ? { note: shortText(source.note, 1000) } : {}),
  }
}

/**
 * Supports the legacy single-table shape and the multi-piece product shape.
 * A single valid tab deliberately collapses back to the legacy shape so the
 * storefront does not render a redundant tab control.
 */
export function normalizeProductMeasurements(value: unknown): ProductMeasurements | null {
  const single = normalizeMeasurementTable(value)
  if (single) return single

  const parsed = parseMeasurementValue(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const source = parsed as Record<string, unknown>
  if (!Array.isArray(source.tabs)) return null

  const usedLabels = new Set<string>()
  const tabs = source.tabs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const tab = entry as Record<string, unknown>
    const label = normalizedMeasurementTabLabel(tab.label)
    const table = normalizeMeasurementTable(tab)
    const labelKey = label.toLocaleLowerCase('ru-RU')
    if (!label || !table || usedLabels.has(labelKey)) return []
    usedLabels.add(labelKey)
    return [{ label, ...table }]
  }).slice(0, 4)

  if (tabs.length === 0) return null
  if (tabs.length === 1) {
    const tab = tabs[0]
    return { unit: tab.unit, columns: tab.columns, rows: tab.rows, note: tab.note }
  }
  return { tabs }
}

function normalizedMeasurementTabLabel(value: unknown) {
  return shortText(value, 80)
    .trim()
    .split(/\s+/u)[0]
    .replace(/[^\p{L}-]/gu, '')
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

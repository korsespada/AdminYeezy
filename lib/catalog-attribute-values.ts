import {
  getCatalogAttributeDefinitionsForCategory,
  resolveCatalogAttributeCode,
  type CatalogAttributeDefinition,
} from '@/lib/catalog-attribute-schema'
import { normalizeProductMeasurements } from '@/lib/measurement-templates'

const COLOR_VALUES: Record<string, string> = {
  black: 'Чёрный', 'черный': 'Чёрный', 'чёрный': 'Чёрный', noir: 'Чёрный',
  white: 'Белый', 'белый': 'Белый',
  beige: 'Бежевый', 'бежевый': 'Бежевый',
  brown: 'Коричневый', 'коричневый': 'Коричневый',
  gray: 'Серый', grey: 'Серый', 'серый': 'Серый', 'графитовый': 'Серый',
  blue: 'Синий', 'синий': 'Синий', navy: 'Синий', 'голубой': 'Синий',
  red: 'Красный', 'красный': 'Красный',
  pink: 'Розовый', 'розовый': 'Розовый',
  green: 'Зелёный', 'зеленый': 'Зелёный', 'зелёный': 'Зелёный',
  purple: 'Фиолетовый', 'фиолетовый': 'Фиолетовый',
  burgundy: 'Бордовый', 'бордовый': 'Бордовый',
  yellow: 'Жёлтый', 'желтый': 'Жёлтый', 'жёлтый': 'Жёлтый',
  orange: 'Оранжевый', 'оранжевый': 'Оранжевый',
  gold: 'Золотой', 'золотой': 'Золотой',
  silver: 'Серебристый', 'серебристый': 'Серебристый',
}

const MATERIAL_VALUES: Record<string, string> = {
  leather: 'Кожа', 'кожа': 'Кожа', 'натуральная кожа': 'Кожа',
  suede: 'Замша', 'замша': 'Замша',
  textile: 'Текстиль', 'текстиль': 'Текстиль', fabric: 'Текстиль',
  cotton: 'Хлопок', 'хлопок': 'Хлопок',
  wool: 'Шерсть', 'шерсть': 'Шерсть',
  cashmere: 'Кашемир', 'кашемир': 'Кашемир',
  silk: 'Шёлк', 'шелк': 'Шёлк', 'шёлк': 'Шёлк',
  linen: 'Лён', 'лен': 'Лён', 'лён': 'Лён',
  denim: 'Деним', 'деним': 'Деним',
  polyester: 'Полиэстер', 'полиэстер': 'Полиэстер',
  nylon: 'Нейлон', 'нейлон': 'Нейлон',
  metal: 'Металл', 'металл': 'Металл',
  plastic: 'Пластик', 'пластик': 'Пластик',
  rubber: 'Резина', 'резина': 'Резина',
  mesh: 'Сетка', 'сетка': 'Сетка',
  fur: 'Мех', 'мех': 'Мех',
  steel: 'Сталь', 'сталь': 'Сталь',
  gold: 'Золото', 'золото': 'Золото',
  titanium: 'Титан', 'титан': 'Титан',
  ceramic: 'Керамика', 'керамика': 'Керамика',
  aluminum: 'Алюминий', aluminium: 'Алюминий', 'алюминий': 'Алюминий',
  polycarbonate: 'Поликарбонат', 'поликарбонат': 'Поликарбонат',
  polypropylene: 'Полипропилен', 'полипропилен': 'Полипропилен',
  abs: 'ABS-пластик', 'abs-пластик': 'ABS-пластик', 'абс-пластик': 'ABS-пластик',
  composite: 'Композит', 'композит': 'Композит',
  carbon: 'Карбон', 'карбон': 'Карбон',
  coated_canvas: 'Канвас с покрытием', 'канвас с покрытием': 'Канвас с покрытием',
}

const MATERIAL_CODES = new Set([
  'materials',
  'upper_material',
  'lining_material',
  'sole_material',
  'watch_case_material',
  'strap_material',
  'luggage_case_material',
])

const DEPRECATED_CODES = new Set([
  'season',
  'age_group',
  'country_of_origin',
  'collection',
  'pattern',
  'print',
])

export function normalizeCatalogAttributes(
  value: unknown,
  options: {
    categoryName?: string | null
    subcategoryName?: string | null
    allowedCodes?: string[]
    preserveUnknown?: boolean
    definitions?: CatalogAttributeDefinition[]
  } = {},
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const categoryName = String(options.categoryName || '')
  const allowed = new Set(options.allowedCodes?.length
    ? options.allowedCodes
    : getCatalogAttributeDefinitionsForCategory(categoryName, options.subcategoryName).map((item) => item.code))
  const isShoes = normalizeText(categoryName) === 'обувь'
  const result: Record<string, unknown> = {}

  for (const [rawCode, rawValue] of Object.entries(value as Record<string, unknown>)) {
    let code = resolveCatalogAttributeCode(rawCode)
    if (DEPRECATED_CODES.has(code)) continue
    if (isShoes && code === 'materials') code = 'upper_material'
    if (!allowed.has(code) && !options.preserveUnknown) continue

    const normalized = applyDictionaryValue(
      code,
      normalizeAttributeValue(code, rawValue),
      options.definitions,
    )
    if (!isEmpty(normalized)) result[code] = normalized
  }

  return result
}

function applyDictionaryValue(
  code: string,
  value: unknown,
  definitions?: CatalogAttributeDefinition[],
): unknown {
  const dictionary = definitions
    ?.find((definition) => definition.code === code)
    ?.dictionary_values
    ?.filter((item) => item.active)
  if (!dictionary?.length) return value

  const canonicalByText = new Map<string, string>()
  for (const item of dictionary) {
    canonicalByText.set(normalizeText(item.canonical_value), item.canonical_value)
    for (const alias of item.aliases) canonicalByText.set(normalizeText(alias), item.canonical_value)
  }
  const canonicalize = (item: unknown) => canonicalByText.get(normalizeText(String(item))) || item

  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const structured = value as Record<string, unknown>
    if (Array.isArray(structured.values)) {
      return { ...structured, values: structured.values.map(canonicalize) }
    }
  }
  if (typeof value === 'string' || typeof value === 'number') return canonicalize(value)
  return value
}

export function normalizeAttributeValue(code: string, value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (code === 'measurements') return normalizeMeasurements(value)
  if (code === 'sizes' || code === 'jewelry_size') return normalizeStructuredSizes(value)
  const structured = structuredAttributeValue(value)
  if (structured !== undefined) value = structured
  if (code === 'colors') return normalizeList(value).map((item) => COLOR_VALUES[normalizeText(item)] || titleCase(item))
  if (MATERIAL_CODES.has(code)) return normalizeList(value).map((item) => MATERIAL_VALUES[normalizeText(item)] || titleCase(item))
  if (code === 'size_system') {
    const system = String(value).trim()
    return /^international$/i.test(system) ? 'International' : system.toUpperCase()
  }
  if (Array.isArray(value)) return normalizeList(value)
  if (typeof value === 'string') return value.trim().replace(/(\d)\s*[xх×]\s*(?=\d)/gi, '$1 × ')
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return undefined
}

function normalizeMeasurements(value: unknown) {
  return normalizeProductMeasurements(value) || undefined
}

function structuredAttributeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>

  for (const key of ['raw_values', 'names', 'display_values', 'filter_values', 'families', 'values']) {
    if (Array.isArray(source[key])) return source[key]
  }
  for (const key of ['display_value', 'filter_value', 'value']) {
    if (typeof source[key] === 'string' || typeof source[key] === 'number') return source[key]
  }
  return undefined
}

export function normalizeSizes(value: unknown): string[] {
  const source = structuredSizeValues(value)
  return [...new Set(normalizeList(source)
    .flatMap((item) => expandSizeRange(item))
    .map((item) => item.trim().replace(',', '.').toUpperCase())
    .filter(Boolean))]
}

function normalizeStructuredSizes(value: unknown) {
  const values = normalizeSizes(value)
  if (values.length === 0) return undefined

  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
  const groups = Array.isArray(source.groups)
    ? source.groups.map((group: any) => {
      const groupValues = normalizeSizes(group?.values?.length ? group.values : values)
      return {
        ...(Number.isFinite(Number(group?.min)) ? { min: Number(group.min) } : {}),
        ...(Number.isFinite(Number(group?.max)) ? { max: Number(group.max) } : {}),
        ...(group?.system ? { system: String(group.system).toUpperCase() } : {}),
        ...(group?.audience ? { audience: String(group.audience) } : {}),
        values: groupValues,
      }
    }).filter((group: any) => group.values.length > 0)
    : []

  return { values, ...(groups.length > 0 ? { groups } : {}) }
}

function normalizeList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;/|]+/)
  return source.map((item) => String(item || '').trim()).filter(Boolean)
}

function structuredSizeValues(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, any>
  if (Array.isArray(source.values)) return source.values
  if (Array.isArray(source.groups)) {
    return source.groups.flatMap((group: any) => Array.isArray(group?.values) ? group.values : [])
  }
  return []
}

function expandSizeRange(value: string) {
  const match = value.trim().replace(',', '.').match(/^(\d{1,3}(?:\.5)?)\s*[-–—]\s*(\d{1,3}(?:\.5)?)$/)
  if (!match) return [value]
  const from = Number(match[1])
  const to = Number(match[2])
  const step = Number.isInteger(from) && Number.isInteger(to) ? 1 : 0.5
  const count = Math.floor((to - from) / step) + 1
  if (to < from || count > 30) return [value]
  return Array.from({ length: count }, (_, index) => {
    const current = from + index * step
    return Number.isInteger(current) ? String(current) : current.toFixed(1)
  })
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim()
}

function titleCase(value: string) {
  const text = value.trim()
  return text ? `${text.charAt(0).toLocaleUpperCase('ru-RU')}${text.slice(1)}` : text
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

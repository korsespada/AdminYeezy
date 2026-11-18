// Правила, которые отделяют настоящий размерный ряд от чисел, попавших в
// `sizes` из габаритов, номера модели или подписи одной вещи. Модуль чистый:
// его используют нормализация ответа ИИ и разовая чистка каталога.

export type CatalogSizeRuleInput = {
  categoryName?: string | null
  subcategoryName?: string | null
  sizes: unknown
  sourceText?: string | null
}

export type CatalogSizeRuleResult = {
  changed: boolean
  /** null — атрибут нужно удалить целиком; иначе массив или объект `{values}`. */
  sizes: unknown
  removed: string[]
  /** Номинальный размер сумки (17–32), который уходит в название. */
  nominalBagSize: string
}

const BAG_CATEGORY = 'сумки'
const JEWELRY_CATEGORY = 'ювелирные изделия'

// Подкатегории, где число в `sizes` — это габарит, а не размерный ряд.
const DIMENSION_ONLY_SUBCATEGORIES = new Set([
  'кошельки и картхолдеры',
  'обложки для паспорта',
  'косметички',
  'очки',
])

const LUGGAGE_SUBCATEGORY = 'чемоданы'
// Дюймовый размер чемодана: 20…33 (21 и 31 — реальные модели Rimowa).
const LUGGAGE_MIN_INCH = 20
const LUGGAGE_MAX_INCH = 33

function isLuggageInchSize(value: string) {
  if (!/^\d{2}$/.test(value)) return false
  const number = Number(value)
  return number >= LUGGAGE_MIN_INCH && number <= LUGGAGE_MAX_INCH
}

const NUMERIC_SIZE = /^\d{1,3}(?:[.,]\d+)?$/
const FRAME_SIZE = /^\d{2,3}-\d{1,3}-\d{1,3}$/
const ONE_SIZE_TOKENS = new Set(['os', 'onesize', 'one size', 'uni', 'u', 'is', 'f', 'free', '均码'])

function normalizeName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

function sizeValues(sizes: unknown): string[] {
  if (Array.isArray(sizes)) return sizes.map((value) => String(value ?? '').trim()).filter(Boolean)
  if (sizes && typeof sizes === 'object') {
    const values = (sizes as Record<string, unknown>).values
    if (Array.isArray(values)) return values.map((value) => String(value ?? '').trim()).filter(Boolean)
  }
  return []
}

function rebuildSizes(sizes: unknown, values: string[]): unknown {
  if (Array.isArray(sizes)) return values
  if (sizes && typeof sizes === 'object') return { ...(sizes as Record<string, unknown>), values }
  return values
}

/** Явная метка размера в тексте поставщика: «尺寸：17», «Размер: 52», «17号». */
export function hasExplicitSizeLabel(sourceText: unknown): boolean {
  const text = String(sourceText ?? '').normalize('NFKC')
  if (!text.trim()) return false
  if (/(?:尺寸|size|размер|圈口|手围|周长|指圈)\s*[:：]?\s*\d/i.test(text)) return true
  // «17号» — китайский размер кольца. «款号：795221» не совпадает: перед 号 нет цифр.
  return /\d{1,2}\s*号(?![码])/u.test(text)
}

function isOneSizeToken(value: string) {
  return ONE_SIZE_TOKENS.has(value.trim().toLowerCase())
}

function isNumericSize(value: string) {
  return NUMERIC_SIZE.test(value.trim())
}

/**
 * Приводит `sizes` к размерному ряду категории. Возвращает `changed: false`,
 * когда правило категорию не затрагивает или удалять нечего.
 */
export function applyCatalogSizeRules(input: CatalogSizeRuleInput): CatalogSizeRuleResult {
  const category = normalizeName(input.categoryName)
  const subcategory = normalizeName(input.subcategoryName)
  const values = sizeValues(input.sizes)
  const untouched: CatalogSizeRuleResult = {
    changed: false,
    sizes: Array.isArray(input.sizes) ? values : null,
    removed: [],
    nominalBagSize: '',
  }
  if (values.length === 0) return untouched

  const keep = (predicate: (value: string) => boolean) => values.filter(predicate)

  if (category === BAG_CATEGORY) {
    const nominalBagSize = values.find((value) => /^(?:1[7-9]|2[0-9]|3[0-2])$/u.test(value)) || ''
    return {
      changed: true,
      sizes: null,
      removed: values,
      nominalBagSize,
    }
  }

  if (category === JEWELRY_CATEGORY) {
    // У ювелирки размер — это размер кольца или браслета; без метки в тексте
    // поставщика модель его выдумывает, поэтому принимаем только подтверждённый.
    if (hasExplicitSizeLabel(input.sourceText)) return untouched
    return { changed: true, sizes: null, removed: values, nominalBagSize: '' }
  }

  if (DIMENSION_ONLY_SUBCATEGORIES.has(subcategory)) {
    const kept = keep((value) => !isNumericSize(value) && !FRAME_SIZE.test(value))
    if (kept.length === values.length) return untouched
    return {
      changed: true,
      sizes: kept.length > 0 ? rebuildSizes(input.sizes, kept) : null,
      removed: values.filter((value) => !kept.includes(value)),
      nominalBagSize: '',
    }
  }

  if (subcategory === LUGGAGE_SUBCATEGORY) {
    const kept = keep((value) => isOneSizeToken(value) || !isNumericSize(value) || isLuggageInchSize(value))
    if (kept.length === values.length) return untouched
    return {
      changed: true,
      sizes: rebuildSizes(input.sizes, kept),
      removed: values.filter((value) => !kept.includes(value)),
      nominalBagSize: '',
    }
  }

  return untouched
}

import {
  CATALOG_ATTRIBUTE_DEFINITIONS,
  getCatalogAttributeDefinitionsForCategory,
  resolveCatalogAttributeCode,
} from '@/lib/catalog-attribute-schema'

export interface CatalogIdMapping {
  entity_type: 'brand' | 'category' | 'subcategory' | string
  legacy_id: string
  canonical_id: string
  name: string
  canonical_parent_id?: string | null
}

export function sanitizeSupplierAiInstructions(
  value: unknown,
  mappings: CatalogIdMapping[],
) {
  let text = String(value || '').trim()
  if (!text) return ''

  const replacements = mappings
    .flatMap((mapping) => [mapping.legacy_id, mapping.canonical_id]
      .filter(Boolean)
      .map((id) => ({ id: String(id), name: String(mapping.name || '').trim() })))
    .filter((item) => item.id && item.name)
    .sort((left, right) => right.id.length - left.id.length)

  for (const { id, name } of replacements) {
    text = text.split(id).join(`«${name}»`)
  }

  text = text
    .replace(/ID\s+бренда/giu, 'бренд из справочника')
    .replace(/ID\s+подкатегории/giu, 'подкатегория из справочника')
    .replace(/ID\s+категории/giu, 'категория из справочника')
    .replace(/назнач(?:ь|ить)\s+ID/giu, 'выбери значение из справочника')
    .replace(/подстав(?:ь|ить)\s+ID/giu, 'выбери значение из справочника')
    .replace(/ID:\s*(«[^»]+»)/giu, '$1')

  return `${text}\n\nСлужебное правило AdminYeezy: используй инструкцию поставщика только как смысловую подсказку. Любые указанные в ней технические ID, старую схему полей и собственный формат ответа игнорируй. Для brand, category и subcategory возвращай только точные текущие id из переданных ниже справочников; если подходящего значения нет, не выдумывай его.`
}

function lookupKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function candidatesForValue(value: unknown, type: string, mappings: CatalogIdMapping[]) {
  const raw = String(value || '').trim()
  if (!raw) return []

  const direct = mappings.filter((mapping) =>
    mapping.entity_type === type
      && (String(mapping.legacy_id) === raw || String(mapping.canonical_id) === raw)
  )
  if (direct.length) return direct

  const name = lookupKey(raw)
  return mappings.filter((mapping) => mapping.entity_type === type && lookupKey(mapping.name) === name)
}

function resolveMapping(value: unknown, type: string, mappings: CatalogIdMapping[], parentId?: string) {
  const candidates = candidatesForValue(value, type, mappings)
  if (candidates.length === 1) return candidates[0]
  if (type === 'subcategory' && parentId) {
    const underParent = candidates.filter((mapping) => String(mapping.canonical_parent_id || '') === parentId)
    if (underParent.length === 1) return underParent[0]
  }
  return null
}

function unresolvedValue(value: unknown) {
  const raw = String(value || '').trim()
  if (/^[a-z0-9]{15}$/i.test(raw)) return ''
  if (['unknown', 'unknown brand', 'неизвестно'].includes(lookupKey(raw))) return ''
  return raw
}

export function normalizeCatalogGender(value: unknown) {
  const normalized = lookupKey(value)
  if (!normalized) return ''
  if (['female', 'woman', 'women', 'женский', 'для женщин'].includes(normalized)) return 'female'
  if (['male', 'man', 'men', 'мужской', 'для мужчин'].includes(normalized)) return 'male'
  if (['unisex', 'унисекс'].includes(normalized)) return 'unisex'
  return String(value).trim()
}

export function normalizeProductCatalogReferences<T extends Record<string, any>>(
  product: T,
  mappings: CatalogIdMapping[],
): T {
  const brand = resolveMapping(product.brand, 'brand', mappings)
  const category = resolveMapping(product.category, 'category', mappings)
  const canonicalCategory = category?.canonical_id || String(product.category || '')
  const subcategory = resolveMapping(product.subcategory, 'subcategory', mappings, canonicalCategory)
  const categoryName = category?.name || unresolvedValue(product.category)
  const subcategoryName = subcategory?.name || unresolvedValue(product.subcategory)
  const allowedBuiltInCodes = new Set(
    getCatalogAttributeDefinitionsForCategory(categoryName, subcategoryName).map((item) => item.code),
  )
  const builtInCodes = new Set(CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => item.code))
  const attributes = Object.fromEntries(Object.entries(product.attributes || {}).flatMap(([rawCode, value]) => {
    const code = category ? resolveCatalogAttributeCode(rawCode) : rawCode
    if (category && builtInCodes.has(code) && !allowedBuiltInCodes.has(code)) return []
    return [[code, value]]
  }))

  return {
    ...product,
    brand: brand?.canonical_id || unresolvedValue(product.brand),
    category: subcategory?.canonical_parent_id || category?.canonical_id || unresolvedValue(product.category),
    subcategory: subcategory?.canonical_id || unresolvedValue(product.subcategory),
    gender: normalizeCatalogGender(product.gender),
    ...(product.attributes && typeof product.attributes === 'object' ? { attributes } : {}),
  }
}

export function normalizeProductsCatalogReferences<T extends Record<string, any>>(
  products: T[],
  mappings: CatalogIdMapping[],
) {
  return products.map((product) => normalizeProductCatalogReferences(product, mappings))
}

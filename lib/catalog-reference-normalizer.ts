export interface CatalogIdMapping {
  entity_type: 'brand' | 'category' | 'subcategory' | string
  legacy_id: string
  canonical_id: string
  name: string
  canonical_parent_id?: string | null
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

  return {
    ...product,
    brand: brand?.canonical_id || unresolvedValue(product.brand),
    category: subcategory?.canonical_parent_id || category?.canonical_id || unresolvedValue(product.category),
    subcategory: subcategory?.canonical_id || unresolvedValue(product.subcategory),
    gender: normalizeCatalogGender(product.gender),
  }
}

export function normalizeProductsCatalogReferences<T extends Record<string, any>>(
  products: T[],
  mappings: CatalogIdMapping[],
) {
  return products.map((product) => normalizeProductCatalogReferences(product, mappings))
}

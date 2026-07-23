import {
  CATALOG_ATTRIBUTE_DEFINITIONS,
  getCatalogAttributeDefinition,
  normalizeCatalogAttributeCodes,
  resolveSupplierAttributeCodes,
} from '@/lib/catalog-attribute-schema'

export type SupplierAttributeDefinition = {
  code: string
  label: string
  group: string
  description: string
  value_type: string
  values?: string[]
  unit?: string
}

export const SUPPLIER_ATTRIBUTE_DEFINITIONS: SupplierAttributeDefinition[] =
  CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => ({
    code: item.code,
    label: item.label,
    group: item.category_scope,
    description: supplierDescription(item),
    value_type: item.value_type,
    values: item.values,
    unit: item.unit,
  }))

export function normalizeSupplierAttributeCodes(value: unknown): string[] {
  return normalizeCatalogAttributeCodes(value)
}

export function getSupplierAttributeDefinition(code: string) {
  const item = getCatalogAttributeDefinition(code)
  if (!item) return undefined
  return {
    code: item.code,
    label: item.label,
    group: item.category_scope,
    description: supplierDescription(item),
    value_type: item.value_type,
    values: item.values,
    unit: item.unit,
  }
}

export function getSupplierAttributeLabel(code: string) {
  return getCatalogAttributeDefinition(code)?.label || code
}

export { resolveSupplierAttributeCodes }

function supplierDescription(item: typeof CATALOG_ATTRIBUTE_DEFINITIONS[number]) {
  const details = [
    item.value_type === 'size' ? 'Список размеров.' : '',
    item.values?.length ? `Допустимые значения: ${item.values.join(', ')}.` : '',
    item.unit ? `Единица: ${item.unit}.` : '',
    'Если значение не найдено, атрибут нужно пропустить.',
  ].filter(Boolean)
  return details.join(' ')
}

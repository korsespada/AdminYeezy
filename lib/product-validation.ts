import { normalizeProductAttributes, type ProductAttributes } from './product-attributes'

export type ProductValidationIssue = {
  row: number
  field: string
  message: string
  severity: 'error' | 'warning'
}

export function validateProducts(products: Array<{
  external_id?: string | null
  name?: string | null
  price?: number | null
  attributes?: ProductAttributes | null
}>): ProductValidationIssue[] {
  const issues: ProductValidationIssue[] = []
  const seenIds = new Map<string, number>()

  products.forEach((product, index) => {
    const row = index + 1
    const externalId = String(product.external_id || '').trim()
    if (!externalId) {
      issues.push({ row, field: 'external_id', message: 'Не задан стабильный external_id; повторный импорт может создать дубль.', severity: 'warning' })
    } else if (seenIds.has(externalId)) {
      issues.push({ row, field: 'external_id', message: `Дубликат external_id со строкой ${seenIds.get(externalId)}.`, severity: 'error' })
    } else {
      seenIds.set(externalId, row)
    }

    if (!String(product.name || '').trim()) {
      issues.push({ row, field: 'name', message: 'Пустое название товара.', severity: 'warning' })
    }

    if (product.price !== undefined && product.price !== null && (!Number.isFinite(Number(product.price)) || Number(product.price) < 0)) {
      issues.push({ row, field: 'price', message: 'Цена должна быть неотрицательным числом.', severity: 'error' })
    }

    const attributes = normalizeProductAttributes(product.attributes)
    Object.keys(attributes).forEach((key) => {
      if (!/^[a-zA-Zа-яА-Я0-9][a-zA-Zа-яА-Я0-9_.-]{0,63}$/.test(key)) {
        issues.push({ row, field: `attributes.${key}`, message: 'Некорректный ключ атрибута.', severity: 'error' })
      }
    })
  })

  return issues
}

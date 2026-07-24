import type { Product } from '@/lib/types'
import { getCatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'

const PRIORITY_CODES = [
  'sizes',
  'colors',
  'materials',
  'upper_material',
  'jewelry_metal',
  'dimensions',
]

export default function ProductAttributeSummary({
  product,
  compact = false,
}: {
  product: Product
  compact?: boolean
}) {
  const attributes = product.catalog_attributes || product.attributes || {}
  const entries = Object.entries(attributes)
    .map(([code, value]) => ({
      code,
      label: getCatalogAttributeDefinition(code)?.label || code,
      value: formatAttributeValue(value),
    }))
    .filter((item) => item.value)
    .sort((left, right) => priority(left.code) - priority(right.code))
    .slice(0, compact ? 2 : 3)

  if (entries.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? 'mt-1' : 'mb-3'}`}>
      {entries.map((entry) => (
        <span
          key={entry.code}
          className="max-w-full truncate rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-200"
          title={`${entry.label}: ${entry.value}`}
        >
          <span className="text-indigo-400">{entry.label}:</span> {entry.value}
        </span>
      ))}
    </div>
  )
}

function priority(code: string) {
  const index = PRIORITY_CODES.indexOf(code)
  return index === -1 ? PRIORITY_CODES.length : index
}

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return unique(value.map(String)).join(', ')
  if (typeof value !== 'object') return String(value)

  const item = value as Record<string, unknown>
  for (const key of ['filter_display', 'display_value', 'value', 'filter_value']) {
    if (typeof item[key] === 'string' || typeof item[key] === 'number') return String(item[key])
  }
  for (const key of ['values', 'names', 'display_values', 'filter_values', 'families', 'raw_values']) {
    if (Array.isArray(item[key])) return unique(item[key].map(String)).join(', ')
  }
  return ''
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

export type SupplierAiVisualExample = {
  id: string
  url: string
  label: string
  instruction: string
}

export function normalizeSupplierAiVisualExamples(value: unknown): SupplierAiVisualExample[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const url = String(source.url || '').trim()
    if (!/^https:\/\//i.test(url)) return []
    return [{
      id: String(source.id || cryptoRandomFallback(url)).trim().slice(0, 120),
      url,
      label: String(source.label || '').trim().slice(0, 160),
      instruction: String(source.instruction || '').trim().slice(0, 500),
    }]
  }).slice(0, 12)
}

function cryptoRandomFallback(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return `visual-${Math.abs(hash)}`
}

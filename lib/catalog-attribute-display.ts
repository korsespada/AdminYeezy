const STRUCTURED_IMPORT_ATTRIBUTE_CODES = new Set(['measurements', 'size_recommendation'])

export function isGenericImportAttribute(code: string, technical: boolean) {
  return !technical && !STRUCTURED_IMPORT_ATTRIBUTE_CODES.has(code)
}

export function formatImportAttributeValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatImportAttributeValue(item)).join(', ')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

const PHOTO_META_PREFIX = /^(?:на\s+(?:фотографиях|фото|снимках)|по\s+(?:фотографиям|фото))\s+(?:(?:хорошо\s+)?(?:видны|видно|видна|виден|заметны|заметно|заметна|заметен|представлены|представлено|показаны|показано)\s+|[-—:]\s*)/iu
const MISSING_FACT = /(?:не\s+(?:указан(?:а|о|ы)?|известен|известна|известно|известны|представлен(?:а|о|ы)?|удалось\s+(?:определить|подтвердить)|можно\s+(?:определить|подтвердить))|нет\s+(?:данных|информации))/iu
const MATERIAL_FIELD = /^(?:materials|upper_material|sole_material|jewelry_metal|lining_material|luggage_case_material)$/u
const PUBLIC_TEXT_FIELDS = ['suggested_name', 'description', 'h1', 'seo_title', 'seo_description']

function sanitizeCatalogOutput(output, { internalIdentifiers = [] } = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output

  const result = { ...output }
  for (const field of PUBLIC_TEXT_FIELDS) {
    if (typeof result[field] !== 'string') continue
    result[field] = field === 'description'
      ? sanitizeDescription(result[field], internalIdentifiers)
      : cleanPublicText(result[field], internalIdentifiers)
  }

  if (result.catalog_attributes && typeof result.catalog_attributes === 'object' && !Array.isArray(result.catalog_attributes)) {
    result.catalog_attributes = { ...result.catalog_attributes }
    if (matchesIdentifier(result.catalog_attributes.model_name, internalIdentifiers)) {
      delete result.catalog_attributes.model_name
    }
  }

  return result
}

function sanitizeDescription(description, internalIdentifiers = []) {
  const sentences = description
    .replace(/\\n/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => capitalize(cleanPublicText(sentence.replace(PHOTO_META_PREFIX, ''), internalIdentifiers)))
    .filter((sentence) => sentence && !MISSING_FACT.test(sentence))

  return paragraphize(sentences)
}

function catalogQualityIssues(generation, output) {
  const issues = []
  const identifiers = generation?.input_snapshot?.catalog?.internal_identifiers || []
  const serializedOutput = JSON.stringify(output || {})
  const description = String(output?.description || '')

  if (identifiers.some((identifier) => containsIdentifier(serializedOutput, identifier))) {
    issues.push('В публичный результат попал внутренний артикул. Удали его из названия, модели, описания и SEO-полей.')
  }
  if (MISSING_FACT.test(description)) {
    issues.push('Описание сообщает об отсутствующих данных. Удали такие фразы: покупателю нужны только известные свойства.')
  }
  if (serializedOutput.includes('[object Object]')) {
    issues.push('В результате есть [object Object]. Верни нормальные строковые или списковые значения характеристик.')
  }

  const sourceDescription = String(generation?.input_snapshot?.product?.description || '')
  const material = sourceDescription.match(/(?:материал|состав)\s*:\s*([^\n.;]+)/iu)?.[1]?.trim()
  const attributes = output?.catalog_attributes && typeof output.catalog_attributes === 'object' ? output.catalog_attributes : {}
  const hasMaterialAttribute = Object.entries(attributes).some(([code, value]) => MATERIAL_FIELD.test(code) && hasValue(value))
  if (material && !hasMaterialAttribute) {
    issues.push(`В старом описании явно указан материал «${material}», но характеристика материала не заполнена. Перенеси факт в описание и подходящую характеристику.`)
  }

  return issues
}

function paragraphize(sentences) {
  if (sentences.length <= 1) return sentences.join('')
  const paragraphCount = Math.min(3, sentences.length)
  const groups = Array.from({ length: paragraphCount }, () => [])
  sentences.forEach((sentence, index) => groups[Math.min(paragraphCount - 1, Math.floor(index * paragraphCount / sentences.length))].push(sentence))
  return groups.filter((group) => group.length > 0).map((group) => group.join(' ')).join('\n')
}

function cleanPublicText(value, internalIdentifiers) {
  let result = String(value)
  for (const identifier of internalIdentifiers.filter(Boolean)) {
    result = result.replace(identifierPattern(identifier), ' ')
  }
  return result
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([—–-])\s*([—–-])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/g, '')
    .replace(/^\s+/g, '')
}

function matchesIdentifier(value, identifiers) {
  if (typeof value !== 'string') return false
  return identifiers.some((identifier) => value.trim().toLocaleLowerCase('ru-RU') === String(identifier).trim().toLocaleLowerCase('ru-RU'))
}

function containsIdentifier(value, identifier) {
  return identifier && identifierPattern(identifier).test(value)
}

function identifierPattern(identifier) {
  const escaped = String(identifier).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue)
  if (value && typeof value === 'object') return Object.values(value).some(hasValue)
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function capitalize(value) {
  const firstLetter = value.search(/\p{L}/u)
  if (firstLetter < 0) return value
  return value.slice(0, firstLetter) + value[firstLetter].toLocaleUpperCase('ru-RU') + value.slice(firstLetter + 1)
}

module.exports = { catalogQualityIssues, sanitizeCatalogOutput, sanitizeDescription }

const PHOTO_META_PREFIX = /^(?:на\s+(?:фотографиях|фото|снимках)|по\s+(?:фотографиям|фото))\s+(?:(?:хорошо\s+)?(?:видны|видно|видна|виден|заметны|заметно|заметна|заметен|представлены|представлено|показаны|показано)\s+|[-—:]\s*)/iu

function sanitizeCatalogOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output
  if (typeof output.description !== 'string') return output

  return {
    ...output,
    description: sanitizeDescription(output.description),
  }
}

function sanitizeDescription(description) {
  return description
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => capitalize(sentence.replace(PHOTO_META_PREFIX, '')))
    .join(' ')
    .trim()
}

function capitalize(value) {
  const firstLetter = value.search(/\p{L}/u)
  if (firstLetter < 0) return value
  return value.slice(0, firstLetter) + value[firstLetter].toLocaleUpperCase('ru-RU') + value.slice(firstLetter + 1)
}

module.exports = { sanitizeCatalogOutput, sanitizeDescription }

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function seoSlug(value: unknown, fallback = 'product') {
  const transliterated = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .split('')
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join('')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return transliterated || fallback
}

function firstValue(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return firstValue(record.display_value ?? record.value ?? record.name ?? record.filter_values ?? record.values)
  }
  const values = Array.isArray(value) ? value : [value]
  return values.map((item) => String(item || '').trim()).find(Boolean) || ''
}

function modelWithoutBrand(model: string, brandName: string) {
  const normalizedModel = model.trim()
  const normalizedBrand = brandName.trim()
  if (!normalizedBrand) return normalizedModel
  return normalizedModel.toLocaleLowerCase().startsWith(`${normalizedBrand.toLocaleLowerCase()} `)
    ? normalizedModel.slice(normalizedBrand.length).trim()
    : normalizedModel
}

export function buildProductSeoSlug(product: Record<string, any>, brandName: string) {
  const attributes = product.attributes && typeof product.attributes === 'object' ? product.attributes : {}
  const model = modelWithoutBrand(firstValue(attributes.model_name) || String(product.name || '').trim(), brandName)
  const color = firstValue(attributes.colors ?? attributes.color)
  return seoSlug([brandName, model, color].filter(Boolean).join(' '), 'product')
}

export function normalizePhotoAlt(value: unknown, fallback: string) {
  const candidate = String(value || '').replace(/\s+/g, ' ').trim()
  if (!candidate) return fallback.slice(0, 160).trim()
  if (candidate.length <= 160) return candidate
  const shortened = candidate.slice(0, 160).trim()
  const lastSpace = shortened.lastIndexOf(' ')
  return (lastSpace >= 80 ? shortened.slice(0, lastSpace) : shortened).trim()
}

export function normalizePhotoAlts(value: unknown, photoCount: number, fallback: string) {
  const values = Array.isArray(value) ? value : []
  return Array.from({ length: photoCount }, (_, index) => {
    return normalizePhotoAlt(values[index], fallback)
  })
}

export function normalizePhotoSlugs(value: unknown, photoCount: number) {
  const values = Array.isArray(value) ? value : []
  const used = new Set<string>()
  return Array.from({ length: photoCount }, (_, index) => {
    const fallback = `foto-${index + 1}`
    const base = seoSlug(values[index], fallback).slice(0, 80) || fallback
    let slug = base
    let suffix = 2
    while (used.has(slug)) {
      slug = `${base}-${suffix}`
      suffix += 1
    }
    used.add(slug)
    return slug
  })
}

export function normalizeRetainedPhotoAlts(
  value: unknown,
  originalPhotoCount: number,
  discardedIndexes: Set<number>,
  sizeChartIndexes: Set<number>,
  fallback: string,
) {
  const values = Array.isArray(value) ? value : []
  const retained = Array.from({ length: originalPhotoCount }, (_, index) => index + 1)
    .filter((index) => !discardedIndexes.has(index) && !sizeChartIndexes.has(index))
  return retained.map((originalIndex) => normalizePhotoAlt(values[originalIndex - 1], fallback))
}

export function normalizeMediaSeoOutput(output: any, input: any) {
  const product = input?.product || {}
  const photoCount = Array.isArray(product.photos) ? product.photos.length : 0
  return {
    slug: String(input?.generatedSlug || '').trim(),
    photo_alts: normalizePhotoAlts(output?.photo_alts || output?.image_alt_texts, photoCount, String(product.name || '').trim()),
    photo_slugs: normalizePhotoSlugs(output?.photo_slugs || output?.image_slugs, photoCount),
  }
}

import {
  type AlbumFields,
  type MatchComparison,
  type NormalizedFields,
  compareFields,
  isCandidate,
  normalizeFields,
  parseAlbumFields,
  parseCatalogFields,
} from '@/lib/video-match-fields'

export interface AlbumCandidate {
  productId: number
  externalId: string
  position: number | null
  videoUrl: string
  posterUrl: string | null
  tag: string | null
  raw: AlbumFields
  normalized: NormalizedFields
}

export interface CatalogProductInput {
  id: string
  slug: string | null
  name: string | null
  category: string | null
  status: string | null
  photoUrl: string | null
  description: string | null
}

export interface MatchRow {
  crmProductId: string
  crmSlug: string | null
  crmName: string | null
  crmCategory: string | null
  crmStatus: string | null
  crmPhotoUrl: string | null
  sourceProductId: number
  sourceExternalId: string
  sourcePosition: number | null
  videoSourceUrl: string
  videoPosterUrl: string | null
  rank: number
  candidatesTotal: number
  confidence: MatchComparison['confidence']
  score: number
  sourceFields: AlbumFields
  crmFields: AlbumFields
  differences: MatchComparison['differences']
  duplicatedVideo: boolean
}

/** Сколько видео-вариантов хранить на товар: остальные доступны в выгрузке, но не нужны в очереди ревью. */
export const MAX_CANDIDATES_PER_PRODUCT = 5

/** Строит индекс альбомов выгрузки: только те, у которых есть видео и разобранные характеристики. */
export function buildAlbumIndex(rows: Array<Record<string, any>>): { albums: AlbumCandidate[]; withoutFields: number; withoutVideo: number } {
  const albums: AlbumCandidate[] = []
  let withoutFields = 0
  let withoutVideo = 0
  for (const row of rows) {
    const attributes = row.attributes && typeof row.attributes === 'object' ? row.attributes : {}
    const videoUrl = String(attributes.szwego_video_url || '').trim()
    if (!videoUrl) { withoutVideo += 1; continue }
    const raw = parseAlbumFields(String(row.description || ''))
    const normalized = normalizeFields(raw)
    if (!normalized.style) { withoutFields += 1; continue }
    const photos = Array.isArray(row.photos) ? row.photos : []
    const poster = String(photos[0] || '').trim() || null
    const tags = Array.isArray(attributes.szwego_tags) ? attributes.szwego_tags : []
    albums.push({
      productId: Number(row.id),
      externalId: String(row.external_id || ''),
      position: row.source_position === null || row.source_position === undefined ? null : Number(row.source_position),
      videoUrl,
      posterUrl: poster,
      tag: tags.length > 0 ? String(tags[0]) : null,
      raw,
      normalized,
    })
  }
  return { albums, withoutFields, withoutVideo }
}

/**
 * Подбирает варианты альбомов для каждого товара каталога.
 * Одинаковые видео (поставщик публикует один и тот же файл в нескольких альбомах)
 * схлопываются: у товара остаётся один вариант на видео.
 */
export function buildMatchRows(input: {
  products: CatalogProductInput[]
  albums: AlbumCandidate[]
  duplicateVideos?: Set<string>
  maxCandidates?: number
}): MatchRow[] {
  const maxCandidates = input.maxCandidates || MAX_CANDIDATES_PER_PRODUCT
  const duplicateVideos = input.duplicateVideos || new Set<string>()
  const byStyle = new Map<string, AlbumCandidate[]>()
  for (const album of input.albums) {
    const key = album.normalized.styleSignature
    if (!key) continue
    const bucket = byStyle.get(key)
    if (bucket) bucket.push(album)
    else byStyle.set(key, [album])
  }

  const rows: MatchRow[] = []
  for (const product of input.products) {
    const normalized = normalizeFields(parseCatalogFields(product.description))
    if (!normalized.style || !normalized.styleSignature) continue
    const pool = byStyle.get(normalized.styleSignature) || []
    if (pool.length === 0) continue

    const scored = pool
      .map((album) => ({ album, comparison: compareFields(normalized, album.normalized) }))
      .filter((item) => isCandidate(item.comparison))
      .sort((left, right) => right.comparison.score - left.comparison.score
        || (right.album.position || 0) - (left.album.position || 0))

    const byVideo = new Map<string, { album: AlbumCandidate; comparison: MatchComparison }>()
    for (const item of scored) {
      const existing = byVideo.get(item.album.videoUrl)
      if (!existing || item.comparison.score > existing.comparison.score) byVideo.set(item.album.videoUrl, item)
    }
    const distinct = [...byVideo.values()].sort((left, right) => right.comparison.score - left.comparison.score
      || (right.album.position || 0) - (left.album.position || 0))
    if (distinct.length === 0) continue

    distinct.slice(0, maxCandidates).forEach((item, index) => {
      rows.push({
        crmProductId: product.id,
        crmSlug: product.slug,
        crmName: product.name,
        crmCategory: product.category,
        crmStatus: product.status,
        crmPhotoUrl: product.photoUrl,
        sourceProductId: item.album.productId,
        sourceExternalId: item.album.externalId,
        sourcePosition: item.album.position,
        videoSourceUrl: item.album.videoUrl,
        videoPosterUrl: item.album.posterUrl,
        rank: index + 1,
        candidatesTotal: distinct.length,
        confidence: item.comparison.confidence,
        score: item.comparison.score,
        sourceFields: item.album.raw,
        crmFields: parseCatalogFields(product.description),
        differences: item.comparison.differences,
        duplicatedVideo: duplicateVideos.has(item.album.videoUrl),
      })
    })
  }
  return rows
}

/** Видео, которые поставщик повторил в нескольких альбомах: их S3-файл переиспользуется. */
export function duplicateVideoUrls(albums: AlbumCandidate[]): Set<string> {
  const counts = new Map<string, number>()
  for (const album of albums) counts.set(album.videoUrl, (counts.get(album.videoUrl) || 0) + 1)
  const duplicates = new Set<string>()
  counts.forEach((count, url) => { if (count > 1) duplicates.add(url) })
  return duplicates
}

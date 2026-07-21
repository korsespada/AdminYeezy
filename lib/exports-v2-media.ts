import type { V2AlbumRole, V2DraftAlbum } from '@/lib/exports-v2-types'

type V2MediaPlanAlbum = Pick<
  V2DraftAlbum,
  'id' | 'source_order' | 'photos' | 'media' | 'role' | 'use_media'
>

export type V2PlannedMedia = {
  type: 'image' | 'video'
  url: string
  preview_url: string
  role: V2AlbumRole
  album_id: string
  source_album_order: number
  source_media_order: number
  sort_order: number
}

export type V2MediaPlan = {
  items: V2PlannedMedia[]
  on_model_available: number
  on_model_included: number
}

const ROLE_PRIORITY: Partial<Record<V2AlbumRole, number>> = {
  PRIMARY_MEDIA: 10,
  MEDIA_WITH_TEXT: 20,
  ON_MODEL: 30,
  EXTRA_MEDIA: 40,
}

function albumMedia(album: V2MediaPlanAlbum) {
  if (Array.isArray(album.media) && album.media.length > 0) return album.media
  return (album.photos || []).map((url) => ({ type: 'image' as const, url, preview_url: url }))
}

/**
 * Builds the future storefront gallery without mutating the raw supplier data.
 * Album and media order are stable inside each role; only role priority changes
 * their final position. ON_MODEL is capped globally for the product.
 */
export function buildExportsV2MediaPlan(
  albums: V2MediaPlanAlbum[],
  maxOnModelMedia = 5,
): V2MediaPlan {
  const onModelLimit = Math.max(0, Math.floor(Number(maxOnModelMedia) || 0))
  const orderedAlbums = [...albums].sort(
    (left, right) => left.source_order - right.source_order || left.id.localeCompare(right.id),
  )
  const candidates: Omit<V2PlannedMedia, 'sort_order'>[] = []
  let onModelAvailable = 0
  let onModelIncluded = 0

  for (const album of orderedAlbums) {
    const priority = ROLE_PRIORITY[album.role]
    if (priority === undefined || !album.use_media) continue

    albumMedia(album).forEach((media, sourceMediaOrder) => {
      if (album.role === 'ON_MODEL') {
        onModelAvailable += 1
        if (onModelIncluded >= onModelLimit) return
        onModelIncluded += 1
      }
      candidates.push({
        type: media.type,
        url: media.url,
        preview_url: media.preview_url || media.url,
        role: album.role,
        album_id: album.id,
        source_album_order: album.source_order,
        source_media_order: sourceMediaOrder,
      })
    })
  }

  const items = candidates
    .sort((left, right) =>
      (ROLE_PRIORITY[left.role] || 999) - (ROLE_PRIORITY[right.role] || 999)
      || left.source_album_order - right.source_album_order
      || left.source_media_order - right.source_media_order,
    )
    .map((media, sortOrder) => ({ ...media, sort_order: sortOrder }))

  return {
    items,
    on_model_available: onModelAvailable,
    on_model_included: onModelIncluded,
  }
}

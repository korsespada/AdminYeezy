import { describe, expect, it } from 'vitest'
import { buildExportsV2MediaPlan } from '@/lib/exports-v2-media'
import type { V2AlbumRole, V2DraftAlbum } from '@/lib/exports-v2-types'

function album(
  id: string,
  sourceOrder: number,
  role: V2AlbumRole,
  media: V2DraftAlbum['media'],
  draftOrder = sourceOrder,
): V2DraftAlbum {
  return {
    id,
    external_id: id,
    source_order: sourceOrder,
    source_page: 1,
    page_position: sourceOrder,
    name: id,
    description: '',
    photos: media.filter((item) => item.type === 'image').map((item) => item.url),
    media,
    draft_id: 'draft-1',
    draft_sort_order: draftOrder,
    role,
    use_text: role === 'PRIMARY_MEDIA' || role === 'MEDIA_WITH_TEXT' || role === 'TEXT_ONLY' || role === 'SIZE_CHART',
    use_media: ['PRIMARY_MEDIA', 'ON_MODEL', 'MEDIA_WITH_TEXT', 'EXTRA_MEDIA'].includes(role),
    use_photos: ['PRIMARY_MEDIA', 'ON_MODEL', 'MEDIA_WITH_TEXT', 'EXTRA_MEDIA'].includes(role),
    use_for_ai: !['UNASSIGNED', 'COMPARISON_OR_AD', 'IGNORE'].includes(role),
  }
}

function image(url: string) {
  return { type: 'image' as const, url, preview_url: `${url}-preview` }
}

describe('buildExportsV2MediaPlan', () => {
  it('puts main media first regardless of supplier album order', () => {
    const plan = buildExportsV2MediaPlan([
      album('extra', 1, 'EXTRA_MEDIA', [image('extra-1')]),
      album('main', 8, 'PRIMARY_MEDIA', [image('main-1')]),
      album('text-media', 2, 'MEDIA_WITH_TEXT', [image('text-media-1')]),
    ])

    expect(plan.items.map((item) => item.url)).toEqual(['main-1', 'text-media-1', 'extra-1'])
    expect(plan.items.map((item) => item.sort_order)).toEqual([0, 1, 2])
  })

  it('preserves click order and media order inside the same role', () => {
    const plan = buildExportsV2MediaPlan([
      album('later', 4, 'PRIMARY_MEDIA', [image('later-1')], 0),
      album('earlier', 2, 'PRIMARY_MEDIA', [image('earlier-1'), image('earlier-2')], 1),
    ])

    expect(plan.items.map((item) => item.url)).toEqual(['later-1', 'earlier-1', 'earlier-2'])
    expect(plan.items.map((item) => item.source_album_order)).toEqual([4, 2, 2])
  })

  it('caps on-model media without reordering the retained items', () => {
    const plan = buildExportsV2MediaPlan([
      album('model-a', 2, 'ON_MODEL', [image('model-1'), image('model-2'), image('model-3')]),
      album('model-b', 3, 'ON_MODEL', [image('model-4'), image('model-5'), image('model-6')]),
    ], 5)

    expect(plan.items.map((item) => item.url)).toEqual([
      'model-1', 'model-2', 'model-3', 'model-4', 'model-5',
    ])
    expect(plan.on_model_available).toBe(6)
    expect(plan.on_model_included).toBe(5)
  })

  it('keeps videos and excludes text-only, comparison and ignored albums', () => {
    const plan = buildExportsV2MediaPlan([
      album('main', 1, 'PRIMARY_MEDIA', [
        image('main-image'),
        { type: 'video', url: 'main-video.mp4', preview_url: 'main-video.jpg' },
      ]),
      album('text', 2, 'TEXT_ONLY', [image('hidden-text')]),
      album('ad', 3, 'COMPARISON_OR_AD', [image('hidden-ad')]),
      album('ignored', 4, 'IGNORE', [image('hidden-ignore')]),
    ])

    expect(plan.items.map((item) => [item.type, item.url])).toEqual([
      ['image', 'main-image'],
      ['video', 'main-video.mp4'],
    ])
  })
})

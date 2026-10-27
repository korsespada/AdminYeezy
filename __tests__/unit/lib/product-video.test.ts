import { describe, expect, it } from 'vitest'
import { withoutProductVideoAttributes } from '@/lib/product-video'

describe('product video removal', () => {
  it('removes every local video source and keeps the rest of the attributes', () => {
    const result = withoutProductVideoAttributes({
      manual_video_url: 'https://example.com/manual.mp4',
      manual_video_poster_url: 'https://example.com/manual.webp',
      hosted_video_url: 'https://static.example.com/hosted.mp4',
      hosted_video_poster_url: 'https://static.example.com/hosted.webp',
      szwego_video_url: 'https://example.com/szwego.mp4',
      szwego_video_poster_url: 'https://example.com/szwego.webp',
      video_url: 'https://example.com/generic.mp4',
      video_poster_url: 'https://example.com/generic.webp',
      video_transfer_error: 'timeout',
      colors: ['Чёрный'],
      sizes: ['M', 'L'],
    })

    expect(result).toEqual({
      colors: ['Чёрный'],
      sizes: ['M', 'L'],
    })
  })
})

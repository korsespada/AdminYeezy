import { describe, expect, it } from 'vitest'

const { extractStorageKeys, pairedVideoKeys, planMediaGc } = require('../../../scripts/lib/s3-media-gc')
const { cacheControlForKey } = require('../../../scripts/lib/s3-cache-control')

const now = new Date('2026-11-09T00:00:00Z')
const old = new Date('2026-09-01T00:00:00Z')
const fresh = new Date('2026-11-01T00:00:00Z')

describe('s3 media gc', () => {
  it('extracts storage keys from urls and json regardless of host', () => {
    const text = JSON.stringify({
      video: 'https://static.yuconcierge.com/videos/abc.mp4',
      photos: ['https://bucket.s3.example.com/products/media/f00.webp', 'https://static.yuconcierge.com/batches/1/x_0.webp'],
    })
    expect(extractStorageKeys(text)).toEqual(['videos/abc.mp4', 'products/media/f00.webp'])
    expect(extractStorageKeys(null)).toEqual([])
  })

  it('pairs video and poster keys', () => {
    expect(pairedVideoKeys('videos/abc.mp4')).toEqual(['videos/abc-poster.webp'])
    expect(pairedVideoKeys('videos/abc-poster.webp')).toEqual(['videos/abc.mp4'])
    expect(pairedVideoKeys('products/media/abc.webp')).toEqual([])
  })

  it('deletes only old unreferenced files from managed prefixes', () => {
    const plan = planMediaGc({
      now,
      minAgeDays: 30,
      referencedKeys: ['products/media/used.webp', 'videos/kept.mp4'],
      objects: [
        { key: 'products/media/used.webp', size: 10, lastModified: old },
        { key: 'products/media/orphan.webp', size: 20, lastModified: old },
        { key: 'products/media/new.webp', size: 30, lastModified: fresh },
        { key: 'videos/kept.mp4', size: 40, lastModified: old },
        { key: 'videos/kept-poster.webp', size: 5, lastModified: old },
        { key: 'videos/gone.mp4', size: 50, lastModified: old },
        { key: 'videos/gone-poster.webp', size: 6, lastModified: old },
        { key: 'products/media/undated.webp', size: 7 },
        { key: 'batches/1/x_0.webp', size: 70, lastModified: old },
      ],
    })

    expect(plan.candidates.map((item: { key: string }) => item.key)).toEqual([
      'products/media/orphan.webp',
      'videos/gone.mp4',
      'videos/gone-poster.webp',
    ])
    expect(plan.candidateBytes).toBe(76)
    expect(plan.referenced).toBe(3)
    expect(plan.young).toBe(2)
    expect(plan.skipped).toBe(1)
  })
})

describe('s3 cache control', () => {
  it('caches hashed keys forever and batch photos for a month', () => {
    expect(cacheControlForKey('products/media/abc.webp')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlForKey('videos/abc.mp4')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlForKey('batches/7/slug-foto-1.webp')).toBe('public, max-age=2592000')
  })
})

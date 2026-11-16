import { describe, expect, it } from 'vitest'
import { missingSiteChromoffReviews, SITE_CHROMOFF_REVIEWS } from '@/lib/chromoff-review-seed'

describe('chromoff review seed', () => {
  it('publishes only reviews with a photo and alt, like the storefront home', () => {
    for (const review of SITE_CHROMOFF_REVIEWS) {
      expect(review.status === 'published').toBe(Boolean(review.photo_src && review.photo_alt))
      expect(review.items.length).toBeGreaterThan(0)
      expect(review.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    }
    expect(SITE_CHROMOFF_REVIEWS.filter((review) => review.status === 'published')).toHaveLength(7)
  })

  it('has unique legacy keys', () => {
    const keys = SITE_CHROMOFF_REVIEWS.map((review) => review.legacy_key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('returns only reviews missing from Rails by legacy_key', () => {
    expect(missingSiteChromoffReviews([])).toHaveLength(SITE_CHROMOFF_REVIEWS.length)
    const existing = [{ legacy_key: '2026-02' }, { legacy_key: null }, { legacy_key: '2026-07' }]
    const missing = missingSiteChromoffReviews(existing).map((review) => review.legacy_key)
    expect(missing).not.toContain('2026-02')
    expect(missing).not.toContain('2026-07')
    expect(missing).toHaveLength(SITE_CHROMOFF_REVIEWS.length - 2)
    expect(missingSiteChromoffReviews(SITE_CHROMOFF_REVIEWS)).toHaveLength(0)
  })
})

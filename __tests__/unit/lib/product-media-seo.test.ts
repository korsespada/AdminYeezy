import { describe, expect, it } from 'vitest'
import {
  buildProductSeoSlug,
  normalizePhotoAlt,
  normalizeRetainedPhotoAlts,
} from '@/lib/product-media-seo'

describe('product media SEO helpers', () => {
  it('builds a latin product slug from brand, model, color and article', () => {
    expect(buildProductSeoSlug({
      name: 'Nike Dunk Low',
      external_id: 'A-42',
      attributes: { model_name: 'Dunk Low', colors: ['черный'] },
    }, 'Nike')).toBe('nike-dunk-low-chernyi-a-42')
  })

  it('keeps alt text within the hard limit', () => {
    const alt = normalizePhotoAlt('товар '.repeat(80), 'fallback')
    expect(alt.length).toBeLessThanOrEqual(160)
    expect(alt).not.toMatch(/\s$/)
  })

  it('keeps alt texts aligned with the retained original photos', () => {
    expect(normalizeRetainedPhotoAlts(
      ['первое фото', 'таблица размеров', 'вид сбоку'],
      3,
      new Set([2]),
      new Set(),
      'Товар',
    )).toEqual(['первое фото', 'вид сбоку'])
  })
})

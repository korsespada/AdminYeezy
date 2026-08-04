import { describe, expect, it } from 'vitest'
import {
  buildProductSeoSlug,
  normalizePhotoAlt,
  normalizePhotoSlugs,
  normalizeRetainedPhotoAlts,
} from '@/lib/product-media-seo'

describe('product media SEO helpers', () => {
  it('builds a temporary readable product slug without external ID', () => {
    expect(buildProductSeoSlug({
      name: 'Nike Dunk Low',
      external_id: 'A-42',
      attributes: { model_name: 'Dunk Low', colors: ['черный'] },
    }, 'Nike')).toBe('nike-dunk-low-chernyi')
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

  it('builds unique short slugs for each photo without using external IDs', () => {
    expect(normalizePhotoSlugs(['Вид спереди', 'Вид спереди', ''], 3)).toEqual([
      'vid-speredi',
      'vid-speredi-2',
      'foto-3',
    ])
  })
})

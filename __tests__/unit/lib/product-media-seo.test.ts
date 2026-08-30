import { describe, expect, it } from 'vitest'
import {
  buildProductSeoSlug,
  normalizePhotoAlt,
  normalizePhotoSlugs,
  normalizeRetainedPhotoAlts,
} from '@/lib/product-media-seo'

describe('product media SEO helpers', () => {
  it('appends the model to a temporary slug when the product name does not contain it', () => {
    expect(buildProductSeoSlug({
      name: 'Мужские кроссовки',
      external_id: 'A-42',
      attributes: { model_name: 'Dunk Low', colors: ['черный'] },
    }, 'Nike')).toBe('nike-muzhskie-krossovki-dunk-low')
  })

  it('does not duplicate the model when the product name already contains it', () => {
    expect(buildProductSeoSlug({
      name: 'Nike Dunk Low',
      external_id: 'A-42',
      attributes: { model_name: 'Dunk Low', colors: ['черный'] },
    }, 'Nike')).toBe('nike-dunk-low')
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

  it('transliterates each alt into a bounded unique photo slug', () => {
    const alt = 'Тёмно-синие шерстяные брюки Brunello Cucinelli, вид сверху, зауженные штанины и пояс'
    expect(normalizePhotoSlugs([alt, alt, ''], 3)).toEqual([
      'temno-sinie-sherstyanye-bryuki-brunello-cucinelli-vid-sverhu-zauzhennye-shtaniny-i-poyas',
      'temno-sinie-sherstyanye-bryuki-brunello-cucinelli-vid-sverhu-zauzhennye-shtaniny-i-poyas-2',
      'foto-3',
    ])
    expect(normalizePhotoSlugs(['товар '.repeat(80)], 1)[0].length).toBeLessThanOrEqual(120)
  })
})

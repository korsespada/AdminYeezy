import { describe, expect, it } from 'vitest'
import { canonicalShoeSubcategoryName } from '@/lib/shoe-taxonomy'

describe('shoe taxonomy', () => {
  it.each([
    ['Сандалии', 'Сандалии и босоножки'],
    ['босоножки', 'Сандалии и босоножки'],
    ['Кеды', 'Кроссовки и кеды'],
    ['Сабо', 'Мюли и сабо'],
    ['Оксфорды', 'Туфли на плоской подошве'],
    ['Лодочки', 'Туфли на каблуке'],
  ])('maps %s to %s', (source, target) => {
    expect(canonicalShoeSubcategoryName(source)).toBe(target)
  })

  it('does not invent a mapping for an unknown construction', () => {
    expect(canonicalShoeSubcategoryName('Неизвестная форма')).toBe('')
  })
})

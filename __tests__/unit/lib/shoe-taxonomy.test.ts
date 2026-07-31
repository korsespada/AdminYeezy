import { describe, expect, it } from 'vitest'
import { canonicalShoeSubcategoryName, inferGenericShoeSubcategoryName } from '@/lib/shoe-taxonomy'

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

  it.each([
    ['Туфли-лодочки на каблуке 7 см', 'Туфли на каблуке'],
    ['Chanel high heel pumps', 'Туфли на каблуке'],
    ['Chanel 银色平底玛丽珍', 'Туфли на плоской подошве'],
    ['Mary Jane без указания каблука', 'Туфли на плоской подошве'],
  ])('resolves a generic shoe result from construction evidence: %s', (source, target) => {
    expect(inferGenericShoeSubcategoryName(source)).toBe(target)
  })
})

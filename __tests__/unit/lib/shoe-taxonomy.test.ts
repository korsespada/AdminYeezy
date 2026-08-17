import { describe, expect, it } from 'vitest'
import { canonicalShoeSubcategoryName, filterShoeSubcategoriesForAi, inferGenericShoeSubcategoryName, inferShoeSlingbackSubcategoryName } from '@/lib/shoe-taxonomy'

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

  it.each([
    ['Чёрные туфли-слингбэки с открытой пяткой на каблуке', 'Туфли на каблуке'],
    ['Черные туфли с ремешком на пятке на каблуке', 'Туфли на каблуке'],
    ['露跟高跟鞋 с лентой сзади', 'Туфли на каблуке'],
    ['Плоские слингбэки с ремешком сзади', 'Туфли на плоской подошве'],
  ])('classifies slingbacks separately from mules: %s', (source, target) => {
    expect(inferShoeSlingbackSubcategoryName(source)).toBe(target)
  })

  it('does not classify a true mule without a heel strap as a slingback', () => {
    expect(inferShoeSlingbackSubcategoryName('Чёрные мюли с закрытым мысом и открытой пяткой')).toBe('')
  })

  it('leaves open-toe strapped shoes for sandal classification', () => {
    expect(inferShoeSlingbackSubcategoryName('Розовые босоножки с открытым мысом и ремешком сзади на каблуке')).toBe('')
  })

  it('hides the legacy generic shoe subcategory from the AI context', () => {
    expect(filterShoeSubcategoriesForAi([
      { id: 'generic', name: 'Туфли' },
      { id: 'heel', name: 'Туфли на каблуке' },
    ])).toEqual([{ id: 'heel', name: 'Туфли на каблуке' }])
  })
})

import { describe, expect, it } from 'vitest'
import {
  canonicalClothingSubcategoryName,
  inferClothingSubcategoryName,
} from '@/lib/clothing-taxonomy'

describe('clothing taxonomy', () => {
  it.each([
    ['Поло', 'Футболки и майки'],
    ['Плавательные шорты', 'Шорты'],
    ['Джинсы', 'Джинсы'],
    ['Платья', 'Платья'],
    ['Комбинезоны', 'Платья'],
    ['Юбки', 'Юбки'],
    ['Брюки', 'Штаны'],
    ['Жакет', 'Жакеты'],
    ['Пиджак', 'Пиджаки'],
    ['Свитшот', 'Худи и толстовки'],
    ['Пальто', 'Пальто и плащи'],
  ])('maps %s to %s', (source, expected) => {
    expect(canonicalClothingSubcategoryName(source)).toBe(expected)
  })

  it.each([
    ['Brunello Cucinelli поло с коротким рукавом', 'Футболки и майки'],
    ['Вязаная футболка с коротким рукавом и несколькими пуговицами', 'Футболки и майки'],
    ['Loro Piana плавательные шорты', 'Шорты'],
    ['Prada прямые джинсы карго', 'Джинсы'],
    ['Zimmermann платье макси', 'Платья'],
    ['Zimmermann платье-поло мини', 'Платья'],
    ['Louis Vuitton джинсовый комбинезон', 'Платья'],
    ['Prada юбка-карго', 'Юбки'],
    ['Burberry джинсовые шорты', 'Шорты'],
    ['男士轻薄皮衣夹克', 'Кожаные куртки'],
    ['Женская замшевая куртка', 'Кожаные куртки'],
    ['Куртка из замши', 'Кожаные куртки'],
    ['羊绒开衫', 'Кардиганы'],
    ['男士羽绒服', 'Пуховики'],
    ['Чёрный твидовый жакет', 'Жакеты'],
    ['Классический пиджак blazer', 'Пиджаки'],
    ['Джинсовая куртка прямого кроя', 'Куртки'],
    ['Джинсовая рубашка с карманами', 'Рубашки'],
    ['Джинсовый жилет', 'Жилеты'],
    ['Джинсовый кроп-топ', 'Топы'],
    ['Джинсовая футболка-поло', 'Футболки и майки'],
    ['Джинсовые брюки', 'Джинсы'],
  ])('infers %s as %s', (source, expected) => {
    expect(inferClothingSubcategoryName(source)).toBe(expected)
  })

  it.each([
    ['Замшевая куртка', 'Кожаные куртки'],
    ['Куртка из замши', 'Кожаные куртки'],
  ])('normalizes %s to %s', (source, expected) => {
    expect(canonicalClothingSubcategoryName(source)).toBe(expected)
  })

  it('does not classify generic Chinese outerwear without visual context', () => {
    expect(inferClothingSubcategoryName('男士外套')).toBe('')
  })
})

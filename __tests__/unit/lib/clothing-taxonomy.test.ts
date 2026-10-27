import { describe, expect, it } from 'vitest'
import {
  canonicalClothingSubcategoryName,
  inferClothingSubcategoryName,
  inferClothingSubcategoryNameFromProse,
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
    ['Дублёнка', 'Дублёнки'],
    ['Дубленки', 'Дублёнки'],
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
    ['Мужская дублёнка из овчины', 'Дублёнки'],
    ['Женская дубленка с мехом', 'Дублёнки'],
    ['男士羊皮毛一体外套', 'Дублёнки'],
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

  it('does not confuse a wearing-comfort phrase with socks', () => {
    expect(inferClothingSubcategoryName(
      'Голубые прямые джинсы из денима. Натуральный хлопковый материал обеспечивает комфорт в носке.',
    )).toBe('Джинсы')
  })

  it('recognizes diminutive sock names', () => {
    expect(inferClothingSubcategoryName('Носочки из хлопка')).toBe('Носки')
  })

  it('распознаёт бомбер, блузон и мотокуртку как куртку', () => {
    expect(inferClothingSubcategoryName('Чёрный кожаный бомбер с тиснением Monogram')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Бежевый бомбер из кашемира на молнии')).toBe('Куртки')
    expect(inferClothingSubcategoryName('Кожаная мотокуртка колор-блок с логотипом Unity')).toBe('Кожаные куртки')
  })

  it('решает по материалу самой вещи, а не по отделке', () => {
    expect(inferClothingSubcategoryName('Зелёный шерстяной бомбер с кожаными рукавами и вышивкой')).toBe('Куртки')
    expect(inferClothingSubcategoryName('Светло-бежевая хлопковая куртка с кожаным воротником')).toBe('Куртки')
    expect(inferClothingSubcategoryName('Чёрная замшевая куртка с капюшоном и кожаными карманами')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Чёрная укороченная куртка из кожи ягнёнка с отложным воротником')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Коричневый кожаный бомбер из наппы')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Бежевый замшевый бомбер на молнии')).toBe('Кожаные куртки')
  })

  it('не делает кожаной курткой комбинированную вещь', () => {
    expect(inferClothingSubcategoryName('Тёмно-зелёная комбинированная кожаная куртка с жемчужным пуллером')).toBe('Куртки')
    expect(inferClothingSubcategoryName('Двусторонняя куртка из кожи и нейлона с капюшоном')).toBe('Куртки')
    expect(inferClothingSubcategoryName('Красно-чёрный бомбер Damier с рукавами из зернистой кожи')).toBe('Куртки')
  })

  it('считает куртку-рубашку и куртку-пиджак курткой', () => {
    expect(inferClothingSubcategoryName('Чёрная кожаная рубашка-куртка с плетёной вставкой Intrecciato')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Синяя замшевая куртка-рубашка с плетением Intrecciato')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Зелёная замшевая куртка-пиджак с треугольной нашивкой')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Чёрная кожаная рубашка с кубинским воротником')).toBe('Рубашки')
  })

  it('отличает дублёнку от куртки с меховым воротником', () => {
    expect(inferClothingSubcategoryName('Коричневая куртка из овчины и кожи с ремнём')).toBe('Дублёнки')
    expect(inferClothingSubcategoryName('Светло-серая замшевая куртка с овчиной')).toBe('Дублёнки')
    expect(inferClothingSubcategoryName('Чёрная кожаная куртка-рубашка с подкладкой из овчины')).toBe('Дублёнки')
    expect(inferClothingSubcategoryName('Коричневый кожаный бомбер с воротником из овчины')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Коричневая куртка из замши с тиснением Monogram и отделкой овчиной')).toBe('Кожаные куртки')
  })

  it('понимает кожу и замшу как материал верхней одежды', () => {
    expect(inferClothingSubcategoryName('Бежевое кожаное худи с логотипом')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Чёрная стёганая кожаная куртка с вышивкой')).toBe('Кожаные куртки')
    expect(inferClothingSubcategoryName('Чёрные кожаные брюки прямого кроя')).toBe('Штаны')
    expect(inferClothingSubcategoryName('Чёрный кожаный пиджак прямого кроя')).toBe('Пиджаки')
    expect(inferClothingSubcategoryName('Коричневые кожаные шорты с монограммой')).toBe('Шорты')
  })

  it('назначает вязаный жакет кардиганом, а костюмный — жакетом', () => {
    expect(inferClothingSubcategoryName('Серо-бежевый кашемировый жакет прямого кроя на пуговицах')).toBe('Кардиганы')
    expect(inferClothingSubcategoryName('Коричневый твидовый жакет с зелёными пуговицами')).toBe('Жакеты')
  })

  it('не берёт тип из служебного упоминания в описании', () => {
    expect(inferClothingSubcategoryNameFromProse('Модель гармонично сочетается как с базовыми футболками, так и с трикотажем.')).toBe('')
    expect(inferClothingSubcategoryNameFromProse('Купить можно вместе с брюками и ремнём.')).toBe('')
    expect(inferClothingSubcategoryNameFromProse('Натуральный хлопковый материал обеспечивает комфорт в носке.')).toBe('')
    expect(inferClothingSubcategoryNameFromProse('Мужская кожаная куртка свободного кроя с молнией.')).toBe('Кожаные куртки')
  })
})

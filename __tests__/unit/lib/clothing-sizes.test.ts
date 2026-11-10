import { describe, expect, it } from 'vitest'
import { expandEvenSizeRange, planEvenClothingSizes } from '@/lib/clothing-sizes'
import { normalizeCatalogAttributes } from '@/lib/catalog-attribute-values'

describe('чётные размерные ряды одежды', () => {
  it('разворачивает диапазон через 2', () => {
    expect(expandEvenSizeRange('28-36')).toEqual(['28', '30', '32', '34', '36'])
    expect(expandEvenSizeRange('48–56')).toEqual(['48', '50', '52', '54', '56'])
    expect(expandEvenSizeRange('29-36')).toEqual(['30', '32', '34', '36'])
  })

  it('не трогает обувные и детские диапазоны', () => {
    expect(expandEvenSizeRange('1-5')).toEqual(['1-5'])
    expect(expandEvenSizeRange('36,5-38')).toEqual(['36,5-38'])
  })

  it('снимает нечётные значения из полного чётного интервала', () => {
    expect(planEvenClothingSizes(['28', '29', '30', '31', '32', '33', '34', '35', '36']))
      .toEqual({ removed: ['29', '31', '33', '35'], kept: ['28', '30', '32', '34', '36'] })
    expect(planEvenClothingSizes(['27', '28', '30', '32', '34', '36']))
      .toEqual({ removed: ['27'], kept: ['28', '30', '32', '34', '36'] })
    expect(planEvenClothingSizes(['24', '25', '26', '27', '28', '29']))
      .toEqual({ removed: ['25', '27', '29'], kept: ['24', '26', '28'] })
  })

  it('оставляет ряды, где нечётный размер единственный', () => {
    expect(planEvenClothingSizes(['31'])).toBeNull()
    expect(planEvenClothingSizes(['27'])).toBeNull()
    expect(planEvenClothingSizes(['1', '2', '3', '4', '5'])).toBeNull()
    expect(planEvenClothingSizes(['39', '40', '41'])).toBeNull()
    expect(planEvenClothingSizes(['S', 'M', 'L'])).toBeNull()
  })

  it('приводит размеры одежды при нормализации атрибутов, но не обуви', () => {
    expect(normalizeCatalogAttributes({ sizes: '28-36' }, { categoryName: 'Одежда' }))
      .toEqual({ sizes: { values: ['28', '30', '32', '34', '36'] } })
    expect(normalizeCatalogAttributes({ sizes: '36-38' }, { categoryName: 'Обувь' }))
      .toEqual({ sizes: { values: ['36', '37', '38'] } })
  })
})

import { describe, expect, it } from 'vitest'

import { applyCatalogSizeRules, hasExplicitSizeLabel } from '@/lib/size-rules'

describe('catalog size rules', () => {
  it('removes every bag size and returns the nominal one for the name', () => {
    const dimension = applyCatalogSizeRules({ categoryName: 'Сумки', subcategoryName: 'Рюкзаки', sizes: ['5'] })
    expect(dimension).toMatchObject({ changed: true, sizes: null, nominalBagSize: '' })

    const nominal = applyCatalogSizeRules({ categoryName: 'Сумки', subcategoryName: 'Клатчи', sizes: ['25'] })
    expect(nominal).toMatchObject({ changed: true, sizes: null, nominalBagSize: '25' })
  })

  it('keeps jewelry sizes only when the supplier text labels them', () => {
    const invented = applyCatalogSizeRules({
      categoryName: 'Ювелирные изделия',
      subcategoryName: 'Кольца',
      sizes: ['54'],
      sourceText: '蝴蝶戒指 18K金镶嵌天然钻石。',
    })
    expect(invented).toMatchObject({ changed: true, sizes: null, removed: ['54'] })

    const labelled = applyCatalogSizeRules({
      categoryName: 'Ювелирные изделия',
      subcategoryName: 'Кольца',
      sizes: ['17'],
      sourceText: '尺寸：17 圈口',
    })
    expect(labelled.changed).toBe(false)
  })

  it('drops numeric sizes of wallets, passport covers, cosmetic bags and eyewear', () => {
    expect(applyCatalogSizeRules({ categoryName: 'Аксессуары', subcategoryName: 'Кошельки и картхолдеры', sizes: ['10'] }))
      .toMatchObject({ changed: true, sizes: null })
    expect(applyCatalogSizeRules({ categoryName: 'Аксессуары', subcategoryName: 'Очки', sizes: ['60-12-140'] }))
      .toMatchObject({ changed: true, sizes: null })
    expect(applyCatalogSizeRules({ categoryName: 'Аксессуары', subcategoryName: 'Шапки', sizes: ['OS'] }).changed)
      .toBe(false)
  })

  it('keeps only inch sizes for luggage', () => {
    expect(applyCatalogSizeRules({ categoryName: 'Аксессуары', subcategoryName: 'Чемоданы', sizes: ['20', '16'] }))
      .toMatchObject({ changed: true, sizes: ['20'], removed: ['16'] })
  })

  it('does not touch clothing runs', () => {
    expect(applyCatalogSizeRules({ categoryName: 'Одежда', subcategoryName: 'Футболки и майки', sizes: ['S'] }).changed)
      .toBe(false)
  })

  it('recognizes an explicit ring size label but not an article number', () => {
    expect(hasExplicitSizeLabel('窄版手镯 17号')).toBe(true)
    expect(hasExplicitSizeLabel('款号：795221')).toBe(false)
    expect(hasExplicitSizeLabel('18K金镶嵌天然钻石')).toBe(false)
  })
})

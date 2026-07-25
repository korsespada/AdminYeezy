import { describe, expect, it } from 'vitest'
import cleanup from '../../../scripts/cleanup-product-descriptions.js'

const {
  cleanDescription,
  removeChineseCharacters,
  stripUnmatchedEdgeQuotes,
} = cleanup

describe('product description cleanup', () => {
  it('converts doubled phrase quotes to guillemets', () => {
    expect(cleanDescription('Серия ""Животные в джунглях""').description)
      .toBe('Серия «Животные в джунглях»')
  })

  it('removes empty doubled quotes', () => {
    expect(cleanDescription('Цвет "" (молочный чай)').description)
      .toBe('Цвет (молочный чай)')
  })

  it('removes an unmatched trailing quote but preserves a quoted phrase', () => {
    expect(stripUnmatchedEdgeQuotes('Описание товара."')).toBe('Описание товара.')
    expect(stripUnmatchedEdgeQuotes('Цвет "слоновая кость"')).toBe('Цвет "слоновая кость"')
  })

  it('removes quotes wrapping the whole description', () => {
    expect(stripUnmatchedEdgeQuotes('"Описание товара"')).toBe('Описание товара')
  })

  it('collapses blank gaps only when they occur more than twice', () => {
    expect(cleanDescription('Стиль\n\nЦвет\n\nРазмер').description)
      .toBe('Стиль\n\nЦвет\n\nРазмер')
    expect(cleanDescription('Стиль\n\nЦвет\n\nРазмер\n\nМатериал').description)
      .toBe('Стиль\nЦвет\nРазмер\nМатериал')
  })

  it('collapses repeated escaped blank gaps as they appear in the UI', () => {
    expect(cleanDescription(String.raw`Стиль\n\nЦвет\n\nРазмер\n\nМатериал`).description)
      .toBe('Стиль\nЦвет\nРазмер\nМатериал')
    expect(cleanDescription(String.raw`Стиль\\n\\nЦвет\\n\\nРазмер\\n\\nМатериал`).description)
      .toBe('Стиль\nЦвет\nРазмер\nМатериал')
  })

  it('detects Chinese characters without deleting them', () => {
    const result = cleanDescription('Коллекция 幸运星')
    expect(result.hasChinese).toBe(true)
    expect(result.description).toBe('Коллекция 幸运星')
  })

  it('removes Chinese characters and their punctuation when requested', () => {
    expect(removeChineseCharacters('Принт 幸运星， колибри')).toBe('Принт колибри')
    expect(cleanDescription('Коллекция 奔腾骏马。 Размер 90 см', { removeChinese: true }).description)
      .toBe('Коллекция Размер 90 см')
    expect(removeChineseCharacters('Размеры: 36～38／40 ＆ 42')).toBe('Размеры: 36-38/40 & 42')
  })
})

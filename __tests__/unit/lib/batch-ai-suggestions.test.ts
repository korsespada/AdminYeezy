import { describe, expect, it } from 'vitest'
import { sameSubcategoryFamily, subcategoryFamilyKey } from '@/lib/batch-ai-suggestions'

describe('subcategoryFamilyKey', () => {
  it('merges punctuation, number and harmless wording variants', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).toBe(subcategoryFamilyKey('сумка тоут'))
    expect(subcategoryFamilyKey('Сумки с верхней ручкой')).toBe(subcategoryFamilyKey('Сумки с ручкой'))
  })

  it('keeps genuinely different subcategories separate', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).not.toBe(subcategoryFamilyKey('Сумки-хобо'))
    expect(sameSubcategoryFamily('Сумки-тоут', 'Сумки-хобо')).toBe(false)
  })

  it('merges a narrower wording into an existing broader family', () => {
    expect(sameSubcategoryFamily('Сумки с короткой ручкой', 'Сумки с ручкой')).toBe(true)
  })
})

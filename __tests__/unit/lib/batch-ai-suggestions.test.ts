import { describe, expect, it } from 'vitest'
import {
  canonicalColorFamilyKey,
  sameSubcategoryFamily,
  subcategoryFamilyKey,
} from '@/lib/batch-ai-suggestions'

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

describe('canonicalColorFamilyKey', () => {
  it('removes color from a candidate signature', () => {
    expect(canonicalColorFamilyKey({
      group_signature: 'Chanel Classic Flap medium Caviar gold white',
      color: 'White',
    })).toBe('chanel_classic_flap_medium_caviar_gold')
  })

  it('keeps size and construction differences separate', () => {
    const small = canonicalColorFamilyKey({ group_signature: 'Chanel Classic Flap TopHandle small gold pink', color: 'pink' })
    const medium = canonicalColorFamilyKey({ group_signature: 'Chanel Classic Flap medium gold white', color: 'white' })
    expect(small).not.toBe(medium)
  })
})

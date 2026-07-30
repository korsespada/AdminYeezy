import { describe, expect, it } from 'vitest'
import { subcategoryFamilyKey } from '@/lib/batch-ai-suggestions'

describe('subcategoryFamilyKey', () => {
  it('merges punctuation, number and harmless wording variants', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).toBe(subcategoryFamilyKey('сумка тоут'))
    expect(subcategoryFamilyKey('Сумки с верхней ручкой')).toBe(subcategoryFamilyKey('Сумки с ручкой'))
  })

  it('keeps genuinely different subcategories separate', () => {
    expect(subcategoryFamilyKey('Сумки-тоут')).not.toBe(subcategoryFamilyKey('Сумки-хобо'))
  })
})

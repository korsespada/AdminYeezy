import { describe, expect, it } from 'vitest'
import {
  formatImportAttributeValue,
  isGenericImportAttribute,
} from '@/lib/catalog-attribute-display'

describe('catalog attribute display helpers', () => {
  it('keeps structured size recommendations out of generic import attributes', () => {
    expect(isGenericImportAttribute('measurements', false)).toBe(false)
    expect(isGenericImportAttribute('size_recommendation', false)).toBe(false)
    expect(isGenericImportAttribute('colors', false)).toBe(true)
    expect(isGenericImportAttribute('size_recommendation', true)).toBe(false)
  })

  it('does not render object attributes as [object Object]', () => {
    expect(formatImportAttributeValue({
      columns: [{ key: 'height', label: 'Рост (см)' }],
      rows: [{ values: { height: '160-165' } }],
    })).toContain('Рост (см)')
    expect(formatImportAttributeValue({ value: 42 })).toBe('{"value":42}')
  })
})

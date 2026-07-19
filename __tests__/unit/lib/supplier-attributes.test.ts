import { describe, expect, it } from 'vitest'
import {
  getSupplierAttributeLabel,
  normalizeSupplierAttributeCodes,
} from '@/lib/supplier-attributes'

describe('supplier attributes', () => {
  it('keeps known unique attribute codes', () => {
    expect(normalizeSupplierAttributeCodes(['sizes', 'water_resistance', 'sizes', 'unknown'])).toEqual([
      'sizes',
      'water_resistance',
    ])
  })

  it('accepts JSON and comma-separated form values', () => {
    expect(normalizeSupplierAttributeCodes('["materials","colors"]')).toEqual(['materials', 'colors'])
    expect(normalizeSupplierAttributeCodes('sizes, water_resistance')).toEqual(['sizes', 'water_resistance'])
  })

  it('returns the Russian UI label', () => {
    expect(getSupplierAttributeLabel('water_resistance')).toBe('Водозащита')
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeSupplierPublishedOn, supplierPublishedOnFromAttributes } from '@/lib/supplier-publication'

describe('supplier publication date', () => {
  it('keeps a supplied ISO date', () => {
    expect(normalizeSupplierPublishedOn('2026-08-15')).toBe('2026-08-15')
  })

  it('uses the Szwego millisecond timestamp as a Moscow supplier publication date', () => {
    expect(supplierPublishedOnFromAttributes({ szwego_timestamp: 1786795246077 })).toBe('2026-08-15')
  })
})

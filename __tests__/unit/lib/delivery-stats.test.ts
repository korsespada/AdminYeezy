import { describe, expect, it } from 'vitest'
import { deliveryParcelFilters, deliveryPeriodParam, filterDeliveryParcels, formatDays, formatShare, formatWeek } from '@/lib/delivery-stats'
import type { RailsDeliveryParcelListRow } from '@/lib/rails-admin'

function row(overrides: Partial<RailsDeliveryParcelListRow>): RailsDeliveryParcelListRow {
  return {
    number: 'SF1000000000001', source: 'track', stage: 'customs', destination: 'Москва', recipient: 'Иван П.',
    lookups_count: 1, last_lookup_at: null, last_event_at: null, first_seen_at: null, started_at: null,
    last_event_text: 'Посылка поступила на таможенный склад', days: 5, customer_id: null, order_id: null,
    ...overrides,
  }
}

describe('delivery stats formatting', () => {
  it('passes only ISO dates to Rails', () => {
    expect(deliveryPeriodParam('2026-11-01')).toBe('2026-11-01')
    expect(deliveryPeriodParam(['2026-10-01', '2026-11-01'])).toBe('2026-10-01')
    expect(deliveryPeriodParam('01.11.2026')).toBeUndefined()
    expect(deliveryPeriodParam(undefined)).toBeUndefined()
  })

  it('formats days, shares and week starts', () => {
    expect(formatDays(13.2)).toBe('13,2 дн.')
    expect(formatDays(null)).toBe('—')
    expect(formatShare(1, 4)).toBe('25%')
    expect(formatShare(1, 0)).toBe('—')
    expect(formatWeek('2026-11-02')).toBe('02.11')
  })

  it('reads parcel filters from the query', () => {
    expect(deliveryParcelFilters({ stage: 'customs', q: ' Иван ' })).toEqual({ stage: 'customs', q: 'Иван' })
    expect(deliveryParcelFilters({ stage: 'active' })).toEqual({ stage: 'active', q: undefined })
    expect(deliveryParcelFilters({ stage: 'bogus', q: '' })).toEqual({ stage: undefined, q: undefined })
  })

  it('filters parcels by stage and search text', () => {
    const rows = [
      row({ number: 'SF1000000000001' }),
      row({ number: 'SF1000000000002', stage: 'delivered', recipient: 'Анна С.', destination: 'Хабаровск' }),
      row({ number: 'SF1000000000003', stage: null, recipient: null, destination: null, last_event_text: null }),
    ]

    expect(filterDeliveryParcels(rows, {}).length).toBe(3)
    expect(filterDeliveryParcels(rows, { stage: 'active' }).map((r) => r.number)).toEqual(['SF1000000000001', 'SF1000000000003'])
    expect(filterDeliveryParcels(rows, { stage: 'unknown' }).map((r) => r.number)).toEqual(['SF1000000000003'])
    expect(filterDeliveryParcels(rows, { q: 'анна' }).map((r) => r.number)).toEqual(['SF1000000000002'])
    expect(filterDeliveryParcels(rows, { q: 'хабар' }).map((r) => r.number)).toEqual(['SF1000000000002'])
    expect(filterDeliveryParcels(rows, { q: '0003' }).map((r) => r.number)).toEqual(['SF1000000000003'])
    expect(filterDeliveryParcels(rows, { stage: 'delivered', q: 'иван' })).toEqual([])
  })
})

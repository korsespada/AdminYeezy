import { describe, expect, it } from 'vitest'
import { deliveryPeriodParam, formatDays, formatShare, formatWeek } from '@/lib/delivery-stats'

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
})

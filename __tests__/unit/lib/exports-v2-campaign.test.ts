import { describe, expect, it } from 'vitest'
import { exportsV2CampaignTotals, normalizeExportsV2CampaignItems } from '@/lib/exports-v2-campaign'

describe('exports v2 campaigns', () => {
  it('deduplicates suppliers and keeps the last individual cutoff date', () => {
    expect(normalizeExportsV2CampaignItems([
      { supplierId: 7, endDate: '2026-06-01' },
      { supplierId: 8 },
      { supplierId: 7, endDate: '2026-07-01' },
      { supplierId: -1, endDate: 'bad' },
    ])).toEqual([
      { supplierId: 7, endDate: '2026-07-01' },
      { supplierId: 8, endDate: '' },
    ])
  })

  it('drops malformed dates instead of passing them to PostgreSQL', () => {
    expect(normalizeExportsV2CampaignItems([{ supplierId: 3, endDate: '01.07.2026' }]))
      .toEqual([{ supplierId: 3, endDate: '' }])
  })

  it('sums folder metrics', () => {
    expect(exportsV2CampaignTotals([
      { album_count: 10, draft_count: 4, pushed_count: 2 },
      { album_count: 7, draft_count: 3, pushed_count: 1 },
    ])).toEqual({ albums: 17, products: 7, pushed: 3 })
  })
})

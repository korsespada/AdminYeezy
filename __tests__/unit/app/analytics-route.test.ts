import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAnalyticsChannel, getChannelSql, getPeriodSql, GET } from '@/app/api/analytics/route'
import { analyticsQuery } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-session'
import { listRailsCrmOrders } from '@/lib/rails-admin'

vi.mock('@/lib/db', () => ({
  analyticsQuery: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: vi.fn(),
  isAdminAuthError: (error: any) => error?.name === 'AdminAuthError',
}))

vi.mock('@/lib/rails-admin', () => ({
  listRailsCrmOrders: vi.fn(),
}))

const mockedRequireAdmin = vi.mocked(requireAdmin)
const mockedAnalyticsQuery = vi.mocked(analyticsQuery)
const mockedListRailsCrmOrders = vi.mocked(listRailsCrmOrders)

describe('Analytics route unit tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('DATABASE_URL', 'postgresql://analytics.example/db')
    mockedRequireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com', source: 'rails' } as any)
    mockedAnalyticsQuery.mockResolvedValue({ rows: [] } as any)
    mockedListRailsCrmOrders.mockResolvedValue({ items: [], totalItems: 0, totalPages: 0 } as any)
  })

  it('correctly maps channel parameters', () => {
    expect(getAnalyticsChannel('site')).toBe('site')
    expect(getAnalyticsChannel('site_desktop')).toBe('site_desktop')
    expect(getAnalyticsChannel('site_mobile')).toBe('site_mobile')
    expect(getAnalyticsChannel('telegram')).toBe('telegram')
    expect(getAnalyticsChannel('other')).toBe('all')
    expect(getAnalyticsChannel(null)).toBe('all')
  })

  it('generates appropriate channel SQL filters', () => {
    expect(getChannelSql('all')).toBe('1=1')
    expect(getChannelSql('telegram')).toContain("= 'telegram'")
    expect(getChannelSql('site')).toContain("!= 'telegram'")
    expect(getChannelSql('site_desktop')).toContain('desktop')
    expect(getChannelSql('site_mobile')).toContain('mobile')
  })

  it('handles custom date ranges and presets in getPeriodSql', () => {
    const custom = getPeriodSql('custom', '2026-09-01', '2026-09-05')
    expect(custom.timeFilter).toContain('2026-09-01 00:00:00')
    expect(custom.timeFilter).toContain('2026-09-05 23:59:59')
    expect(custom.fromDate).toBeInstanceOf(Date)
    expect(custom.toDate).toBeInstanceOf(Date)

    const yesterday = getPeriodSql('yesterday')
    expect(yesterday.timeFilter).toContain("CURRENT_DATE - INTERVAL '1 day'")

    const week = getPeriodSql('week')
    expect(week.timeFilter).toContain("NOW() - INTERVAL '7 days'")

    const month = getPeriodSql('month')
    expect(month.timeFilter).toContain("NOW() - INTERVAL '30 days'")

    const all = getPeriodSql('all')
    expect(all.timeFilter).toBe('1=1')
    expect(all.periodStart).toBeNull()
  })

  it('returns aggregated metrics, funnel, financial stats and integrations in GET response', async () => {
    vi.stubEnv('RAILS_API_URL', 'https://rails.example.com')
    vi.stubEnv('NEXT_PUBLIC_YM_COUNTER_ID', '12345678')
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-ABC123XYZ')

    mockedAnalyticsQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('period_events')) {
        return {
          rows: [
            {
              unique_visitors: '100',
              unique_product_viewers: '60',
              viewed_products: '25',
              unique_product_views: '150',
              product_views: '200',
              add_to_cart: '30',
              add_to_favorites: '15',
              order_submit: '10',
              ask_manager: '5',
              site_clicks: '12',
              tg_site_clicks: '9',
              page_views: '500',
              total_events: '900',
              returning_visitors: '20',
              new_visitors: '80',
              online_now: '8',
            },
          ],
        } as any
      }
      if (sql.includes("WHEN COALESCE(NULLIF(meta->>'channel', '')")) {
        return {
          rows: [
            {
              name: 'Telegram Mini App',
              visitors: '40',
              views: '120',
              carts: '15',
              checkouts: '5',
              purchases: '2',
            },
            {
              name: 'Яндекс (Органика)',
              visitors: '35',
              views: '90',
              carts: '10',
              checkouts: '4',
              purchases: '1',
            },
          ],
        } as any
      }
      if (sql.includes("event = 'search'")) {
        return {
          rows: [
            {
              query: 'yeezy 350',
              searches: '25',
              unique_users: '18',
            },
          ],
        } as any
      }
      return { rows: [] } as any
    })

    mockedListRailsCrmOrders.mockResolvedValue({
      items: [
        {
          id: 'ord-1',
          public_number: 'ORD-001',
          status: 'paid',
          total_cents: 2500000,
          currency: 'RUB',
          source: 'site',
          created_at: new Date().toISOString(),
        },
        {
          id: 'ord-2',
          public_number: 'ORD-002',
          status: 'payment_pending',
          total_cents: 1000000,
          currency: 'RUB',
          source: 'site',
          created_at: new Date().toISOString(),
        },
      ] as any,
      totalItems: 2,
      totalPages: 1,
    })

    const response = await GET(new Request('https://admin.example.com/api/analytics?period=week&channel=site'))
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.overview.unique_visitors).toBe(100)
    expect(data.overview.site_clicks).toBe(12)
    expect(data.overview.tg_site_clicks).toBe(9)
    expect(data.financial.revenue).toBe(25000)
    expect(data.financial.paid_orders).toBe(1)
    expect(data.financial.pending_orders).toBe(1)
    expect(data.financial.aov).toBe(25000)

    expect(data.funnel).toHaveLength(5)
    expect(data.funnel[0].step).toBe('Визиты')
    expect(data.funnel[0].count).toBe(100)

    expect(data.trafficSources).toHaveLength(2)
    expect(data.trafficSources[0].name).toBe('Telegram Mini App')
    expect(data.trafficSources[0].visitors).toBe(40)
    expect(data.trafficSources[0].cartRate).toBe(37.5)

    expect(data.searchDemands).toHaveLength(1)
    expect(data.searchDemands[0].query).toBe('yeezy 350')
    expect(data.searchDemands[0].searches).toBe(25)
    expect(data.searchDemands[0].unique_users).toBe(18)

    expect(data.externalIntegrations.yandexMetrika.configured).toBe(true)
    expect(data.externalIntegrations.yandexMetrika.counterId).toBe('12345678')
    expect(data.externalIntegrations.yandexWebmaster.configured).toBe(true)
    expect(data.externalIntegrations.yandexWebmaster.siteUrl).toBe('https://yeezyunique.ru')
    expect(data.externalIntegrations.googleSearchConsole.configured).toBe(true)
    expect(data.externalIntegrations.googleSearchConsole.property).toBe('sc-domain:yeezyunique.ru')
    expect(data.externalIntegrations.googleMerchantCenter.configured).toBe(true)
    expect(data.externalIntegrations.googleMerchantCenter.accountId).toBe('5830671674')
    expect(data.externalIntegrations.googleAnalytics.configured).toBe(true)
    expect(data.externalIntegrations.googleAnalytics.tagId).toBe('G-ABC123XYZ')
  })
})

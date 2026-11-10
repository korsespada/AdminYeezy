import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CrmDeliveryStats from '@/components/crm/CrmDeliveryStats'
import type { RailsDeliveryParcelListRow, RailsDeliveryStats } from '@/lib/rails-admin'

vi.mock('@/actions/crm', () => ({ refreshDeliveryParcelAction: vi.fn() }))

const duration = { count: 1, median: 19.4, average: 19.4, p90: 20 }

function parcel(overrides: Partial<RailsDeliveryParcelListRow>): RailsDeliveryParcelListRow {
  return {
    number: 'SF1000000000001', source: 'track', stage: 'customs', destination: 'Москва', recipient: 'Иван П.',
    lookups_count: 2, last_lookup_at: null, last_event_at: '2026-11-02T12:00:00Z', first_seen_at: '2026-11-01T10:00:00Z',
    started_at: '2026-10-20T10:00:00Z', last_event_text: 'Посылка поступила на таможенный склад', days: 25,
    customer_id: null, order_id: null, ...overrides,
  }
}

function stats(parcelList?: RailsDeliveryParcelListRow[]): RailsDeliveryStats {
  return {
    period: { from: '2026-08-12', to: '2026-11-10' },
    generated_at: '2026-11-10T09:00:00Z',
    lookups: { numbers: 2, found: 2, not_found: 0, unavailable: 0, lookups: 3, avg_lookups_per_found: 1.5, repeat_checked: 0, off_site_parcels: 1 },
    shipments: { total: 1, created: 0, in_transit: 0, delivered: 1, with_order: 1, without_order: 0, with_error: 0 },
    parcels: { total: 2, delivered: 1, handed_to_cdek: 0, notice_seen: 0 },
    weekly: [],
    stages: { created: 0, shipped: 0, customs: 1, sorting: 0, delivered: 1, unknown: 0 },
    destinations: [{ city: 'Хабаровск', count: 1, delivered: 1, median_days: 19.4 }, { city: 'Москва', count: 1, delivered: 0, median_days: null }],
    durations: { total: duration, before_customs: duration, customs: duration, after_customs: duration },
    stuck: [],
    most_checked: [],
    parcel_list: parcelList,
  }
}

describe('CrmDeliveryStats parcel list', () => {
  const rows = [
    parcel({}),
    parcel({
      number: 'SF1000000000002', source: 'crm', stage: 'delivered', recipient: 'Анна С.', destination: 'Хабаровск',
      last_event_text: 'Вручен Хабаровск', days: 19.4, lookups_count: null, customer_id: 'c-1', order_id: 'o-1',
    }),
  ]

  it('shows recipient, city, status and transit time for every parcel', () => {
    render(<CrmDeliveryStats stats={stats(rows)} />)

    const list = screen.getByRole('region', { name: 'Все посылки' })
    const [, inTransit, delivered] = within(list).getAllByRole('row')

    expect(within(inTransit).getByText('Иван П.')).toBeInTheDocument()
    expect(within(inTransit).getByText('На таможне')).toBeInTheDocument()
    expect(within(inTransit).getByText('25 дн.')).toHaveClass('text-amber-300')
    expect(within(inTransit).getByText('в пути')).toBeInTheDocument()

    expect(within(delivered).getByText('Хабаровск')).toBeInTheDocument()
    expect(within(delivered).getByText('19,4 дн.')).toHaveClass('text-emerald-300')
    expect(within(delivered).getByRole('link', { name: 'Заказ' })).toHaveAttribute('href', '/admin/crm/orders/o-1')

    expect(within(inTransit).getByRole('button', { name: 'Обновить статус SF1000000000001' })).toBeInTheDocument()
    expect(within(delivered).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows median delivery time per city', () => {
    render(<CrmDeliveryStats stats={stats(rows)} />)

    const cities = screen.getByRole('region', { name: 'Города назначения' })
    expect(within(cities).getByText('19,4 дн. · вручено 1')).toBeInTheDocument()
    expect(within(cities).getByText('вручённых нет')).toBeInTheDocument()
  })

  it('applies filters and keeps the period in the filter form', () => {
    render(<CrmDeliveryStats stats={stats(rows)} filters={{ q: 'анна' }} />)

    const list = screen.getByRole('region', { name: 'Все посылки' })
    expect(within(list).getByText('1 из 2')).toBeInTheDocument()
    expect(within(list).queryByText('Иван П.')).not.toBeInTheDocument()
    expect(within(list).getByDisplayValue('2026-08-12')).toHaveAttribute('name', 'from')
  })

  it('hides the list when Rails does not send it yet', () => {
    render(<CrmDeliveryStats stats={stats()} />)

    expect(screen.queryByRole('region', { name: 'Все посылки' })).not.toBeInTheDocument()
  })
})

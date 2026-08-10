import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CrmOrderDetail from '@/components/crm/CrmOrderDetail'

vi.mock('@/actions/crm', () => ({ transitionOrderAction: vi.fn() }))

describe('CrmOrderDetail', () => {
  it('renders the simplified order detail', () => {
    render(
      <CrmOrderDetail
        order={{
          id: 10,
          public_number: 'YU-130626-00001',
          status: 'paid',
          currency: 'RUB',
          total_cents: 300000,
          created_at: '2026-06-13T10:00:00Z',
          customer: { display_name: 'CRM Customer', telegram_username: 'crm_customer' },
          items: [
            {
              id: 20,
              public_number: 'YU-130626-00001-01',
              title: 'Checked Sneakers',
              size: '42',
              quantity: 1,
              unit_price_cents: 300000,
              total_price_cents: 300000,
            },
          ],
          payments: [{ id: 80, provider: 'platega', status: 'succeeded', amount_cents: 300000, currency: 'RUB' }],
          refunds: [],
          timeline: [{ id: 90, event_type: 'payment_succeeded', from_status: 'payment_pending', to_status: 'paid', created_at: '2026-06-13T10:05:00Z' }],
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'YU-130626-00001' })).toBeInTheDocument()
    expect(screen.getByText('CRM Customer')).toBeInTheDocument()
    expect(screen.getByText('Checked Sneakers')).toBeInTheDocument()
    expect(screen.getByText('Состав заказа')).toBeInTheDocument()
    expect(screen.getByText('Количество: 1')).toBeInTheDocument()
    expect(screen.getByText('Платежи и возвраты')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
  })
})

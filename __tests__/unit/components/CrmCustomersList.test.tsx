import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CrmCustomersList from '@/components/crm/CrmCustomersList'

describe('CrmCustomersList', () => {
  it('renders customers with contact, wallet and order aggregates', () => {
    render(
      <CrmCustomersList
        customers={[
          {
            id: 'customer-1',
            display_name: 'VIP Customer',
            email: 'vip@example.com',
            phone: '+79990001111',
            telegram_id: '12345',
            telegram_username: 'vip_customer',
            country: 'RU',
            preferred_contact_channel: 'telegram',
            referral_code: 'VIPCODE',
            created_at: '2026-06-13T10:00:00Z',
            order_count: 2,
            last_order_at: '2026-06-13T11:00:00Z',
            wallet_cash_cents: 12000,
            wallet_bonus_cents: 3000,
            wallet_total_cents: 15000,
          },
        ]}
        totalItems={1}
        totalPages={1}
        page={1}
        search="vip"
      />
    )

    expect(screen.getByRole('heading', { name: 'Пользователи' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('vip')).toBeInTheDocument()
    expect(screen.getByText('VIP Customer')).toBeInTheDocument()
    expect(screen.getByText('vip@example.com')).toBeInTheDocument()
    expect(screen.getByText('@vip_customer')).toBeInTheDocument()
    expect(screen.getByText('VIPCODE')).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()
  })
})

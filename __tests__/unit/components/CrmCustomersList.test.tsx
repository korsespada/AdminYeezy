import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CrmCustomersList from '@/components/crm/CrmCustomersList'

describe('CrmCustomersList', () => {
  it('renders customers with source, contact and order aggregates', () => {
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
            registration_source: 'site',
          },
        ]}
        totalItems={1}
        totalPages={1}
        page={1}
        search="vip"
      />
    )

    expect(screen.getByRole('heading', { name: 'Клиенты' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('vip')).toBeInTheDocument()
    expect(screen.getByText('VIP Customer')).toBeInTheDocument()
    expect(screen.getByText('vip@example.com')).toBeInTheDocument()
    expect(screen.getByText('@vip_customer')).toBeInTheDocument()
    expect(screen.getAllByText('Сайт').length).toBeGreaterThanOrEqual(1)
  })
})

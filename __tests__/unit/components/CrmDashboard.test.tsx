import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CrmDashboard from '@/components/crm/CrmDashboard'

describe('CrmDashboard', () => {
  it('renders CRM workspaces and recent orders', () => {
    render(
      <CrmDashboard
        railsConfigured
        recentOrders={[
          {
            id: 1,
            public_number: 'YU-1001',
            status: 'paid',
            currency: 'RUB',
            total_cents: 450000,
            created_at: '2026-06-13T10:00:00Z',
            customer: { display_name: 'Test Customer' },
          },
        ]}
        counts={{
          orders: 3,
          customers: 7,
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'CRM' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть раздел CRM: Заказы' })).toHaveAttribute('href', '/admin/crm/orders')
    expect(screen.getByRole('link', { name: 'Открыть раздел CRM: Клиенты' })).toHaveAttribute('href', '/admin/crm/customers')
    expect(screen.getByText('Подключен')).toBeInTheDocument()
    expect(screen.getByText('YU-1001')).toBeInTheDocument()
    expect(screen.getByText('Test Customer')).toBeInTheDocument()
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })
})

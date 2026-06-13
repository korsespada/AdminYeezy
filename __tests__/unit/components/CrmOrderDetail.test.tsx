import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CrmOrderDetail from '@/components/crm/CrmOrderDetail'

vi.mock('@/actions/crm', () => ({
  createReplacementOfferAction: vi.fn(),
  createSupplierRequestAction: vi.fn(),
  recordSupplierResponseAction: vi.fn(),
  transitionOrderAction: vi.fn(),
  transitionOrderItemAction: vi.fn(),
}))

describe('CrmOrderDetail', () => {
  it('renders order detail workflow panels', () => {
    render(
      <CrmOrderDetail
        replacementSearch="replacement"
        replacementItem="20"
        replacementProducts={[
          {
            id: 70,
            name: 'Replacement Candidate',
            sku: 'REP-1',
            price_cents: 310000,
            currency: 'RUB',
            brand: { name: 'Candidate Brand' },
            variants: [{ id: 71, size: '43', sku: 'REP-1-43', price_cents: 315000, status: 'active' }],
          },
        ]}
        order={{
          id: 10,
          public_number: 'YU-130626-00001',
          status: 'paid',
          currency: 'RUB',
          total_cents: 300000,
          wallet_spent_cents: 0,
          created_at: '2026-06-13T10:00:00Z',
          public_message: 'Оплата прошла.',
          customer: { display_name: 'CRM Customer', telegram_username: 'crm_customer' },
          item_counts: { paid_pending_check: 1 },
          items: [
            {
              id: 20,
              public_number: 'YU-130626-00001-01',
              title: 'Checked Sneakers',
              size: '42',
              sku: 'CHK-1',
              fulfillment_mode: 'requires_confirmation',
              status: 'paid_pending_check',
              quantity: 1,
              unit_price_cents: 300000,
              total_price_cents: 300000,
              supplier: { id: 30, name: 'Supplier One', wechat_name: 'factory-one' },
              supplier_requests: [
                {
                  id: 40,
                  supplier_name: 'Supplier One',
                  request_type: 'availability',
                  status: 'sent',
                  message_text: 'have?',
                  responses: [{ id: 50, response_type: 'has', message_text: 'has', price_cents: 300000 }],
                },
              ],
              replacement_offers: [
                {
                  id: 60,
                  status: 'offered',
                  replacement_product: { id: 70, name: 'Replacement Sneakers', price_cents: 310000 },
                },
              ],
            },
          ],
          payments: [{ id: 80, provider: 'yookassa', status: 'succeeded', amount_cents: 300000, currency: 'RUB' }],
          refunds: [],
          timeline: [{ id: 90, event_type: 'payment_succeeded', from_status: 'payment_pending', to_status: 'paid', created_at: '2026-06-13T10:05:00Z' }],
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'YU-130626-00001' })).toBeInTheDocument()
    expect(screen.getByText('CRM Customer')).toBeInTheDocument()
    expect(screen.getByText('Checked Sneakers')).toBeInTheDocument()
    expect(screen.getByText('Supplier requests')).toBeInTheDocument()
    expect(screen.getByText('Replacement offers')).toBeInTheDocument()
    expect(screen.getByText('Replacement Candidate')).toBeInTheDocument()
    expect(screen.getByText('Replacement Sneakers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Обновить статус' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать запрос' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Предложить эту замену' })).toBeInTheDocument()
  })
})

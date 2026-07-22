import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RefundActions, WithdrawalActions } from '@/components/crm/CrmFinancialActions'

vi.mock('@/actions/crm', () => ({
  approveRefundAction: vi.fn(),
  rejectRefundAction: vi.fn(),
  approveWalletWithdrawalAction: vi.fn(),
  rejectWalletWithdrawalAction: vi.fn(),
  markWalletWithdrawalPaidAction: vi.fn(),
}))

describe('CRM financial actions', () => {
  it('renders approve and reject controls for requested refunds', () => {
    render(
      <RefundActions
        refund={{
          id: 'refund-1',
          order_id: 'order-1',
          order_public_number: 'YU-1',
          status: 'requested',
          amount_cents: 10000,
          currency: 'RUB',
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Reject reason')).toBeInTheDocument()
  })

  it('renders wallet controls according to status', () => {
    const { rerender } = render(
      <WithdrawalActions
        request={{
          id: 'withdrawal-1',
          customer_name: 'VIP Customer',
          status: 'requested',
          amount_cents: 10000,
          currency: 'RUB',
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()

    rerender(
      <WithdrawalActions
        request={{
          id: 'withdrawal-1',
          customer_name: 'VIP Customer',
          status: 'approved',
          amount_cents: 10000,
          currency: 'RUB',
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument()
  })
})

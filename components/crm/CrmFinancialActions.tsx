import {
  approveRefundAction,
  approveWalletWithdrawalAction,
  markWalletWithdrawalPaidAction,
  rejectRefundAction,
  rejectWalletWithdrawalAction,
} from '@/actions/crm'
import { Button } from '@/components/ui/button'
import { type RailsCrmRefund, type RailsCrmWalletWithdrawal } from '@/lib/rails-admin'

export function RefundActions({ refund }: { refund: RailsCrmRefund }) {
  if (!['requested', 'pending'].includes(refund.status)) {
    return <div className="text-right text-xs text-slate-600">-</div>
  }

  return (
    <div className="ml-auto grid max-w-64 gap-2">
      <form action={approveRefundAction} className="flex justify-end">
        <input type="hidden" name="refundId" value={String(refund.id)} />
        <input type="hidden" name="orderId" value={refund.order_id ? String(refund.order_id) : ''} />
        <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-500">
          Approve
        </Button>
      </form>
      <form action={rejectRefundAction} className="flex gap-2">
        <input type="hidden" name="refundId" value={String(refund.id)} />
        <input type="hidden" name="orderId" value={refund.order_id ? String(refund.order_id) : ''} />
        <input
          name="message"
          placeholder="Reject reason"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white outline-none transition focus:border-sky-500"
        />
        <Button type="submit" size="sm" variant="outline" className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
          Reject
        </Button>
      </form>
    </div>
  )
}

export function WithdrawalActions({ request }: { request: RailsCrmWalletWithdrawal }) {
  if (request.status === 'requested') {
    return (
      <div className="ml-auto grid max-w-64 gap-2">
        <form action={approveWalletWithdrawalAction} className="flex justify-end">
          <input type="hidden" name="withdrawalId" value={String(request.id)} />
          <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-500">
            Approve
          </Button>
        </form>
        <form action={rejectWalletWithdrawalAction} className="flex gap-2">
          <input type="hidden" name="withdrawalId" value={String(request.id)} />
          <input
            name="message"
            placeholder="Reject reason"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white outline-none transition focus:border-sky-500"
          />
          <Button type="submit" size="sm" variant="outline" className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
            Reject
          </Button>
        </form>
      </div>
    )
  }

  if (request.status === 'approved') {
    return (
      <form action={markWalletWithdrawalPaidAction} className="flex justify-end">
        <input type="hidden" name="withdrawalId" value={String(request.id)} />
        <Button type="submit" size="sm" className="bg-sky-600 hover:bg-sky-500">
          Отметить как оплаченное
        </Button>
      </form>
    )
  }

  return <div className="text-right text-xs text-slate-600">-</div>
}

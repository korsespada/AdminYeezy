import Link from 'next/link'
import {
  approveWalletWithdrawalAction,
  markWalletWithdrawalPaidAction,
  rejectWalletWithdrawalAction,
} from '@/actions/crm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { listRailsCrmWalletWithdrawals, type RailsCrmWalletWithdrawal } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const statuses = [
  { label: 'Все', value: '' },
  { label: 'Requested', value: 'requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Failed', value: 'failed' },
  { label: 'Paid', value: 'paid' },
]

export default async function CrmWalletWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await connection()
  const params = await searchParams
  const status = params.status?.trim() || ''

  try {
    const result = await listRailsCrmWalletWithdrawals({ status })

    return (
      <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">
              CRM
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Выплаты</h1>
            <p className="mt-2 text-sm text-slate-500">
              Wallet withdrawal requests из Rails CRM. Approve/reject/mark paid actions добавим отдельным проходом.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
            {statuses.map((item) => (
              <Button
                key={item.value || 'all'}
                asChild
                size="sm"
                variant={status === item.value ? 'default' : 'ghost'}
                className={status === item.value ? 'bg-sky-600 hover:bg-sky-500' : 'text-slate-300 hover:bg-slate-800'}
              >
                <Link href={item.value ? `/admin/crm/wallet-withdrawals?status=${item.value}` : '/admin/crm/wallet-withdrawals'}>{item.label}</Link>
              </Button>
            ))}
          </div>

          <section className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <div className="text-sm text-slate-400">
                Найдено <span className="font-semibold text-slate-200">{result.totalItems.toLocaleString('ru-RU')}</span>
              </div>
              <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800">Rails read-only</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Клиент</th>
                    <th className="px-5 py-3 text-left font-medium">Статус</th>
                    <th className="px-5 py-3 text-right font-medium">Сумма</th>
                    <th className="px-5 py-3 text-right font-medium">Создан</th>
                    <th className="px-5 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.items.map((request) => (
                    <WithdrawalRow key={request.id} request={request} />
                  ))}
                  {result.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-slate-500">Заявки на вывод не найдены</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки выплат из Rails CRM</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

function WithdrawalRow({ request }: { request: RailsCrmWalletWithdrawal }) {
  return (
    <tr className="hover:bg-slate-800/50">
      <td className="px-5 py-4 font-medium text-white">{request.customer_name || '-'}</td>
      <td className="px-5 py-4">
        <Badge variant="outline" className="border-slate-700 text-slate-300">
          {request.status}
        </Badge>
      </td>
      <td className="px-5 py-4 text-right text-slate-300">{formatMoney(request.amount_cents, request.currency)}</td>
      <td className="px-5 py-4 text-right text-slate-400">{formatDate(request.created_at)}</td>
      <td className="px-5 py-4">
        <WithdrawalActions request={request} />
      </td>
    </tr>
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
          Mark paid
        </Button>
      </form>
    )
  }

  return <div className="text-right text-xs text-slate-600">-</div>
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100)
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

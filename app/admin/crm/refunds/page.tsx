import Link from 'next/link'
import { RefundActions } from '@/components/crm/CrmFinancialActions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { listRailsCrmRefunds, type RailsCrmRefund } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const statuses = [
  { label: 'Все', value: '' },
  { label: 'Requested', value: 'requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Processing', value: 'processing' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Paid', value: 'paid' },
]

export default async function CrmRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>
}) {
  await connection()
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const status = params.status?.trim() || ''

  try {
    const result = await listRailsCrmRefunds({ page, perPage: 30, status })

    return (
      <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <Header title="Возвраты" description="Refund requests из Rails CRM. Approve/reject actions добавим отдельным проходом." />
          <FilterTabs base="/admin/crm/refunds" active={status} items={statuses} />
          <RefundsTable refunds={result.items} totalItems={result.totalItems} />
          <Pagination base="/admin/crm/refunds" page={page} totalPages={result.totalPages} status={status} />
        </div>
      </main>
    )
  } catch (error: any) {
    return <CrmError title="Ошибка загрузки возвратов из Rails CRM" message={error.message} />
  }
}

function Header({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">
        CRM
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  )
}

function FilterTabs({ base, active, items }: { base: string; active: string; items: Array<{ label: string; value: string }> }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      {items.map((item) => (
        <Button
          key={item.value || 'all'}
          asChild
          size="sm"
          variant={active === item.value ? 'default' : 'ghost'}
          className={active === item.value ? 'bg-sky-600 hover:bg-sky-500' : 'text-slate-300 hover:bg-slate-800'}
        >
          <Link href={item.value ? `${base}?status=${item.value}` : base}>{item.label}</Link>
        </Button>
      ))}
    </div>
  )
}

function RefundsTable({ refunds, totalItems }: { refunds: RailsCrmRefund[]; totalItems: number }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div className="text-sm text-slate-400">
          Найдено <span className="font-semibold text-slate-200">{totalItems.toLocaleString('ru-RU')}</span>
        </div>
        <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800">Rails read-only</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Заказ</th>
              <th className="px-5 py-3 text-left font-medium">Статус</th>
              <th className="px-5 py-3 text-left font-medium">Причина</th>
              <th className="px-5 py-3 text-right font-medium">Сумма</th>
              <th className="px-5 py-3 text-right font-medium">Создан</th>
              <th className="px-5 py-3 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {refunds.map((refund) => (
              <tr key={refund.id} className="hover:bg-slate-800/50">
                <td className="px-5 py-4 font-medium text-white">{refund.order_public_number || '-'}</td>
                <td className="px-5 py-4"><Badge variant="outline" className="border-slate-700 text-slate-300">{refund.status}</Badge></td>
                <td className="px-5 py-4 text-slate-400">{refund.reason || refund.target || '-'}</td>
                <td className="px-5 py-4 text-right text-slate-300">{formatMoney(refund.amount_cents, refund.currency)}</td>
                <td className="px-5 py-4 text-right text-slate-400">{formatDate(refund.created_at)}</td>
                <td className="px-5 py-4">
                  <RefundActions refund={refund} />
                </td>
              </tr>
            ))}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-slate-500">Возвраты не найдены</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Pagination({ base, page, totalPages, status }: { base: string; page: number; totalPages: number; status: string }) {
  if (totalPages <= 1) return null
  const url = (nextPage: number) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (nextPage > 1) params.set('page', String(nextPage))
    const query = params.toString()
    return query ? `${base}?${query}` : base
  }
  return (
    <nav className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
      <Link href={url(Math.max(1, page - 1))} className="text-sm text-slate-300 hover:text-sky-300">Назад</Link>
      <div className="text-sm text-slate-500">Страница <span className="text-slate-200">{page}</span> из <span className="text-slate-200">{totalPages}</span></div>
      <Link href={url(Math.min(totalPages, page + 1))} className="text-sm text-slate-300 hover:text-sky-300">Вперед</Link>
    </nav>
  )
}

function CrmError({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
      <AlertTitle className="text-xl font-bold">{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100)
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

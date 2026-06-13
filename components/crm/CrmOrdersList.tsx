import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type RailsCrmOrder } from '@/lib/rails-admin'

interface CrmOrdersListProps {
  orders: RailsCrmOrder[]
  totalItems: number
  totalPages: number
  page: number
  search: string
  queue: string
  status: string
}

const queues = [
  { label: 'Все', value: '' },
  { label: 'Оплаченные', value: 'paid' },
  { label: 'Проблемы', value: 'problem' },
  { label: 'Производство', value: 'production' },
  { label: 'Возвраты', value: 'refund' },
]

const statuses = [
  { label: 'Все статусы', value: '' },
  { label: 'Paid', value: 'paid' },
  { label: 'Awaiting confirmation', value: 'awaiting_confirmation' },
  { label: 'Processing', value: 'processing' },
  { label: 'Production', value: 'production' },
  { label: 'Refund pending', value: 'refund_pending' },
  { label: 'Dispute', value: 'dispute' },
]

const statusLabels: Record<string, string> = {
  paid: 'Оплачен',
  awaiting_confirmation: 'Проверка',
  processing: 'В работе',
  production: 'Производство',
  delivered: 'Доставлен',
  issue_waiting_customer: 'Нужен клиент',
  dispute: 'Спор',
  refund_pending: 'Возврат',
  refunded: 'Возвращен',
  cancelled: 'Отменен',
}

export default function CrmOrdersList({
  orders,
  totalItems,
  totalPages,
  page,
  search,
  queue,
  status,
}: CrmOrdersListProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">
              CRM
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Заказы</h1>
            <p className="mt-2 text-sm text-slate-500">
              Rails-first очередь заказов. Переходы статусов и ручные действия добавим следующим проходом.
            </p>
          </div>

          <form action="/admin/crm/orders" className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <input type="hidden" name="queue" value={queue} />
            <input type="hidden" name="status" value={status} />
            <div className="relative min-w-0 flex-1 lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                name="search"
                defaultValue={search}
                placeholder="Номер, email, телефон, Telegram"
                className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-sky-500"
              />
            </div>
            <Button type="submit" className="bg-sky-600 hover:bg-sky-500">
              Найти
            </Button>
          </form>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap gap-2">
            {queues.map((item) => (
              <Button
                key={item.value || 'all'}
                asChild
                size="sm"
                variant={queue === item.value ? 'default' : 'ghost'}
                className={queue === item.value ? 'bg-sky-600 hover:bg-sky-500' : 'text-slate-300 hover:bg-slate-800'}
              >
                <Link href={buildUrl({ queue: item.value, status, search, page: 1 })}>{item.label}</Link>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {statuses.map((item) => (
              <Button
                key={item.value || 'all-statuses'}
                asChild
                size="sm"
                variant={status === item.value ? 'default' : 'ghost'}
                className={status === item.value ? 'bg-slate-700 hover:bg-slate-600' : 'text-slate-400 hover:bg-slate-800'}
              >
                <Link href={buildUrl({ queue, status: item.value, search, page: 1 })}>{item.label}</Link>
              </Button>
            ))}
          </div>
        </div>

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
                  <th className="px-5 py-3 text-left font-medium">Номер</th>
                  <th className="px-5 py-3 text-left font-medium">Клиент</th>
                  <th className="px-5 py-3 text-left font-medium">Статус</th>
                  <th className="px-5 py-3 text-left font-medium">Позиции</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                  <th className="px-5 py-3 text-right font-medium">Создан</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-800/50">
                    <td className="px-5 py-4 font-medium text-white">
                      <Link href={`/admin/crm/orders/${order.id}`} className="hover:text-sky-300">
                        {order.public_number}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-300">{customerLabel(order)}</td>
                    <td className="px-5 py-4">
                      <Badge variant="outline" className="border-slate-700 text-slate-300">
                        {statusLabels[order.status] || order.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-slate-400">{itemCounts(order.item_counts)}</td>
                    <td className="px-5 py-4 text-right text-slate-300">{formatMoney(order.total_cents, order.currency)}</td>
                    <td className="px-5 py-4 text-right text-slate-400">{formatDate(order.created_at)}</td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                      Заказы не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 && (
          <nav className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
            <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800" disabled={page <= 1}>
              <Link href={buildUrl({ queue, status, search, page: Math.max(1, page - 1) })}>Назад</Link>
            </Button>
            <div className="text-sm text-slate-500">
              Страница <span className="text-slate-200">{page}</span> из <span className="text-slate-200">{totalPages}</span>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800" disabled={page >= totalPages}>
              <Link href={buildUrl({ queue, status, search, page: Math.min(totalPages, page + 1) })}>Вперед</Link>
            </Button>
          </nav>
        )}
      </div>
    </main>
  )
}

function buildUrl({ queue, status, search, page }: { queue: string; status: string; search: string; page: number }) {
  const params = new URLSearchParams()
  if (queue) params.set('queue', queue)
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/crm/orders?${query}` : '/admin/crm/orders'
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function customerLabel(order: RailsCrmOrder) {
  return order.customer?.display_name || order.customer?.telegram_username || order.customer?.email || order.customer?.phone || '-'
}

function itemCounts(counts?: Record<string, number>) {
  if (!counts || Object.keys(counts).length === 0) return '-'
  return Object.entries(counts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
}

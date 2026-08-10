'use client'

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

const statuses = [
  { label: 'Все статусы', value: '' },
  { label: 'Ожидает оплаты', value: 'payment_pending' },
  { label: 'Оплачен', value: 'paid' },
  { label: 'Отправлен', value: 'shipped' },
  { label: 'Доставлен', value: 'delivered' },
  { label: 'Возврат', value: 'refund_pending' },
  { label: 'Отменен', value: 'cancelled' },
]

const statusLabels = Object.fromEntries(statuses.filter((item) => item.value).map((item) => [item.value, item.label]))

export default function CrmOrdersList({ orders, totalItems, totalPages, page, search, status }: CrmOrdersListProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">CRM</Link>
            <h1 className="mt-2 text-3xl font-bold text-white">Заказы</h1>
            <p className="mt-2 text-sm text-slate-500">Здесь только заказы, созданные для оплаты. Заявки без оплаты находятся в сообщениях.</p>
          </div>
          <form action="/admin/crm/orders" className="flex w-full gap-2 lg:w-auto">
            <input type="hidden" name="status" value={status} />
            <div className="relative min-w-0 flex-1 lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input name="search" defaultValue={search} placeholder="Номер, электронная почта, телефон, Telegram" className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-sky-500" />
            </div>
            <Button type="submit" className="bg-sky-600 hover:bg-sky-500">Найти</Button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
          {statuses.map((item) => (
            <Button key={item.value || 'all'} asChild size="sm" variant={status === item.value ? 'default' : 'ghost'} className={status === item.value ? 'bg-sky-600 hover:bg-sky-500' : 'text-slate-300 hover:bg-slate-800'}>
              <Link href={buildUrl({ status: item.value, search, page: 1 })}>{item.label}</Link>
            </Button>
          ))}
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 p-4 text-sm text-slate-400">Найдено <span className="font-semibold text-slate-200">{totalItems.toLocaleString('ru-RU')}</span></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-500"><tr>
                <th className="px-5 py-3 text-left font-medium">Номер заказа</th>
                <th className="px-5 py-3 text-left font-medium">Клиент</th>
                <th className="px-5 py-3 text-left font-medium">Источник</th>
                <th className="px-5 py-3 text-left font-medium">Статус</th>
                <th className="px-5 py-3 text-right font-medium">Сумма</th>
                <th className="px-5 py-3 text-right font-medium">Создан</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800">
                {orders.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-slate-800/50" onClick={() => { window.location.href = `/admin/crm/orders/${order.id}` }}>
                    <td className="px-5 py-4 font-medium text-white"><Link href={`/admin/crm/orders/${order.id}`} className="hover:text-sky-300">{order.public_number}</Link></td>
                    <td className="px-5 py-4 text-slate-300">{customerLabel(order)}</td>
                    <td className="px-5 py-4 text-slate-400">{sourceLabel(order.customer?.registration_source)}</td>
                    <td className="px-5 py-4"><Badge variant="outline" className="border-slate-700 text-slate-300">{statusLabels[order.status] || 'Неизвестно'}</Badge></td>
                    <td className="px-5 py-4 text-right text-slate-300">{formatMoney(order.total_cents, order.currency)}</td>
                    <td className="px-5 py-4 text-right text-slate-400">{formatDate(order.created_at)}</td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">Заказы не найдены</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 && <nav className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800"><Link href={buildUrl({ status, search, page: Math.max(1, page - 1) })}>Назад</Link></Button>
          <div className="text-sm text-slate-500">Страница <span className="text-slate-200">{page}</span> из <span className="text-slate-200">{totalPages}</span></div>
          <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800"><Link href={buildUrl({ status, search, page: Math.min(totalPages, page + 1) })}>Вперед</Link></Button>
        </nav>}
      </div>
    </main>
  )
}

function buildUrl({ status, search, page }: { status: string; search: string; page: number }) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (search) params.set('search', search)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/crm/orders?${query}` : '/admin/crm/orders'
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100)
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function customerLabel(order: RailsCrmOrder) {
  return order.customer?.display_name || order.customer?.telegram_username || order.customer?.email || order.customer?.phone || '-'
}

function sourceLabel(source?: string | null) {
  return source === 'telegram_mini_app' ? 'Telegram Mini App' : source === 'site' ? 'Сайт' : 'Неизвестно'
}

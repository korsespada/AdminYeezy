'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type RailsCrmCustomerSummary } from '@/lib/rails-admin'

interface CrmCustomersListProps {
  customers: RailsCrmCustomerSummary[]
  totalItems: number
  totalPages: number
  page: number
  search: string
  source?: string
}

export default function CrmCustomersList({ customers, totalItems, totalPages, page, search, source = '' }: CrmCustomersListProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">CRM</Link>
            <h1 className="mt-2 text-3xl font-bold text-white">Клиенты</h1>
            <p className="mt-2 text-sm text-slate-500">Контакты, источник регистрации, адреса и история заказов.</p>
          </div>
          <form action="/admin/crm/customers" className="flex w-full flex-wrap gap-2 lg:w-auto lg:flex-nowrap">
            <div className="relative min-w-0 flex-1 lg:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input name="search" defaultValue={search} placeholder="Имя, электронная почта, телефон, Telegram" className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-sky-500" />
            </div>
            <select name="source" defaultValue={source} aria-label="Источник регистрации" className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-500">
              <option value="">Все источники</option>
              <option value="site">Сайт</option>
              <option value="telegram_mini_app">Telegram Mini App</option>
              <option value="unknown">Неизвестно</option>
            </select>
            <Button type="submit" className="bg-sky-600 hover:bg-sky-500">Найти</Button>
          </form>
        </div>
        <section className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 p-4 text-sm text-slate-400">Найдено <span className="font-semibold text-slate-200">{totalItems.toLocaleString('ru-RU')}</span></div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-500"><tr>
                <th className="px-5 py-3 text-left font-medium">Клиент</th>
                <th className="px-5 py-3 text-left font-medium">Источник</th>
                <th className="px-5 py-3 text-left font-medium">Контакты</th>
                <th className="px-5 py-3 text-left font-medium">Telegram</th>
                <th className="px-5 py-3 text-right font-medium">Заказы</th>
                <th className="px-5 py-3 text-right font-medium">Регистрация</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800">
                {customers.map((customer) => (
                  <tr key={customer.id} className="cursor-pointer hover:bg-slate-800/50" onClick={() => { window.location.href = `/admin/crm/customers/${customer.id}` }}>
                    <td className="px-5 py-4"><Link href={`/admin/crm/customers/${customer.id}`} className="font-medium text-white hover:text-sky-300">{customer.display_name || 'Без имени'}</Link><div className="mt-1 text-xs text-slate-500">{customer.country || 'Страна не указана'}</div></td>
                    <td className="px-5 py-4"><Badge variant="outline" className="border-slate-700 text-slate-300">{sourceLabel(customer.registration_source)}</Badge></td>
                    <td className="px-5 py-4 text-slate-300"><div>{customer.email || '-'}</div><div className="mt-1 text-xs text-slate-500">{customer.phone || '-'}</div></td>
                    <td className="px-5 py-4 text-slate-300"><div>{customer.telegram_username ? `@${customer.telegram_username}` : '-'}</div><div className="mt-1 text-xs text-slate-500">{customer.telegram_id || '-'}</div></td>
                    <td className="px-5 py-4 text-right text-slate-300"><div>{customer.order_count.toLocaleString('ru-RU')}</div><div className="mt-1 text-xs text-slate-500">Последний: {formatDate(customer.last_order_at)}</div></td>
                    <td className="px-5 py-4 text-right text-slate-400">{formatDate(customer.created_at)}</td>
                  </tr>
                ))}
                {customers.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">Клиенты не найдены</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        {totalPages > 1 && <nav className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800"><Link href={buildUrl({ search, source, page: Math.max(1, page - 1) })}>Назад</Link></Button>
          <div className="text-sm text-slate-500">Страница <span className="text-slate-200">{page}</span> из <span className="text-slate-200">{totalPages}</span></div>
          <Button asChild variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800"><Link href={buildUrl({ search, source, page: Math.min(totalPages, page + 1) })}>Вперед</Link></Button>
        </nav>}
      </div>
    </main>
  )
}

function sourceLabel(source?: string | null) {
  return source === 'telegram_mini_app' ? 'Telegram Mini App' : source === 'site' ? 'Сайт' : 'Неизвестно'
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value))
}

function buildUrl({ search, source, page }: { search: string; source: string; page: number }) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (source) params.set('source', source)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/crm/customers?${query}` : '/admin/crm/customers'
}

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
}

export default function CrmCustomersList({ customers, totalItems, totalPages, page, search }: CrmCustomersListProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">
              CRM
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Пользователи</h1>
            <p className="mt-2 text-sm text-slate-500">
              Read-only список Rails customers: контакты, Telegram, wallet balance и история заказов.
            </p>
          </div>

          <form action="/admin/crm/customers" className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                name="search"
                defaultValue={search}
                placeholder="Имя, email, телефон, Telegram, referral"
                className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white outline-none transition focus:border-sky-500"
              />
            </div>
            <Button type="submit" className="bg-sky-600 hover:bg-sky-500">
              Найти
            </Button>
          </form>
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
                  <th className="px-5 py-3 text-left font-medium">Клиент</th>
                  <th className="px-5 py-3 text-left font-medium">Контакты</th>
                  <th className="px-5 py-3 text-left font-medium">Telegram</th>
                  <th className="px-5 py-3 text-left font-medium">Страна / канал</th>
                  <th className="px-5 py-3 text-right font-medium">Wallet</th>
                  <th className="px-5 py-3 text-right font-medium">Заказы</th>
                  <th className="px-5 py-3 text-right font-medium">Referral</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-800/50">
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">{customer.display_name || 'Без имени'}</div>
                      <div className="mt-1 text-xs text-slate-500">created {formatDate(customer.created_at)}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      <div>{customer.email || '-'}</div>
                      <div className="mt-1 text-xs text-slate-500">{customer.phone || '-'}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      <div>{customer.telegram_username ? `@${customer.telegram_username}` : '-'}</div>
                      <div className="mt-1 text-xs text-slate-500">{customer.telegram_id || '-'}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">
                      <div>{customer.country || '-'}</div>
                      <div className="mt-1 text-xs text-slate-500">{customer.preferred_contact_channel || '-'}</div>
                    </td>
                    <td className="px-5 py-4 text-right text-slate-300">
                      <div>{formatMoney(customer.wallet_total_cents)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        cash {formatMoney(customer.wallet_cash_cents)} · bonus {formatMoney(customer.wallet_bonus_cents)}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-slate-300">
                      <div>{customer.order_count.toLocaleString('ru-RU')}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(customer.last_order_at)}</div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <code className="rounded bg-slate-950 px-2 py-1 text-xs text-slate-300">{customer.referral_code || '-'}</code>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-500">
                      Пользователи не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 && (
          <nav className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
            <Link href={buildUrl({ search, page: Math.max(1, page - 1) })} className="text-sm text-slate-300 hover:text-sky-300">
              Назад
            </Link>
            <div className="text-sm text-slate-500">
              Страница <span className="text-slate-200">{page}</span> из <span className="text-slate-200">{totalPages}</span>
            </div>
            <Link href={buildUrl({ search, page: Math.min(totalPages, page + 1) })} className="text-sm text-slate-300 hover:text-sky-300">
              Вперед
            </Link>
          </nav>
        )}
      </div>
    </main>
  )
}

function buildUrl({ search, page }: { search: string; page: number }) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/crm/customers?${query}` : '/admin/crm/customers'
}

function formatMoney(value?: number | null) {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value / 100)
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value))
}

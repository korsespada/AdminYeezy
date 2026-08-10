'use client'

import Link from 'next/link'
import { ArrowRight, BellRing, ClipboardList, MessagesSquare, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type RailsCrmOrder } from '@/lib/rails-admin'

interface CrmDashboardProps {
  railsConfigured: boolean
  recentOrders: RailsCrmOrder[]
  counts: {
    orders?: number | null
    customers?: number | null
    notifications?: number | null
    [key: string]: number | null | undefined
  }
  errors?: string[]
}

const workspaces = [
  {
    title: 'Заказы',
    description: 'Заказы с оплатой, статусы, товары и данные доставки.',
    href: '/admin/crm/orders',
    icon: ClipboardList,
    tone: 'text-sky-300',
    countKey: 'orders',
    countLabel: 'заказов',
  },
  {
    title: 'Клиенты',
    description: 'Контакты, источник регистрации, адреса и история заказов.',
    href: '/admin/crm/customers',
    icon: Users,
    tone: 'text-cyan-300',
    countKey: 'customers',
    countLabel: 'клиентов',
  },
  {
    title: 'Telegram-сообщения',
    description: 'Сообщения клиентам бота, медиа, кнопки и история отправок.',
    href: '/admin/crm/telegram',
    icon: MessagesSquare,
    tone: 'text-emerald-300',
    countKey: null,
    countLabel: '',
  },
  {
    title: 'Настройки CRM',
    description: 'Telegram-получатели уведомлений о новых клиентах и заказах.',
    href: '/admin/crm/settings',
    icon: BellRing,
    tone: 'text-violet-300',
    countKey: 'notifications',
    countLabel: 'получателей',
  },
] as const

const statusLabels: Record<string, string> = {
  payment_pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  refund_pending: 'Возврат',
  cancelled: 'Отменен',
}

export default function CrmDashboard({ railsConfigured, recentOrders, counts, errors = [] }: CrmDashboardProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/10">CRM</Badge>
            <h1 className="mt-4 text-4xl font-bold tracking-normal text-white sm:text-5xl">CRM</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">
              Заказы, клиенты и коммуникация с операторами в одном разделе.
            </p>
          </div>

          <Card className="border-slate-800 bg-slate-900 text-slate-100">
            <CardHeader>
              <CardTitle className="text-base">Состояние CRM</CardTitle>
              <CardDescription className="text-slate-400">Подключение к Rails API.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="text-sm font-medium text-slate-300">API CRM</span>
                <Badge className={railsConfigured ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15' : 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/15'}>
                  {railsConfigured ? 'Подключен' : 'Не настроен'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        {errors.length > 0 && (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="font-semibold">Часть данных CRM не загрузилась</div>
            <div className="mt-1 text-amber-200/80">{errors[0]}</div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workspaces.map((workspace) => {
            const Icon = workspace.icon
            const value = workspace.countKey ? counts[workspace.countKey] : null
            return (
              <Link
                key={workspace.title}
                href={workspace.href}
                aria-label={`Открыть раздел CRM: ${workspace.title}`}
                className="group rounded-lg border border-slate-800 bg-slate-900 p-5 transition hover:border-sky-500/60 hover:bg-slate-800"
              >
                <div className="flex min-h-[172px] flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 ${workspace.tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 group-hover:text-sky-300">
                      Открыть
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-white">{workspace.title}</h2>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-400">{workspace.description}</p>
                  {workspace.countLabel && <div className="mt-4 text-sm text-slate-500"><span className="font-semibold text-slate-200">{formatMetric(value)}</span> {workspace.countLabel}</div>}
                </div>
              </Link>
            )
          })}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Последние заказы</h2>
              <p className="mt-1 text-sm text-slate-500">Быстрый переход к карточке заказа.</p>
            </div>
            <Link href="/admin/crm/orders" className="text-sm font-medium text-sky-300 hover:text-sky-200">Все заказы</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                <tr><th className="px-5 py-3 text-left font-medium">Номер</th><th className="px-5 py-3 text-left font-medium">Клиент</th><th className="px-5 py-3 text-left font-medium">Статус</th><th className="px-5 py-3 text-right font-medium">Сумма</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentOrders.map((order) => (
                  <tr key={order.id} className="cursor-pointer hover:bg-slate-800/50" onClick={() => { window.location.href = `/admin/crm/orders/${order.id}` }}>
                    <td className="px-5 py-4 font-medium text-white"><Link href={`/admin/crm/orders/${order.id}`} className="hover:text-sky-300">{order.public_number}</Link></td>
                    <td className="px-5 py-4 text-slate-300">{customerLabel(order)}</td>
                    <td className="px-5 py-4"><Badge variant="outline" className="border-slate-700 text-slate-300">{statusLabels[order.status] || 'Неизвестно'}</Badge></td>
                    <td className="px-5 py-4 text-right text-slate-300">{formatMoney(order.total_cents, order.currency)}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-500">Заказы не загружены</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function formatMetric(value?: number | null) {
  return typeof value === 'number' ? value.toLocaleString('ru-RU') : '-'
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100)
}

function customerLabel(order: RailsCrmOrder) {
  return order.customer?.display_name || order.customer?.telegram_username || order.customer?.email || order.customer?.phone || '-'
}

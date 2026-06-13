import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  CreditCard,
  PackageCheck,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type RailsCrmOrder } from '@/lib/rails-admin'

interface CrmDashboardProps {
  railsConfigured: boolean
  recentOrders: RailsCrmOrder[]
  counts: {
    paid?: number | null
    problem?: number | null
    production?: number | null
    refundQueue?: number | null
    pendingRefunds?: number | null
    pendingWithdrawals?: number | null
    customers?: number | null
  }
  errors?: string[]
}

const workspaces = [
  {
    title: 'Заказы',
    description: 'Единая очередь заказов, поиск по номеру, клиенту, email или телефону.',
    href: '/admin/crm/orders',
    icon: ClipboardList,
    tone: 'text-sky-300',
    countKey: 'paid',
    countLabel: 'в платной очереди',
  },
  {
    title: 'Проблемы',
    description: 'Нет наличия, замены, споры и позиции, где нужен оператор.',
    href: '/admin/crm/orders?queue=problem',
    icon: AlertTriangle,
    tone: 'text-amber-300',
    countKey: 'problem',
    countLabel: 'требуют внимания',
  },
  {
    title: 'Производство',
    description: 'Позиции в production workflow: запуск, готовность и контроль сроков.',
    href: '/admin/crm/orders?queue=production',
    icon: PackageCheck,
    tone: 'text-emerald-300',
    countKey: 'production',
    countLabel: 'в производстве',
  },
  {
    title: 'Возвраты',
    description: 'Refund requests, approve/reject workflow и связь с заказом.',
    href: '/admin/crm/refunds',
    icon: RefreshCw,
    tone: 'text-rose-300',
    countKey: 'pendingRefunds',
    countLabel: 'ожидают решения',
  },
  {
    title: 'Выплаты',
    description: 'Wallet withdrawal requests: approve, reject, mark paid через Rails API.',
    href: '/admin/crm/wallet-withdrawals',
    icon: Wallet,
    tone: 'text-indigo-300',
    countKey: 'pendingWithdrawals',
    countLabel: 'заявок на вывод',
  },
  {
    title: 'Клиенты',
    description: 'Контакты, Telegram, wallet balance, referral code и история заказов.',
    href: '/admin/crm/customers',
    icon: Users,
    tone: 'text-cyan-300',
    countKey: 'customers',
    countLabel: 'пользователей',
  },
] as const

const statusLabels: Record<string, string> = {
  draft: 'Черновик',
  pending_payment: 'Ожидает оплаты',
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

export default function CrmDashboard({ railsConfigured, recentOrders, counts, errors = [] }: CrmDashboardProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/10">
              Rails CRM
            </Badge>
            <h1 className="mt-4 text-4xl font-bold tracking-normal text-white sm:text-5xl">
              CRM
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">
              Операционный раздел для заказов, item-level статусов, запросов поставщикам, замен, возвратов,
              выплат и клиентской коммуникации. Все действия должны идти через Rails admin API.
            </p>
          </div>

          <Card className="border-slate-800 bg-slate-900 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4 text-sky-300" />
                CRM контур
              </CardTitle>
              <CardDescription className="text-slate-400">
                Быстрый статус Rails API и очередей.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="text-sm font-medium text-slate-300">Rails admin API</span>
                <Badge className={railsConfigured ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15' : 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/15'}>
                  {railsConfigured ? 'Подключен' : 'Нужен RAILS_API_URL'}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Metric label="Проблем" value={counts.problem} />
                <Metric label="Возвратов" value={counts.pendingRefunds} />
              </div>
            </CardContent>
          </Card>
        </section>

        {errors.length > 0 && (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="font-semibold">Часть CRM данных не загрузилась</div>
            <div className="mt-1 text-amber-200/80">{errors[0]}</div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => {
            const Icon = workspace.icon
            const value = workspace.countKey ? counts[workspace.countKey] : null
            return (
              <Link
                key={workspace.title}
                href={workspace.href}
                aria-label={`Открыть CRM раздел: ${workspace.title}`}
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
                  <div className="mt-4 text-sm text-slate-500">
                    <span className="font-semibold text-slate-200">{formatMetric(value)}</span> {workspace.countLabel}
                  </div>
                </div>
              </Link>
            )
          })}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Последние заказы</h2>
              <p className="mt-1 text-sm text-slate-500">Быстрый вход в CRM-очередь из Rails.</p>
            </div>
            <Link href="/admin/crm/orders" className="text-sm font-medium text-sky-300 hover:text-sky-200">
              Все заказы
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Номер</th>
                  <th className="px-5 py-3 text-left font-medium">Клиент</th>
                  <th className="px-5 py-3 text-left font-medium">Статус</th>
                  <th className="px-5 py-3 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentOrders.map((order) => (
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
                    <td className="px-5 py-4 text-right text-slate-300">{formatMoney(order.total_cents, order.currency)}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                      Заказы не загружены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="text-lg font-bold text-white">{formatMetric(value)}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  )
}

function formatMetric(value?: number | null) {
  return typeof value === 'number' ? value.toLocaleString('ru-RU') : '-'
}

function formatMoney(value?: number, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function customerLabel(order: RailsCrmOrder) {
  return order.customer?.display_name || order.customer?.telegram_username || order.customer?.email || order.customer?.phone || '-'
}

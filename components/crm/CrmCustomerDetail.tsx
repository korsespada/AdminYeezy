import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { type RailsCrmCustomerDetail } from '@/lib/rails-admin'

export default function CrmCustomerDetail({ customer }: { customer: RailsCrmCustomerDetail }) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link href="/admin/crm/customers" className="inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200"><ArrowLeft className="h-4 w-4" />Клиенты</Link>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Клиент</p><h1 className="mt-2 text-3xl font-bold text-white">{customer.display_name || 'Без имени'}</h1></div>
            <Badge variant="outline" className="border-slate-700 text-slate-300">{sourceLabel(customer.registration_source)}</Badge>
          </div>
          <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <Info label="Электронная почта" value={customer.email} /><Info label="Телефон" value={customer.phone} /><Info label="Telegram" value={customer.telegram_username ? `@${customer.telegram_username}` : customer.telegram_id} /><Info label="Канал связи" value={channelLabel(customer.preferred_contact_channel)} /><Info label="Страна" value={customer.country} /><Info label="Дата регистрации" value={formatDate(customer.created_at)} />
          </div>
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6"><h2 className="text-xl font-semibold text-white">Адреса</h2>{customer.addresses?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{customer.addresses.map((address) => <div key={address.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm"><div className="font-medium text-slate-200">{address.recipient_name || 'Получатель не указан'}{address.is_default ? ' · Основной' : ''}</div><div className="mt-2 text-slate-400">{address.address_line || [address.city, address.street, address.house, address.apartment].filter(Boolean).join(', ') || 'Адрес не заполнен'}</div><div className="mt-1 text-slate-500">{address.phone || ''}</div></div>)}</div> : <p className="mt-3 text-sm text-slate-500">Адреса не заполнены</p>}</section>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-6"><h2 className="text-xl font-semibold text-white">Заказы</h2>{customer.orders?.length ? <div className="mt-4 divide-y divide-slate-800">{customer.orders.map((order) => <Link key={order.id} href={`/admin/crm/orders/${order.id}`} className="flex items-center justify-between gap-4 py-3 hover:text-sky-300"><span>{order.public_number}</span><span className="text-sm text-slate-400">{statusLabel(order.status)} · {formatMoney(order.total_cents, order.currency)}</span></Link>)}</div> : <p className="mt-3 text-sm text-slate-500">Заказов нет</p>}</section>
      </div>
    </main>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) { return <div><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-slate-200">{value || '—'}</div></div> }
function sourceLabel(source?: string | null) { return source === 'telegram_mini_app' ? 'Telegram Mini App' : 'Сайт' }
function channelLabel(channel?: string) { return ({ telegram: 'Telegram', email: 'Электронная почта', whatsapp: 'WhatsApp' } as Record<string, string>)[channel || ''] || 'Неизвестно' }
function statusLabel(status: string) { return ({ payment_pending: 'Ожидает оплаты', paid: 'Оплачен', shipped: 'Отправлен', delivered: 'Доставлен', refund_pending: 'Возврат', cancelled: 'Отменен' } as Record<string, string>)[status] || 'Неизвестно' }
function formatMoney(value?: number, currency = 'RUB') { return typeof value === 'number' ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100) : '—' }
function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }

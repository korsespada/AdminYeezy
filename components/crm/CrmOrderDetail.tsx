import Link from 'next/link'
import { ArrowLeft, Clock, CreditCard, PackageCheck, Send, User, Wallet } from 'lucide-react'
import {
  createReplacementOfferAction,
  createSupplierRequestAction,
  recordSupplierResponseAction,
  transitionOrderAction,
  transitionOrderItemAction,
} from '@/actions/crm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type RailsCrmOrderDetail,
  type RailsCrmOrderItem,
  type RailsCrmReplacementProductOption,
  type RailsCrmSupplierRequest,
} from '@/lib/rails-admin'

interface CrmOrderDetailProps {
  order: RailsCrmOrderDetail
  replacementSearch?: string
  replacementItem?: string
  replacementProducts?: RailsCrmReplacementProductOption[]
}

const orderStatuses = [
  'payment_pending',
  'paid',
  'awaiting_confirmation',
  'processing',
  'production',
  'to_office',
  'quality_check',
  'ready_for_dispatch',
  'shipped',
  'delivered',
  'issue_waiting_customer',
  'refund_pending',
  'refunded',
  'cancelled',
  'dispute',
]

const itemStatuses = [
  'paid_pending_check',
  'supplier_requested',
  'supplier_has',
  'supplier_no_stock',
  'replacement_needed',
  'waiting_restock',
  'purchase_pending',
  'purchased',
  'production_pending',
  'in_production',
  'production_done',
  'domestic_shipping',
  'received',
  'qc_failed',
  'ready_for_dispatch',
  'shipped',
  'delivered',
  'refunded',
  'cancelled',
]

const statusLabels: Record<string, string> = {
  payment_pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  awaiting_confirmation: 'Проверка',
  processing: 'В работе',
  production: 'Производство',
  to_office: 'До офиса',
  quality_check: 'QC',
  ready_for_dispatch: 'Готов к отправке',
  shipped: 'Отправлен',
  delivered: 'Доставлен',
  issue_waiting_customer: 'Нужен клиент',
  refund_pending: 'Возврат',
  refunded: 'Возвращен',
  cancelled: 'Отменен',
  dispute: 'Спор',
  paid_pending_check: 'Проверить наличие',
  supplier_requested: 'Запрос поставщику',
  supplier_has: 'Есть у поставщика',
  supplier_no_stock: 'Нет наличия',
  replacement_needed: 'Нужна замена',
  waiting_restock: 'Ждем ресток',
  purchase_pending: 'Закупить',
  purchased: 'Закуплен',
  production_pending: 'Ждет производства',
  in_production: 'В производстве',
  production_done: 'Производство готово',
  domestic_shipping: 'Едет по Китаю',
  received: 'Получен',
  qc_failed: 'QC failed',
}

export default function CrmOrderDetail({
  order,
  replacementSearch = '',
  replacementItem = '',
  replacementProducts = [],
}: CrmOrderDetailProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link href="/admin/crm/orders" className="inline-flex items-center gap-2 text-sm font-medium text-sky-300 hover:text-sky-200">
              <ArrowLeft className="h-4 w-4" />
              Заказы
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-normal text-white">{order.public_number}</h1>
              <Badge className="bg-sky-500/15 text-sky-200 hover:bg-sky-500/15">
                {label(order.status)}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              {order.public_message || order.next_step || 'Rails CRM order detail'}
            </p>
          </div>

          <Card className="w-full border-slate-800 bg-slate-900 text-slate-100 lg:w-[420px]">
            <CardHeader>
              <CardTitle className="text-base">Статус заказа</CardTitle>
              <CardDescription className="text-slate-500">
                Transition выполняется через Rails `/api/v1/admin/orders/:id/transitions`.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={transitionOrderAction} className="space-y-3">
                <input type="hidden" name="orderId" value={String(order.id)} />
                <NativeSelect name="toStatus" defaultValue={order.status} options={orderStatuses} />
                <textarea
                  name="message"
                  placeholder="Комментарий для timeline"
                  className="min-h-20 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
                />
                <Button type="submit" className="w-full bg-sky-600 hover:bg-sky-500">
                  Обновить статус
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric icon={CreditCard} label="Итого" value={formatMoney(order.total_cents, order.currency)} />
          <Metric icon={Wallet} label="Wallet" value={formatMoney(order.wallet_spent_cents, order.currency)} />
          <Metric icon={PackageCheck} label="Позиций" value={String(order.items?.length || 0)} />
          <Metric icon={Clock} label="Создан" value={formatDate(order.created_at)} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {(order.items || []).map((item) => (
              <OrderItemCard
                key={item.id}
                order={order}
                item={item}
                replacementSearch={replacementSearch}
                replacementItem={replacementItem}
                replacementProducts={replacementProducts}
              />
            ))}
          </div>

          <aside className="space-y-4">
            <CustomerCard order={order} />
            <MoneyCard order={order} />
            <TimelineCard order={order} />
          </aside>
        </section>
      </div>
    </main>
  )
}

function OrderItemCard({
  order,
  item,
  replacementSearch,
  replacementItem,
  replacementProducts,
}: {
  order: RailsCrmOrderDetail
  item: RailsCrmOrderItem
  replacementSearch: string
  replacementItem: string
  replacementProducts: RailsCrmReplacementProductOption[]
}) {
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base text-white">{item.title}</CardTitle>
            <CardDescription className="mt-1 text-slate-500">
              {item.public_number} · {item.size || 'без размера'} · {item.sku || 'без SKU'}
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit border-slate-700 text-slate-300">
            {label(item.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <SmallFact label="Mode" value={item.fulfillment_mode} />
          <SmallFact label="Qty" value={String(item.quantity)} />
          <SmallFact label="Unit" value={formatMoney(item.unit_price_cents, order.currency)} />
          <SmallFact label="Total" value={formatMoney(item.total_price_cents, order.currency)} />
        </div>

        <form action={transitionOrderItemAction} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-4 lg:grid-cols-[220px_minmax(0,1fr)_160px]">
          <input type="hidden" name="orderId" value={String(order.id)} />
          <input type="hidden" name="itemId" value={String(item.id)} />
          <NativeSelect name="toStatus" defaultValue={item.status} options={itemStatuses} />
          <input
            name="message"
            placeholder="Комментарий к позиции"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
          />
          <Button type="submit" className="bg-slate-700 hover:bg-slate-600">
            Обновить item
          </Button>
        </form>

        <div className="grid gap-4 xl:grid-cols-2">
          <SupplierRequests order={order} item={item} />
          <ReplacementOffers
            order={order}
            item={item}
            replacementSearch={replacementSearch}
            replacementItem={replacementItem}
            replacementProducts={replacementProducts}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function SupplierRequests({ order, item }: { order: RailsCrmOrderDetail; item: RailsCrmOrderItem }) {
  const requests = item.supplier_requests || []
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Supplier requests</h3>
        {item.supplier && (
          <Badge variant="outline" className="border-slate-700 text-slate-400">
            {item.supplier.wechat_name || item.supplier.name}
          </Badge>
        )}
      </div>

      <form action={createSupplierRequestAction} className="mt-4 space-y-3">
        <input type="hidden" name="orderId" value={String(order.id)} />
        <input type="hidden" name="itemId" value={String(item.id)} />
        <input type="hidden" name="supplierId" value={item.supplier?.id ? String(item.supplier.id) : ''} />
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <NativeSelect name="requestType" defaultValue="availability" options={['availability', 'price_check', 'production_eta']} />
          <input
            name="slaHours"
            defaultValue="6"
            inputMode="numeric"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
          />
        </div>
        <textarea
          name="messageText"
          placeholder="Сообщение поставщику, если нужно переопределить auto copy"
          className="min-h-16 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
        />
        <Button type="submit" size="sm" className="w-full bg-sky-600 hover:bg-sky-500">
          <Send className="mr-2 h-4 w-4" />
          Создать запрос
        </Button>
      </form>

      <div className="mt-4 space-y-3">
        {requests.map((request) => (
          <SupplierRequestCard key={request.id} order={order} request={request} />
        ))}
        {requests.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-800 p-3 text-sm text-slate-500">
            Запросов поставщику пока нет.
          </p>
        )}
      </div>
    </div>
  )
}

function SupplierRequestCard({ order, request }: { order: RailsCrmOrderDetail; request: RailsCrmSupplierRequest }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-200">{request.supplier_name || 'Supplier'}</div>
          <div className="mt-1 text-xs text-slate-500">
            {request.request_type || 'availability'} · {formatDate(request.sent_at)}
          </div>
        </div>
        <Badge className={request.overdue ? 'bg-red-500/15 text-red-200 hover:bg-red-500/15' : 'bg-slate-800 text-slate-300 hover:bg-slate-800'}>
          {request.status}
        </Badge>
      </div>
      {request.message_text && <pre className="mt-3 whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-400">{request.message_text}</pre>}

      <form action={recordSupplierResponseAction} className="mt-3 grid gap-2">
        <input type="hidden" name="orderId" value={String(order.id)} />
        <input type="hidden" name="requestId" value={String(request.id)} />
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <NativeSelect name="responseType" defaultValue="has" options={['has', 'no_stock', 'price_changed', 'eta_changed']} />
          <input
            name="priceRub"
            placeholder="₽"
            inputMode="decimal"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
          />
        </div>
        <input
          name="messageText"
          placeholder="Ответ поставщика"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
        />
        <Button type="submit" size="sm" variant="outline" className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
          Записать ответ
        </Button>
      </form>

      {(request.responses || []).length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          {(request.responses || []).map((response) => (
            <div key={response.id} className="text-xs text-slate-500">
              <span className="font-semibold text-slate-300">{response.response_type}</span>
              {response.message_text ? ` · ${response.message_text}` : ''}
              {typeof response.price_cents === 'number' ? ` · ${formatMoney(response.price_cents)}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReplacementOffers({
  order,
  item,
  replacementSearch,
  replacementItem,
  replacementProducts,
}: {
  order: RailsCrmOrderDetail
  item: RailsCrmOrderItem
  replacementSearch: string
  replacementItem: string
  replacementProducts: RailsCrmReplacementProductOption[]
}) {
  const offers = item.replacement_offers || []
  const isActiveSearch = replacementItem === String(item.id)
  const products = isActiveSearch ? replacementProducts : []
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <h3 className="text-sm font-semibold text-white">Replacement offers</h3>

      <form action={`/admin/crm/orders/${order.id}`} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
        <input type="hidden" name="replacementItem" value={String(item.id)} />
        <input
          name="replacementSearch"
          defaultValue={isActiveSearch ? replacementSearch : ''}
          placeholder="Название, SKU или slug"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
        />
        <Button type="submit" size="sm" className="bg-slate-700 hover:bg-slate-600">
          Найти
        </Button>
      </form>

      {isActiveSearch && replacementSearch && (
        <div className="mt-4 space-y-3">
          {products.map((product) => (
            <ReplacementProductResult key={product.id} order={order} item={item} product={product} />
          ))}
          {products.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-800 p-3 text-sm text-slate-500">
              По запросу "{replacementSearch}" ничего не найдено.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {offers.map((offer) => (
          <div key={offer.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-200">{offer.replacement_product?.name || `Offer #${offer.id}`}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {offer.replacement_variant?.size || 'без варианта'} · {formatMoney(offer.replacement_product?.price_cents)}
                </div>
              </div>
              <Badge variant="outline" className="border-slate-700 text-slate-300">{offer.status}</Badge>
            </div>
            {offer.message && <p className="mt-3 text-sm text-slate-400">{offer.message}</p>}
          </div>
        ))}
        {offers.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-800 p-3 text-sm text-slate-500">
            Replacement offers пока нет.
          </p>
        )}
      </div>
    </div>
  )
}

function ReplacementProductResult({
  order,
  item,
  product,
}: {
  order: RailsCrmOrderDetail
  item: RailsCrmOrderItem
  product: RailsCrmReplacementProductOption
}) {
  const variants = product.variants || []
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-200">{product.name}</div>
          <div className="mt-1 text-xs text-slate-500">
            {product.brand?.name || 'без бренда'} · {product.sku || product.slug || product.id}
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-slate-200">
          {formatMoney(product.price_cents, product.currency)}
        </div>
      </div>

      <form action={createReplacementOfferAction} className="mt-3 space-y-2">
        <input type="hidden" name="orderId" value={String(order.id)} />
        <input type="hidden" name="itemId" value={String(item.id)} />
        <input type="hidden" name="replacementProductId" value={String(product.id)} />
        {variants.length > 0 && (
          <select
            name="replacementVariantId"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
            defaultValue=""
          >
            <option value="">Без варианта</option>
            {variants.map((variant) => (
              <option key={variant.id} value={String(variant.id)}>
                {[variant.size, variant.color, variant.sku].filter(Boolean).join(' · ') || `Variant ${variant.id}`}
                {typeof variant.price_cents === 'number' ? ` · ${formatMoney(variant.price_cents, product.currency)}` : ''}
              </option>
            ))}
          </select>
        )}
        <textarea
          name="message"
          placeholder="Сообщение клиенту"
          className="min-h-16 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
        />
        <Button type="submit" size="sm" className="w-full bg-violet-600 hover:bg-violet-500">
          Предложить эту замену
        </Button>
      </form>
    </div>
  )
}

function CustomerCard({ order }: { order: RailsCrmOrderDetail }) {
  const customer = order.customer
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4 text-sky-300" />
          Клиент
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-400">
        <Info label="Имя" value={customer?.display_name} />
        <Info label="Email" value={customer?.email} />
        <Info label="Телефон" value={customer?.phone} />
        <Info label="Telegram" value={customer?.telegram_username} />
        <Info label="Канал" value={customer?.preferred_contact_channel} />
        {order.customer_comment && <Info label="Комментарий" value={order.customer_comment} />}
      </CardContent>
    </Card>
  )
}

function MoneyCard({ order }: { order: RailsCrmOrderDetail }) {
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="text-base">Платежи и возвраты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          {(order.payments || []).map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              <div>
                <div className="text-slate-200">{payment.provider || 'payment'}</div>
                <div className="text-xs text-slate-500">{payment.status}</div>
              </div>
              <div className="text-slate-300">{formatMoney(payment.amount_cents, payment.currency)}</div>
            </div>
          ))}
          {(order.payments || []).length === 0 && <div className="text-slate-500">Платежей нет</div>}
        </div>
        <div className="space-y-2 border-t border-slate-800 pt-4">
          {(order.refunds || []).map((refund) => (
            <div key={refund.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
              <div>
                <div className="text-slate-200">{refund.reason || refund.target || 'refund'}</div>
                <div className="text-xs text-slate-500">{refund.status}</div>
              </div>
              <div className="text-slate-300">{formatMoney(refund.amount_cents, refund.currency)}</div>
            </div>
          ))}
          {(order.refunds || []).length === 0 && <div className="text-slate-500">Возвратов нет</div>}
        </div>
      </CardContent>
    </Card>
  )
}

function TimelineCard({ order }: { order: RailsCrmOrderDetail }) {
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(order.timeline || []).slice().reverse().slice(0, 12).map((event) => (
          <div key={event.id} className="border-l border-slate-700 pl-3">
            <div className="text-sm font-medium text-slate-200">{event.event_type}</div>
            <div className="mt-1 text-xs text-slate-500">
              {event.from_status || '-'} → {event.to_status || '-'} · {formatDate(event.created_at)}
            </div>
            {event.message && <div className="mt-1 text-sm text-slate-400">{event.message}</div>}
          </div>
        ))}
        {(order.timeline || []).length === 0 && <div className="text-sm text-slate-500">Timeline пустой</div>}
      </CardContent>
    </Card>
  )
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
        <Icon className="h-4 w-4 text-sky-300" />
        {label}
      </div>
      <div className="mt-3 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function SmallFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-200">{value || '-'}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value || '-'}</span>
    </div>
  )
}

function NativeSelect({ name, defaultValue, options }: { name: string; defaultValue: string; options: string[] }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500"
    >
      {options.map((status) => (
        <option key={status} value={status}>
          {label(status)}
        </option>
      ))}
    </select>
  )
}

function label(status?: string) {
  if (!status) return '-'
  return statusLabels[status] || status
}

function formatMoney(value?: number | null, currency = 'RUB') {
  if (typeof value !== 'number') return '-'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100)
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

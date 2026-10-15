'use client'

import { useActionState, type ReactNode } from 'react'
import { RefreshCw, Truck } from 'lucide-react'
import { createOrderShipmentAction, refreshOrderShipmentAction, type ShipmentActionState } from '@/actions/crm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type RailsCrmOrderDetail, type RailsCrmShipment } from '@/lib/rails-admin'

const shipmentStatusLabels: Record<RailsCrmShipment['status'], string> = {
  created: 'Передан, движения нет',
  in_transit: 'В пути',
  delivered: 'Вручён',
}

const inputClassName = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-500'

export default function CrmOrderShipment({ order }: { order: RailsCrmOrderDetail }) {
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4 text-sky-300" />Доставка STD-Express</CardTitle>
        {!order.shipment && <CardDescription className="text-slate-500">Адрес, получатель и телефон берутся из оформления заказа. Клиент получит трек в ЛК и в Telegram-боте.</CardDescription>}
      </CardHeader>
      <CardContent>
        {order.shipment
          ? <ShipmentTracking orderId={String(order.id)} shipment={order.shipment} />
          : order.status === 'paid'
            ? <ShipmentForm order={order} />
            : <p className="text-sm text-slate-500">Передать в доставку можно после оплаты заказа.</p>}
      </CardContent>
    </Card>
  )
}

function ShipmentForm({ order }: { order: RailsCrmOrderDetail }) {
  const [state, formAction, pending] = useActionState<ShipmentActionState | null, FormData>(createOrderShipmentAction, null)
  const city = order.checkout?.city

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={String(order.id)} />
      <Field label="Регион" hint={`Пусто — регион из адреса клиента или город${city ? ` «${city}»` : ''}`}>
        <input name="province" placeholder={city || 'Москва'} className={inputClassName} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Вес, кг"><input name="weight" inputMode="decimal" placeholder="0" className={inputClassName} /></Field>
        <Field label="Длина, см"><input name="length" inputMode="decimal" placeholder="0" className={inputClassName} /></Field>
        <Field label="Ширина, см"><input name="width" inputMode="decimal" placeholder="0" className={inputClassName} /></Field>
        <Field label="Высота, см"><input name="height" inputMode="decimal" placeholder="0" className={inputClassName} /></Field>
      </div>
      <Field label="Название товара" hint="Пусто — товары заказа с размером и количеством">
        <input name="goodsName" maxLength={100} className={inputClassName} />
      </Field>
      <Field label="Объявленная стоимость, ₽" hint="Пусто — итог заказа">
        <input name="goodsPrice" inputMode="numeric" placeholder={typeof order.total_cents === 'number' ? String(Math.round(order.total_cents / 100)) : ''} className={inputClassName} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="fast" defaultChecked={order.checkout?.delivery_method === 'express_moscow'} className="h-4 w-4 accent-sky-500" />
        Быстрая доставка (fast)
      </label>
      <ActionMessage state={state} />
      <Button type="submit" disabled={pending} className="w-full bg-sky-600 hover:bg-sky-500">
        {pending ? 'Передаём…' : 'Передать в STD-Express'}
      </Button>
    </form>
  )
}

function ShipmentTracking({ orderId, shipment }: { orderId: string; shipment: RailsCrmShipment }) {
  const [state, formAction, pending] = useActionState<ShipmentActionState | null, FormData>(refreshOrderShipmentAction, null)
  const events = [...(shipment.events || [])].reverse()
  const payload = shipment.request_payload || {}

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Статус</span>
          <Badge className="bg-sky-500/15 text-sky-200 hover:bg-sky-500/15">{shipmentStatusLabels[shipment.status] || shipment.status}</Badge>
        </div>
        <Info label="Трек-номер" value={shipment.tracking_number} mono />
        <Info label="Номер заказа в STD" value={shipment.local_order_number} mono />
        <Info label="Режим" value={shipment.fast ? 'Быстрая (fast)' : 'Обычная'} />
        <Info label="Передан" value={formatDate(shipment.created_at)} />
        <Info label="Трекинг обновлён" value={shipment.tracked_at ? formatDate(shipment.tracked_at) : 'Ещё не запрашивался'} />
      </div>

      {shipment.tracking_error && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 p-3 text-amber-200">{shipment.tracking_error}</div>
      )}

      <div className="space-y-3">
        {events.map((event, index) => (
          <div key={`${event.time}-${event.text}`} className={index === 0 ? 'border-l-2 border-sky-400 pl-3' : 'border-l border-slate-700 pl-3'}>
            <div className="font-medium text-slate-200">{event.text || '—'}</div>
            <div className="mt-1 text-xs text-slate-500">{event.time || '—'}</div>
          </div>
        ))}
        {!events.length && <p className="text-slate-500">STD ещё не прислал движение посылки. Трекинг опрашивается автоматически каждые 2 часа.</p>}
      </div>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <ActionMessage state={state} />
        <Button type="submit" variant="outline" disabled={pending} className="w-full border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
          <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {pending ? 'Запрашиваем…' : 'Обновить трекинг'}
        </Button>
      </form>

      {Object.keys(payload).length > 0 && (
        <details className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer text-slate-400">Что отправлено в STD</summary>
          <div className="mt-3 space-y-1">
            {Object.entries(payload).filter(([key]) => key !== 'adress').map(([key, value]) => <Info key={key} label={key} value={String(value)} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function ActionMessage({ state }: { state: ShipmentActionState | null }) {
  if (!state) return null
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-300' : 'rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-300'}>
      {state.message}
    </p>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-600">{hint}</span>}
    </label>
  )
}

function Info({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 max-w-[65%] break-words text-right text-slate-200${mono ? ' font-mono' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(value)) : '—'
}

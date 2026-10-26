'use client'

import { startTransition, useActionState, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { deleteShipmentAction, refreshShipmentAction, saveShipmentAction, type ShipmentActionState } from '@/actions/crm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type RailsCrmShipment, type RailsCrmTracking } from '@/lib/rails-admin'

const shipmentStatusLabels: Record<RailsCrmShipment['status'], string> = {
  created: 'Движения нет',
  in_transit: 'В пути',
  delivered: 'Вручена',
}

const stageLabels: Record<NonNullable<RailsCrmTracking['stage']>, string> = {
  created: 'Создана',
  shipped: 'Едет из Китая',
  customs: 'На таможне',
  sorting: 'В сортировочном центре',
  delivered: 'Вручена',
}

const inputClassName = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-sky-500'

interface ShipmentOwner {
  orderId?: string
  customerId?: string
}

// Форма нового трек-номера STD у заказа или у клиента без заказа.
export function ShipmentAddForm({ orderId, customerId, submitLabel = 'Добавить трек' }: ShipmentOwner & { submitLabel?: string }) {
  const [state, formAction, pending] = useActionState<ShipmentActionState | null, FormData>(saveShipmentAction, null)

  return (
    <form action={formAction} className="space-y-2">
      <OwnerFields orderId={orderId} customerId={customerId} />
      <input name="trackingNumber" required placeholder="SF1234567890123" autoComplete="off" className={inputClassName} />
      <ActionMessage state={state} />
      <Button type="submit" disabled={pending} className="w-full bg-sky-600 hover:bg-sky-500">
        {pending ? 'Сохраняем…' : submitLabel}
      </Button>
    </form>
  )
}

// Посылка с трек-номером STD. Фонового опроса нет: статус запрашивается при
// открытии карточки, пока посылка не вручена (ответ STD кэшируется на 20 минут).
// Вручение по данным STD Rails сам переводит заказ в «Доставлен».
export function ShipmentPanel({ shipment, orderId, customerId, showOrder = false }: ShipmentOwner & { shipment: RailsCrmShipment; showOrder?: boolean }) {
  const [refreshState, refreshAction, refreshing] = useActionState<ShipmentActionState | null, FormData>(refreshShipmentAction, null)
  const [deleteState, deleteAction, deleting] = useActionState<ShipmentActionState | null, FormData>(deleteShipmentAction, null)
  const [editing, setEditing] = useState(false)
  const events = shipment.tracking?.events || []
  const delivered = shipment.status === 'delivered'

  useEffect(() => {
    if (delivered) return
    startTransition(() => refreshAction(ownerFormData({ shipmentId: shipment.id, orderId, customerId })))
    // Запрос — один раз при открытии карточки этой посылки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment.id])

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-base text-white">{shipment.tracking_number}</span>
          <Badge className={delivered ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15' : 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/15'}>
            {shipmentStatusLabels[shipment.status] || shipment.status}
          </Badge>
        </div>
        {showOrder && (
          <Info label="Заказ" value={shipment.order_public_number && shipment.order_id
            ? <Link href={`/admin/crm/orders/${shipment.order_id}`} className="text-sky-300 hover:text-sky-200">{shipment.order_public_number}</Link>
            : 'Без заказа в CRM'} />
        )}
        <Info label="Этап STD" value={shipment.tracking?.stage ? stageLabels[shipment.tracking.stage] : '—'} />
        {shipment.tracking?.destination && <Info label="Куда" value={shipment.tracking.destination} />}
        {shipment.tracking?.cdek_number && <Info label="Накладная СДЭК" value={shipment.tracking.cdek_number} mono />}
        <Info label="Добавлен" value={formatDate(shipment.created_at)} />
        <Info label="Статус запрошен" value={refreshing ? 'Запрашиваем…' : shipment.tracked_at ? formatDate(shipment.tracked_at) : 'Ещё не запрашивался'} />
      </div>

      {shipment.tracking_error && !refreshing && (
        <div className="rounded-md border border-amber-800 bg-amber-950/40 p-3 text-amber-200">{shipment.tracking_error}</div>
      )}

      {events.length > 0 && (
        <div className="space-y-3">
          {events.slice(0, 5).map((event, index) => (
            <div key={`${event.time}-${event.text}`} className={index === 0 ? 'border-l-2 border-sky-400 pl-3' : 'border-l border-slate-700 pl-3'}>
              <div className="font-medium text-slate-200">{event.text}</div>
              <div className="mt-1 text-xs text-slate-500">{event.time}</div>
            </div>
          ))}
          {events.length > 5 && <p className="text-xs text-slate-500">Ещё событий: {events.length - 5}</p>}
        </div>
      )}

      {editing ? (
        <EditForm shipment={shipment} orderId={orderId} customerId={customerId} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={refreshAction}>
            <OwnerFields shipmentId={shipment.id} orderId={orderId} customerId={customerId} />
            <Button type="submit" variant="outline" size="sm" disabled={refreshing} className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
              <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Обновить
            </Button>
          </form>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800">
            <Pencil className="h-4 w-4" />
            Изменить номер
          </Button>
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!window.confirm(`Удалить трек ${shipment.tracking_number}? Статус заказа не изменится.`)) event.preventDefault()
            }}
          >
            <OwnerFields shipmentId={shipment.id} orderId={orderId} customerId={customerId} />
            <Button type="submit" variant="outline" size="sm" disabled={deleting} className="border-red-900 bg-slate-950 text-red-300 hover:bg-red-950/40">
              <Trash2 className="h-4 w-4" />
              Удалить
            </Button>
          </form>
        </div>
      )}
      <ActionMessage state={refreshState?.ok ? null : refreshState} />
      <ActionMessage state={deleteState} />
    </div>
  )
}

function EditForm({ shipment, orderId, customerId, onCancel }: ShipmentOwner & { shipment: RailsCrmShipment; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState<ShipmentActionState | null, FormData>(saveShipmentAction, null)

  return (
    <form action={formAction} className="space-y-2">
      <OwnerFields shipmentId={shipment.id} orderId={orderId} customerId={customerId} />
      <input name="trackingNumber" required defaultValue={shipment.tracking_number} autoComplete="off" className={inputClassName} />
      {orderId && <p className="text-xs text-slate-500">Если заказ отправлен, клиент получит новый трек в Telegram-боте.</p>}
      <ActionMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending} className="bg-sky-600 hover:bg-sky-500">{pending ? 'Сохраняем…' : 'Сохранить'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="text-slate-400 hover:bg-slate-800 hover:text-slate-200">Отмена</Button>
      </div>
    </form>
  )
}

function OwnerFields({ shipmentId, orderId, customerId }: ShipmentOwner & { shipmentId?: string }) {
  return (
    <>
      {shipmentId && <input type="hidden" name="shipmentId" value={shipmentId} />}
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      {customerId && <input type="hidden" name="customerId" value={customerId} />}
    </>
  )
}

function ownerFormData(values: Record<string, string | undefined>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) if (value) data.set(key, value)
  return data
}

function ActionMessage({ state }: { state: ShipmentActionState | null }) {
  if (!state) return null
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-300' : 'rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-300'}>
      {state.message}
    </p>
  )
}

function Info({ label, value, mono = false }: { label: string; value?: ReactNode; mono?: boolean }) {
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

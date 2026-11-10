'use client'

import { useActionState } from 'react'
import { RefreshCw } from 'lucide-react'
import { refreshDeliveryParcelAction, type ShipmentActionState } from '@/actions/crm'

// Обновляет снимок STD у одной посылки в разделе «Доставка»; страница
// перерисуется сама после revalidatePath в action.
export default function DeliveryRefreshButton({ number }: { number: string }) {
  const [state, action, pending] = useActionState<ShipmentActionState | null, FormData>(refreshDeliveryParcelAction, null)

  return (
    <form action={action} className="grid justify-items-start gap-1">
      <input type="hidden" name="number" value={number} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Обновить статус ${number}`}
        title="Запросить статус в STD"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 text-slate-300 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
      </button>
      {state && !pending && (
        <span role="status" className={`max-w-[10rem] text-xs ${state.ok ? 'text-emerald-300' : 'text-red-300'}`}>{state.message}</span>
      )}
    </form>
  )
}

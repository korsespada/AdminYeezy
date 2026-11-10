import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import CrmDeliveryStats from '@/components/crm/CrmDeliveryStats'
import { deliveryParcelFilters, deliveryPeriodParam } from '@/lib/delivery-stats'
import { getRailsDeliveryStats } from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

export default async function CrmDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; stage?: string | string[]; q?: string | string[] }>
}) {
  const params = await searchParams

  try {
    const stats = await getRailsDeliveryStats({ from: deliveryPeriodParam(params.from), to: deliveryPeriodParam(params.to) })
    return <CrmDeliveryStats stats={stats} filters={deliveryParcelFilters(params)} />
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="mx-auto max-w-4xl rounded-lg border border-red-900 bg-red-950/40 p-6">
          <AlertCircle className="h-6 w-6 text-red-300" />
          <h1 className="mt-3 text-xl font-bold">Статистика доставки недоступна</h1>
          <p className="mt-2 text-sm text-red-200">
            {error instanceof Error ? error.message : 'Не удалось загрузить данные'}
          </p>
          <Link href="/admin/crm" className="mt-5 inline-block text-sm text-sky-300">
            Вернуться в CRM
          </Link>
        </div>
      </main>
    )
  }
}

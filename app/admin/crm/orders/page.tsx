import CrmOrdersList from '@/components/crm/CrmOrdersList'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { listRailsCrmOrders } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const PER_PAGE = 30
const statuses = new Set(['', 'payment_pending', 'paid', 'shipped', 'delivered', 'refund_pending', 'cancelled'])

export default async function CrmOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; queue?: string; status?: string }>
}) {
  await connection()
  const params = await searchParams
  const rawPage = Number(params.page)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const search = params.search?.trim() || ''
  const queue = ''
  const status = statuses.has(params.status?.trim() || '') ? params.status?.trim() || '' : ''
  const railsConfigured = Boolean(process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL)

  if (!railsConfigured) {
    return (
      <Alert variant="destructive" className="m-8 border-amber-800 bg-amber-900/20 text-amber-200">
        <AlertTitle className="text-xl font-bold">Rails CRM API не настроен</AlertTitle>
        <AlertDescription>
          Для CRM-раздела нужен `RAILS_API_URL` и Rails admin JWT auth.
        </AlertDescription>
      </Alert>
    )
  }

  try {
    const result = await listRailsCrmOrders({
      page,
      perPage: PER_PAGE,
      search,
      queue,
      status,
    })

    return (
      <CrmOrdersList
        orders={result.items}
        totalItems={result.totalItems}
        totalPages={result.totalPages}
        page={page}
        search={search}
        queue={queue}
        status={status}
      />
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки заказов из Rails CRM</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

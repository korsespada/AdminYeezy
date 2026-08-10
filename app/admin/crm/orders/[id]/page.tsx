import CrmOrderDetail from '@/components/crm/CrmOrderDetail'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getRailsCrmOrder } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmOrderDetailPage({
  params,
  searchParams: _searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await connection()
  const { id } = await params
  await _searchParams

  try {
    return <CrmOrderDetail order={await getRailsCrmOrder(id)} />
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки карточки заказа из Rails CRM</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

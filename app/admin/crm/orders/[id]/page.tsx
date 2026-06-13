import CrmOrderDetail from '@/components/crm/CrmOrderDetail'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getRailsCrmOrder, searchRailsCrmReplacementProducts } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ replacementSearch?: string; replacementItem?: string }>
}) {
  await connection()
  const { id } = await params
  const query = await searchParams
  const replacementSearch = query.replacementSearch?.trim() || ''
  const replacementItem = query.replacementItem?.trim() || ''

  try {
    const [order, replacementProducts] = await Promise.all([
      getRailsCrmOrder(id),
      replacementSearch ? searchRailsCrmReplacementProducts({ search: replacementSearch }) : Promise.resolve([]),
    ])
    return (
      <CrmOrderDetail
        order={order}
        replacementSearch={replacementSearch}
        replacementItem={replacementItem}
        replacementProducts={replacementProducts}
      />
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки карточки заказа из Rails CRM</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

import CrmCustomersList from '@/components/crm/CrmCustomersList'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { listRailsCrmCustomers } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const PER_PAGE = 30

export default async function CrmCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>
}) {
  await connection()
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const search = params.search?.trim() || ''

  try {
    const result = await listRailsCrmCustomers({ page, perPage: PER_PAGE, search })

    return (
      <CrmCustomersList
        customers={result.items}
        totalItems={result.totalItems}
        totalPages={result.totalPages}
        page={page}
        search={search}
      />
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки пользователей из Rails CRM</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

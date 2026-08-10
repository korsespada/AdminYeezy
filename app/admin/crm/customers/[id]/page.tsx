import CrmCustomerDetail from '@/components/crm/CrmCustomerDetail'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getRailsCrmCustomer } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  try {
    return <CrmCustomerDetail customer={await getRailsCrmCustomer(id)} />
  } catch (error: any) {
    return <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400"><AlertTitle>Ошибка загрузки клиента</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
  }
}

import CrmTelegramNotifications from '@/components/crm/CrmTelegramNotifications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { listRailsTelegramNotificationRecipients } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmSettingsPage() {
  await connection()
  try {
    return <CrmTelegramNotifications recipients={await listRailsTelegramNotificationRecipients()} />
  } catch (error: any) {
    return <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400"><AlertTitle>Ошибка загрузки настроек CRM</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
  }
}

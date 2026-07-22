import CrmTelegramNotifications from '@/components/crm/CrmTelegramNotifications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { listRailsTelegramNotificationRecipients } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmNotificationsPage() {
  await connection()

  try {
    const recipients = await listRailsTelegramNotificationRecipients()
    return <CrmTelegramNotifications recipients={recipients} />
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка загрузки Telegram-уведомлений</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
}

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import StoreTelegramMessaging from '@/components/crm/StoreTelegramMessaging'
import {
  listRailsStoreTelegramCampaigns,
  listRailsStoreTelegramContacts,
} from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

export default async function StoreTelegramPage() {
  try {
    const [{ contacts, total }, campaigns] = await Promise.all([
      listRailsStoreTelegramContacts(),
      listRailsStoreTelegramCampaigns(),
    ])
    return <StoreTelegramMessaging contacts={contacts} total={total} campaigns={campaigns} />
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="mx-auto max-w-4xl rounded-lg border border-red-900 bg-red-950/40 p-6">
          <AlertCircle className="h-6 w-6 text-red-300" />
          <h1 className="mt-3 text-xl font-bold">Telegram-рассылки недоступны</h1>
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

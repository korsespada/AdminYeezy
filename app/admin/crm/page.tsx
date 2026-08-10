import CrmDashboard from '@/components/crm/CrmDashboard'
import {
  listRailsCrmOrders,
  listRailsCrmCustomers,
  listRailsTelegramNotificationRecipients,
  type RailsCrmCustomerSummary,
  type RailsCrmListResult,
  type RailsCrmOrder,
} from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function CrmPage() {
  await connection()

  const railsConfigured = Boolean(process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL)
  const errors: string[] = []
  let recentOrders: RailsCrmOrder[] = []
  const counts = {
    orders: null as number | null,
    customers: null as number | null,
    notifications: null as number | null,
  }

  if (railsConfigured) {
    const [recent, orders, customers, notifications] = await Promise.allSettled([
      listRailsCrmOrders({ page: 1, perPage: 6 }),
      listRailsCrmOrders({ page: 1, perPage: 1 }),
      listRailsCrmCustomers({ page: 1, perPage: 1 }),
      listRailsTelegramNotificationRecipients(),
    ])

    recentOrders = fulfilledItems<RailsCrmOrder>(recent, errors)
    counts.orders = fulfilledTotal<RailsCrmOrder>(orders, errors)
    counts.customers = fulfilledTotal<RailsCrmCustomerSummary>(customers, errors)
    if (notifications.status === 'fulfilled') {
      counts.notifications = notifications.value.filter((recipient) => recipient.is_active).length
    } else {
      errors.push(notifications.reason?.message || 'Настройки Telegram-уведомлений недоступны')
    }
  }

  return (
    <CrmDashboard
      railsConfigured={railsConfigured}
      recentOrders={recentOrders}
      counts={counts}
      errors={[...new Set(errors)]}
    />
  )
}

function fulfilledItems<T>(
  result: PromiseSettledResult<RailsCrmListResult<T>>,
  errors: string[]
) {
  if (result.status === 'fulfilled') return result.value.items
  errors.push(result.reason?.message || 'Rails CRM API недоступен')
  return []
}

function fulfilledTotal<T>(
  result: PromiseSettledResult<RailsCrmListResult<T>>,
  errors: string[]
) {
  if (result.status === 'fulfilled') return result.value.totalItems
  errors.push(result.reason?.message || 'Rails CRM API недоступен')
  return null
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import {
  createRailsTelegramNotificationRecipient,
  deleteRailsTelegramNotificationRecipient,
  testRailsTelegramNotificationRecipient,
  updateRailsTelegramNotificationRecipient,
} from '@/lib/rails-admin'

const NOTIFICATIONS_PATH = '/admin/crm/settings'

function requiredString(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function notificationInput(formData: FormData) {
  return {
    telegramId: requiredString(formData, 'telegramId'),
    label: String(formData.get('label') || '').trim(),
    notifySite: formData.get('notifySite') === 'on',
    notifyTelegramMiniApp: formData.get('notifyTelegramMiniApp') === 'on',
    isActive: true,
  }
}

function revalidateNotifications() {
  revalidatePath('/admin/crm')
  revalidatePath(NOTIFICATIONS_PATH)
}

export async function createTelegramNotificationRecipientAction(formData: FormData) {
  await requireAdmin()
  await createRailsTelegramNotificationRecipient(notificationInput(formData))
  revalidateNotifications()
}

export async function updateTelegramNotificationRecipientAction(formData: FormData) {
  await requireAdmin()
  const id = requiredString(formData, 'id')
  await updateRailsTelegramNotificationRecipient(id, notificationInput(formData))
  revalidateNotifications()
}

export async function deleteTelegramNotificationRecipientAction(formData: FormData) {
  await requireAdmin()
  await deleteRailsTelegramNotificationRecipient(requiredString(formData, 'id'))
  revalidateNotifications()
}

export async function testTelegramNotificationRecipientAction(formData: FormData) {
  await requireAdmin()
  const channel = formData.get('channel') === 'telegram_mini_app' ? 'telegram_mini_app' : 'site'
  await testRailsTelegramNotificationRecipient(requiredString(formData, 'id'), channel)
  revalidateNotifications()
}

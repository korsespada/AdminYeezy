'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import {
  createRailsTelegramNotificationRecipient,
  deleteRailsTelegramNotificationRecipient,
  testRailsTelegramNotificationRecipient,
  updateRailsTelegramNotificationRecipient,
} from '@/lib/rails-admin'

const NOTIFICATIONS_PATH = '/admin/crm/notifications'

function requiredString(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

function notificationInput(formData: FormData) {
  return {
    telegramId: requiredString(formData, 'telegramId'),
    label: String(formData.get('label') || '').trim(),
    notifyNewOrders: checked(formData, 'notifyNewOrders'),
    notifyNewCustomers: checked(formData, 'notifyNewCustomers'),
    isActive: checked(formData, 'isActive'),
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
  await testRailsTelegramNotificationRecipient(requiredString(formData, 'id'))
  revalidateNotifications()
}

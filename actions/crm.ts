'use server'

import { revalidatePath } from 'next/cache'
import {
  approveRailsCrmRefund,
  approveRailsCrmWalletWithdrawal,
  createRailsCrmReplacementOffer,
  createRailsCrmShipment,
  createRailsCrmSupplierRequest,
  deleteRailsCrmShipment,
  markRailsCrmWalletWithdrawalPaid,
  recordRailsCrmSupplierResponse,
  refreshRailsCrmShipment,
  rejectRailsCrmRefund,
  rejectRailsCrmWalletWithdrawal,
  transitionRailsCrmOrder,
  transitionRailsCrmOrderItem,
  updateRailsCrmShipment,
} from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'

function revalidateCrm(orderId?: string) {
  revalidatePath('/admin/crm')
  revalidatePath('/admin/crm/orders')
  if (orderId) revalidatePath(`/admin/crm/orders/${orderId}`)
}

function revalidateRefunds(orderId?: string) {
  revalidateCrm(orderId)
  revalidatePath('/admin/crm/refunds')
}

function revalidateWalletWithdrawals() {
  revalidatePath('/admin/crm')
  revalidatePath('/admin/crm/wallet-withdrawals')
}

function requiredString(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

export async function transitionOrderAction(formData: FormData) {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  const toStatus = requiredString(formData, 'toStatus')
  const message = String(formData.get('message') || '').trim()
  await transitionRailsCrmOrder(orderId, { toStatus, message })
  revalidateCrm(orderId)
}

export interface ShipmentActionState {
  ok: boolean
  message: string
}

function optionalString(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim() || undefined
}

function actionErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Не удалось выполнить запрос к Rails API'
}

// Посылка живёт у заказа (orderId) или у клиента (customerId): обновляем обе
// страницы, на которых её видно.
function revalidateShipment(formData: FormData) {
  const orderId = optionalString(formData, 'orderId')
  const customerId = optionalString(formData, 'customerId')
  revalidateCrm(orderId)
  if (customerId) revalidatePath(`/admin/crm/customers/${customerId}`)
}

export async function saveShipmentAction(_state: ShipmentActionState | null, formData: FormData): Promise<ShipmentActionState> {
  await requireAdmin()
  const shipmentId = optionalString(formData, 'shipmentId')
  try {
    const trackingNumber = requiredString(formData, 'trackingNumber')
    const shipment = shipmentId
      ? await updateRailsCrmShipment(shipmentId, trackingNumber)
      : await createRailsCrmShipment({
        trackingNumber,
        orderId: optionalString(formData, 'orderId'),
        customerId: optionalString(formData, 'customerId'),
      })
    revalidateShipment(formData)
    return { ok: true, message: `Трек ${shipment.tracking_number} сохранён` }
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) }
  }
}

export async function deleteShipmentAction(_state: ShipmentActionState | null, formData: FormData): Promise<ShipmentActionState> {
  await requireAdmin()
  try {
    await deleteRailsCrmShipment(requiredString(formData, 'shipmentId'))
    revalidateShipment(formData)
    return { ok: true, message: 'Трек удалён' }
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) }
  }
}

export async function refreshShipmentAction(_state: ShipmentActionState | null, formData: FormData): Promise<ShipmentActionState> {
  await requireAdmin()
  try {
    const shipment = await refreshRailsCrmShipment(requiredString(formData, 'shipmentId'))
    revalidateShipment(formData)
    return shipment.tracking_error ? { ok: false, message: shipment.tracking_error } : { ok: true, message: 'Статус обновлён' }
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) }
  }
}

export async function transitionOrderItemAction(formData: FormData) {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  const itemId = requiredString(formData, 'itemId')
  const toStatus = requiredString(formData, 'toStatus')
  const message = String(formData.get('message') || '').trim()
  await transitionRailsCrmOrderItem(itemId, { toStatus, message })
  revalidateCrm(orderId)
}

export async function createSupplierRequestAction(formData: FormData) {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  const itemId = requiredString(formData, 'itemId')
  const supplierId = String(formData.get('supplierId') || '').trim()
  const requestType = String(formData.get('requestType') || 'availability').trim()
  const messageText = String(formData.get('messageText') || '').trim()
  const slaHours = Number(formData.get('slaHours') || 6)
  await createRailsCrmSupplierRequest(itemId, {
    supplierId,
    requestType,
    messageText,
    slaHours: Number.isFinite(slaHours) && slaHours > 0 ? slaHours : 6,
  })
  revalidateCrm(orderId)
}

export async function recordSupplierResponseAction(formData: FormData) {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  const requestId = requiredString(formData, 'requestId')
  const responseType = requiredString(formData, 'responseType')
  const messageText = String(formData.get('messageText') || '').trim()
  const priceRub = Number(formData.get('priceRub') || 0)
  await recordRailsCrmSupplierResponse(requestId, {
    responseType,
    messageText,
    priceCents: Number.isFinite(priceRub) && priceRub > 0 ? Math.round(priceRub * 100) : null,
  })
  revalidateCrm(orderId)
}

export async function createReplacementOfferAction(formData: FormData) {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  const itemId = requiredString(formData, 'itemId')
  const replacementProductId = requiredString(formData, 'replacementProductId')
  const replacementVariantId = String(formData.get('replacementVariantId') || '').trim()
  const message = String(formData.get('message') || '').trim()
  const expiresAt = String(formData.get('expiresAt') || '').trim()
  await createRailsCrmReplacementOffer(itemId, {
    replacementProductId,
    replacementVariantId,
    message,
    expiresAt,
  })
  revalidateCrm(orderId)
}

export async function approveRefundAction(formData: FormData) {
  await requireAdmin()
  const refundId = requiredString(formData, 'refundId')
  const orderId = String(formData.get('orderId') || '').trim()
  await approveRailsCrmRefund(refundId)
  revalidateRefunds(orderId)
}

export async function rejectRefundAction(formData: FormData) {
  await requireAdmin()
  const refundId = requiredString(formData, 'refundId')
  const orderId = String(formData.get('orderId') || '').trim()
  const message = String(formData.get('message') || '').trim()
  await rejectRailsCrmRefund(refundId, message)
  revalidateRefunds(orderId)
}

export async function approveWalletWithdrawalAction(formData: FormData) {
  await requireAdmin()
  const withdrawalId = requiredString(formData, 'withdrawalId')
  await approveRailsCrmWalletWithdrawal(withdrawalId)
  revalidateWalletWithdrawals()
}

export async function rejectWalletWithdrawalAction(formData: FormData) {
  await requireAdmin()
  const withdrawalId = requiredString(formData, 'withdrawalId')
  const message = String(formData.get('message') || '').trim()
  await rejectRailsCrmWalletWithdrawal(withdrawalId, message)
  revalidateWalletWithdrawals()
}

export async function markWalletWithdrawalPaidAction(formData: FormData) {
  await requireAdmin()
  const withdrawalId = requiredString(formData, 'withdrawalId')
  await markRailsCrmWalletWithdrawalPaid(withdrawalId)
  revalidateWalletWithdrawals()
}

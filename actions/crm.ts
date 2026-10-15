'use server'

import { revalidatePath } from 'next/cache'
import {
  approveRailsCrmRefund,
  approveRailsCrmWalletWithdrawal,
  createRailsCrmOrderShipment,
  createRailsCrmReplacementOffer,
  createRailsCrmSupplierRequest,
  markRailsCrmWalletWithdrawalPaid,
  recordRailsCrmSupplierResponse,
  refreshRailsCrmOrderShipment,
  rejectRailsCrmRefund,
  rejectRailsCrmWalletWithdrawal,
  transitionRailsCrmOrder,
  transitionRailsCrmOrderItem,
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

export async function createOrderShipmentAction(_state: ShipmentActionState | null, formData: FormData): Promise<ShipmentActionState> {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  try {
    const order = await createRailsCrmOrderShipment(orderId, {
      province: optionalString(formData, 'province'),
      fast: formData.get('fast') === 'on',
      weight: optionalString(formData, 'weight'),
      length: optionalString(formData, 'length'),
      width: optionalString(formData, 'width'),
      height: optionalString(formData, 'height'),
      goodsName: optionalString(formData, 'goodsName'),
      goodsPrice: optionalString(formData, 'goodsPrice'),
    })
    revalidateCrm(orderId)
    return { ok: true, message: `Передано в STD-Express, трек ${order.shipment?.tracking_number || '—'}` }
  } catch (error) {
    return { ok: false, message: actionErrorMessage(error) }
  }
}

export async function refreshOrderShipmentAction(_state: ShipmentActionState | null, formData: FormData): Promise<ShipmentActionState> {
  await requireAdmin()
  const orderId = requiredString(formData, 'orderId')
  try {
    const order = await refreshRailsCrmOrderShipment(orderId)
    revalidateCrm(orderId)
    const error = order.shipment?.tracking_error
    return error ? { ok: false, message: error } : { ok: true, message: 'Трекинг обновлён' }
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

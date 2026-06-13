'use server'

import { revalidatePath } from 'next/cache'
import {
  approveRailsCrmRefund,
  approveRailsCrmWalletWithdrawal,
  createRailsCrmReplacementOffer,
  createRailsCrmSupplierRequest,
  markRailsCrmWalletWithdrawalPaid,
  recordRailsCrmSupplierResponse,
  rejectRailsCrmRefund,
  rejectRailsCrmWalletWithdrawal,
  transitionRailsCrmOrder,
  transitionRailsCrmOrderItem,
} from '@/lib/rails-admin'

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
  const orderId = requiredString(formData, 'orderId')
  const toStatus = requiredString(formData, 'toStatus')
  const message = String(formData.get('message') || '').trim()
  await transitionRailsCrmOrder(orderId, { toStatus, message })
  revalidateCrm(orderId)
}

export async function transitionOrderItemAction(formData: FormData) {
  const orderId = requiredString(formData, 'orderId')
  const itemId = requiredString(formData, 'itemId')
  const toStatus = requiredString(formData, 'toStatus')
  const message = String(formData.get('message') || '').trim()
  await transitionRailsCrmOrderItem(itemId, { toStatus, message })
  revalidateCrm(orderId)
}

export async function createSupplierRequestAction(formData: FormData) {
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
  const refundId = requiredString(formData, 'refundId')
  const orderId = String(formData.get('orderId') || '').trim()
  await approveRailsCrmRefund(refundId)
  revalidateRefunds(orderId)
}

export async function rejectRefundAction(formData: FormData) {
  const refundId = requiredString(formData, 'refundId')
  const orderId = String(formData.get('orderId') || '').trim()
  const message = String(formData.get('message') || '').trim()
  await rejectRailsCrmRefund(refundId, message)
  revalidateRefunds(orderId)
}

export async function approveWalletWithdrawalAction(formData: FormData) {
  const withdrawalId = requiredString(formData, 'withdrawalId')
  await approveRailsCrmWalletWithdrawal(withdrawalId)
  revalidateWalletWithdrawals()
}

export async function rejectWalletWithdrawalAction(formData: FormData) {
  const withdrawalId = requiredString(formData, 'withdrawalId')
  const message = String(formData.get('message') || '').trim()
  await rejectRailsCrmWalletWithdrawal(withdrawalId, message)
  revalidateWalletWithdrawals()
}

export async function markWalletWithdrawalPaidAction(formData: FormData) {
  const withdrawalId = requiredString(formData, 'withdrawalId')
  await markRailsCrmWalletWithdrawalPaid(withdrawalId)
  revalidateWalletWithdrawals()
}

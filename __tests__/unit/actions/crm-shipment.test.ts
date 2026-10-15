import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRailsCrmOrderShipment: vi.fn(),
  refreshRailsCrmOrderShipment: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/rails-admin', () => ({
  approveRailsCrmRefund: vi.fn(),
  approveRailsCrmWalletWithdrawal: vi.fn(),
  createRailsCrmOrderShipment: mocks.createRailsCrmOrderShipment,
  createRailsCrmReplacementOffer: vi.fn(),
  createRailsCrmSupplierRequest: vi.fn(),
  markRailsCrmWalletWithdrawalPaid: vi.fn(),
  recordRailsCrmSupplierResponse: vi.fn(),
  refreshRailsCrmOrderShipment: mocks.refreshRailsCrmOrderShipment,
  rejectRailsCrmRefund: vi.fn(),
  rejectRailsCrmWalletWithdrawal: vi.fn(),
  transitionRailsCrmOrder: vi.fn(),
  transitionRailsCrmOrderItem: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createOrderShipmentAction, refreshOrderShipmentAction } from '@/actions/crm'

function formData(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('STD-Express shipment actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1' })
  })

  it('sends only filled overrides and reports the tracking number', async () => {
    mocks.createRailsCrmOrderShipment.mockResolvedValue({ shipment: { tracking_number: 'STD-777' } })

    const result = await createOrderShipmentAction(null, formData({
      orderId: 'order-1', province: ' Московская обл ', weight: '1.2', length: '', fast: 'on', goodsName: '',
    }))

    expect(result).toEqual({ ok: true, message: 'Передано в STD-Express, трек STD-777' })
    expect(mocks.createRailsCrmOrderShipment).toHaveBeenCalledWith('order-1', {
      province: 'Московская обл',
      fast: true,
      weight: '1.2',
      length: undefined,
      width: undefined,
      height: undefined,
      goodsName: undefined,
      goodsPrice: undefined,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/crm/orders/order-1')
  })

  it('returns the Rails/STD error instead of throwing', async () => {
    mocks.createRailsCrmOrderShipment.mockRejectedValue(new Error('STD-Express: город не найден'))

    const result = await createOrderShipmentAction(null, formData({ orderId: 'order-1' }))

    expect(result).toEqual({ ok: false, message: 'STD-Express: город не найден' })
    expect(mocks.createRailsCrmOrderShipment.mock.calls[0][1].fast).toBe(false)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('surfaces the stored tracking error after refresh', async () => {
    mocks.refreshRailsCrmOrderShipment.mockResolvedValueOnce({ shipment: { tracking_error: 'STD-Express: заказ не найден в службе доставки' } })
    mocks.refreshRailsCrmOrderShipment.mockResolvedValueOnce({ shipment: { tracking_error: null } })

    expect(await refreshOrderShipmentAction(null, formData({ orderId: 'order-1' })))
      .toEqual({ ok: false, message: 'STD-Express: заказ не найден в службе доставки' })
    expect(await refreshOrderShipmentAction(null, formData({ orderId: 'order-1' })))
      .toEqual({ ok: true, message: 'Трекинг обновлён' })
  })
})

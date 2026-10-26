import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRailsCrmShipment: vi.fn(),
  updateRailsCrmShipment: vi.fn(),
  deleteRailsCrmShipment: vi.fn(),
  refreshRailsCrmShipment: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/rails-admin', () => ({
  approveRailsCrmRefund: vi.fn(),
  approveRailsCrmWalletWithdrawal: vi.fn(),
  createRailsCrmReplacementOffer: vi.fn(),
  createRailsCrmShipment: mocks.createRailsCrmShipment,
  createRailsCrmSupplierRequest: vi.fn(),
  deleteRailsCrmShipment: mocks.deleteRailsCrmShipment,
  markRailsCrmWalletWithdrawalPaid: vi.fn(),
  recordRailsCrmSupplierResponse: vi.fn(),
  refreshRailsCrmShipment: mocks.refreshRailsCrmShipment,
  rejectRailsCrmRefund: vi.fn(),
  rejectRailsCrmWalletWithdrawal: vi.fn(),
  transitionRailsCrmOrder: vi.fn(),
  transitionRailsCrmOrderItem: vi.fn(),
  updateRailsCrmShipment: mocks.updateRailsCrmShipment,
}))

vi.mock('@/lib/admin-session', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { deleteShipmentAction, refreshShipmentAction, saveShipmentAction } from '@/actions/crm'

function formData(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('STD tracking number actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1' })
  })

  it('adds a track to an order and refreshes the order and customer pages', async () => {
    mocks.createRailsCrmShipment.mockResolvedValue({ tracking_number: 'SF1577439750829' })

    const result = await saveShipmentAction(null, formData({ orderId: 'order-1', customerId: 'customer-1', trackingNumber: ' sf1577439750829 ' }))

    expect(result).toEqual({ ok: true, message: 'Трек SF1577439750829 сохранён' })
    expect(mocks.createRailsCrmShipment).toHaveBeenCalledWith({ trackingNumber: 'sf1577439750829', orderId: 'order-1', customerId: 'customer-1' })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/crm/orders/order-1')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/crm/customers/customer-1')
  })

  it('changes the number of an existing parcel', async () => {
    mocks.updateRailsCrmShipment.mockResolvedValue({ tracking_number: 'SF1569167781472' })

    const result = await saveShipmentAction(null, formData({ shipmentId: 'shipment-1', customerId: 'customer-1', trackingNumber: 'SF1569167781472' }))

    expect(result.ok).toBe(true)
    expect(mocks.updateRailsCrmShipment).toHaveBeenCalledWith('shipment-1', 'SF1569167781472')
    expect(mocks.createRailsCrmShipment).not.toHaveBeenCalled()
  })

  it('returns the Rails validation error instead of throwing', async () => {
    mocks.createRailsCrmShipment.mockRejectedValue(new Error('Трек-номер STD должен быть вида SF1234567890123'))

    const result = await saveShipmentAction(null, formData({ customerId: 'customer-1', trackingNumber: '123' }))

    expect(result).toEqual({ ok: false, message: 'Трек-номер STD должен быть вида SF1234567890123' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('deletes a parcel', async () => {
    mocks.deleteRailsCrmShipment.mockResolvedValue(undefined)

    expect(await deleteShipmentAction(null, formData({ shipmentId: 'shipment-1', customerId: 'customer-1' })))
      .toEqual({ ok: true, message: 'Трек удалён' })
    expect(mocks.deleteRailsCrmShipment).toHaveBeenCalledWith('shipment-1')
  })

  it('surfaces the stored tracking error after refresh', async () => {
    mocks.refreshRailsCrmShipment.mockResolvedValueOnce({ tracking_error: 'STD-Express недоступен' })
    mocks.refreshRailsCrmShipment.mockResolvedValueOnce({ tracking_error: null })

    expect(await refreshShipmentAction(null, formData({ shipmentId: 'shipment-1' })))
      .toEqual({ ok: false, message: 'STD-Express недоступен' })
    expect(await refreshShipmentAction(null, formData({ shipmentId: 'shipment-1' })))
      .toEqual({ ok: true, message: 'Статус обновлён' })
  })
})

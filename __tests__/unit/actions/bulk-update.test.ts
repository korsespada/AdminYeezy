import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  patchRailsAdminProduct: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock('@/lib/rails-admin', () => ({
  deleteRailsAdminProduct: vi.fn(),
  moveRailsAdminProductToTrash: vi.fn(),
  patchRailsAdminProduct: mocks.patchRailsAdminProduct,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { bulkUpdateProductsAction } from '@/actions/bulk-update'

describe('bulkUpdateProductsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue(undefined)
    mocks.patchRailsAdminProduct.mockResolvedValue({})
  })

  it('sets one price for every unique selected product', async () => {
    const result = await bulkUpdateProductsAction(
      ['product-1', 'product-2', 'product-1'],
      { price: 42_000 },
    )

    expect(result).toEqual({ success: true, data: { updated: 2 } })
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledTimes(2)
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('product-1', { price: 42_000 })
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('product-2', { price: 42_000 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
  })

  it('rejects a negative bulk price before changing products', async () => {
    const result = await bulkUpdateProductsAction(['product-1'], { price: -1 })

    expect(result.success).toBe(false)
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()
  })
})

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
  getRailsAdminProduct: vi.fn(),
  moveRailsAdminProductToTrash: vi.fn(),
  patchRailsAdminProduct: mocks.patchRailsAdminProduct,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { bulkAssignVariantFamilyAction } from '@/actions/bulk-update'

describe('bulkAssignVariantFamilyAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue(undefined)
    mocks.patchRailsAdminProduct.mockResolvedValue({})
  })

  it('creates a new named family with a generated key for every selected product', async () => {
    const result = await bulkAssignVariantFamilyAction(['p1', 'p2', 'p1'], { familyName: 'BC0013 — лоферы' })

    expect(result.success).toBe(true)
    const groupKey = (result as { data?: { groupKey?: string } }).data?.groupKey || ''
    expect(groupKey).toMatch(/^[0-9a-f]{32}$/)
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledTimes(2)
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('p1', { variantGroupKey: groupKey })
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('p2', { variantGroupKey: groupKey })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
  })

  it('adds products to an existing family by key without requiring a name', async () => {
    const familyKey = 'a'.repeat(32)

    const result = await bulkAssignVariantFamilyAction(['p1', 'p2'], { familyKey })

    expect(result.success).toBe(true)
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledTimes(2)
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('p1', { variantGroupKey: familyKey })
  })

  it('rejects a single product for a new family', async () => {
    const result = await bulkAssignVariantFamilyAction(['p1'], { familyName: 'Одиночка' })

    expect(result.success).toBe(false)
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()
  })

  it('rejects a new family without a name', async () => {
    const result = await bulkAssignVariantFamilyAction(['p1', 'p2'], {})

    expect(result.success).toBe(false)
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()
  })

  it('rejects an existing-family key that is not a confirmed 32-hex key', async () => {
    const result = await bulkAssignVariantFamilyAction(['p1', 'p2'], { familyKey: 'не-ключ' })

    expect(result.success).toBe(false)
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()
  })
})

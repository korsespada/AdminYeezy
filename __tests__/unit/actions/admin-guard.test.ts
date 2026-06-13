import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moveProductToTrashAction } from '@/actions/products'
import { moveRailsAdminProductToTrash } from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'

vi.mock('@/lib/rails-admin', () => ({
  moveRailsAdminProductToTrash: vi.fn(),
  createRailsAdminProduct: vi.fn(),
  deleteRailsAdminProduct: vi.fn(),
  restoreRailsAdminProductFromTrash: vi.fn(),
  updateRailsAdminProduct: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: vi.fn(),
}))

describe('server action admin guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call Rails destructive actions without an admin session', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(requireAdmin).mockRejectedValue(new Error('Admin authentication required'))

      const result = await moveProductToTrashAction('product-1')

      expect(result.success).toBe(false)
      expect(moveRailsAdminProductToTrash).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})

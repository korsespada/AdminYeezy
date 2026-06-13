'use server'

import { revalidatePath } from 'next/cache'
import { deleteRailsAdminProduct, moveRailsAdminProductToTrash, patchRailsAdminProduct } from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'

export async function bulkUpdateProductsAction(ids: string[], updates: { category?: string, subcategory?: string, gender?: string }) {
  try {
    await requireAdmin()
    for (const id of ids) {
      await patchRailsAdminProduct(id, updates)
    }
    revalidatePath('/admin')
    return { success: true }
  } catch (error: any) {
    console.error('Bulk update error:', error)
    return { success: false, error: error.message || 'Failed to update products' }
  }
}

export async function bulkDeleteProductsAction(ids: string[]) {
  return bulkMoveProductsToTrashAction(ids)
}

export async function bulkMoveProductsToTrashAction(ids: string[]) {
  try {
    await requireAdmin()
    for (const id of ids) {
      await moveRailsAdminProductToTrash(id)
    }
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Bulk move to trash error:', error)
    return { success: false, error: error.message || 'Failed to move products to trash' }
  }
}

export async function bulkDeleteProductsPermanentlyAction(ids: string[]) {
  try {
    await requireAdmin()
    for (const id of ids) {
      await deleteRailsAdminProduct(id)
    }
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Bulk permanent delete error:', error)
    return { success: false, error: error.message || 'Failed to permanently delete products' }
  }
}

export async function bulkPatchObjectsAction(updates: { id: string, data: any }[]) {
  try {
    await requireAdmin()
    for (const update of updates) {
      await patchRailsAdminProduct(update.id, update.data)
    }
    revalidatePath('/admin')
    return { success: true }
  } catch (error: any) {
    console.error('Bulk patch error:', error)
    return { success: false, error: error.message || 'Failed to mass replace products' }
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { deleteRailsAdminProduct, patchRailsAdminProduct } from '@/lib/rails-admin'

export async function bulkUpdateProductsAction(ids: string[], updates: { category?: string, subcategory?: string, gender?: string }) {
  try {
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
  try {
    for (const id of ids) {
      await deleteRailsAdminProduct(id)
    }
    revalidatePath('/admin')
    return { success: true }
  } catch (error: any) {
    console.error('Bulk delete error:', error)
    return { success: false, error: error.message || 'Failed to delete products' }
  }
}

export async function bulkPatchObjectsAction(updates: { id: string, data: any }[]) {
  try {
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

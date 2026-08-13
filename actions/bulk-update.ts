'use server'

import { revalidatePath } from 'next/cache'
import { deleteRailsAdminProduct, getRailsAdminProduct, moveRailsAdminProductToTrash, patchRailsAdminProduct } from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'
import { applyMeasurementTableAttributes, normalizeMeasurementTable } from '@/lib/measurement-templates'

export interface BulkProductUpdates {
  category?: string
  subcategory?: string
  gender?: string
  price?: number
  measurementTemplate?: unknown
  catalog_attributes?: Record<string, any>
}

export async function bulkUpdateProductsAction(ids: string[], updates: BulkProductUpdates) {
  try {
    await requireAdmin()
    const uniqueIds = [...new Set(ids.map(String).filter(Boolean))]
    if (uniqueIds.length === 0) {
      return { success: false, error: 'Не выбраны товары' }
    }
    if (updates.price !== undefined && (!Number.isFinite(updates.price) || updates.price < 0)) {
      return { success: false, error: 'Цена должна быть неотрицательным числом' }
    }
    const measurementTemplate = updates.measurementTemplate === undefined
      ? null
      : normalizeMeasurementTable(updates.measurementTemplate)
    if (updates.measurementTemplate !== undefined && !measurementTemplate) {
      return { success: false, error: 'Шаблон размеров пуст или повреждён' }
    }

    // A small concurrency window keeps large selections responsive without
    // flooding the Rails admin API with hundreds of simultaneous requests.
    for (let index = 0; index < uniqueIds.length; index += 5) {
      await Promise.all(
        uniqueIds.slice(index, index + 5).map(async (id) => {
          const productUpdates: BulkProductUpdates = { ...updates }
          delete productUpdates.measurementTemplate

          if (measurementTemplate) {
            const current = await getRailsAdminProduct(id)
            const currentAttributes = current.catalog_attributes || current.attributes || {}
            productUpdates.catalog_attributes = applyMeasurementTableAttributes(currentAttributes, measurementTemplate)
          }

          return patchRailsAdminProduct(id, productUpdates)
        }),
      )
    }
    revalidatePath('/admin')
    return { success: true, data: { updated: uniqueIds.length } }
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

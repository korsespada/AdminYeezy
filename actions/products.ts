'use server'

import { revalidatePath } from 'next/cache'
import {
  createRailsAdminProduct,
  deleteRailsAdminProduct,
  moveRailsAdminProductToTrash,
  restoreRailsAdminProductFromTrash,
  updateRailsAdminProduct,
} from '@/lib/rails-admin'
import type { ActionResponse } from '@/lib/types'

export async function createProductAction(formData: FormData): Promise<ActionResponse> {
  try {
    const product = await createRailsAdminProduct(formData)
    revalidatePath('/admin')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Create product error:', error)
    return { success: false, error: error.message || 'Failed to create product' }
  }
}

export async function updateProductAction(id: string, formData: FormData): Promise<ActionResponse> {
  try {
    const product = await updateRailsAdminProduct(id, formData)
    revalidatePath('/admin')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Update product error:', error)
    return { success: false, error: error.message || 'Failed to update product' }
  }
}

export async function deleteProductAction(id: string): Promise<ActionResponse> {
  return moveProductToTrashAction(id)
}

export async function moveProductToTrashAction(id: string): Promise<ActionResponse> {
  try {
    await moveRailsAdminProductToTrash(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Move product to trash error:', error)
    return { success: false, error: error.message || 'Failed to move product to trash' }
  }
}

export async function restoreProductFromTrashAction(id: string): Promise<ActionResponse> {
  try {
    const product = await restoreRailsAdminProductFromTrash(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Restore product from trash error:', error)
    return { success: false, error: error.message || 'Failed to restore product' }
  }
}

export async function deleteProductPermanentlyAction(id: string): Promise<ActionResponse> {
  try {
    await deleteRailsAdminProduct(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Permanent delete product error:', error)
    return { success: false, error: error.message || 'Failed to permanently delete product' }
  }
}

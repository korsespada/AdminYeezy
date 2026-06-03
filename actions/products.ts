'use server'

import { revalidatePath } from 'next/cache'
import { createRailsAdminProduct, deleteRailsAdminProduct, updateRailsAdminProduct } from '@/lib/rails-admin'
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
  try {
    await deleteRailsAdminProduct(id)
    revalidatePath('/admin')
    return { success: true }
  } catch (error: any) {
    console.error('Delete product error:', error)
    return { success: false, error: error.message || 'Failed to delete product' }
  }
}

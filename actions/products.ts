'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/pocketbase'
import type { ActionResponse } from '@/lib/types'
import { Collections } from '@/lib/types'

/**
 * Create product action
 */
export async function createProductAction(formData: FormData): Promise<ActionResponse> {
  try {
    const pb = createClient()

    // Extract fields
    const productId = formData.get('productId') as string
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const priceStr = formData.get('price') as string
    const status = formData.get('status') as string
    const brands = formData.getAll('brand') as string[]
    const category = formData.get('category') as string
    const subcategory = formData.get('subcategory') as string
    const gender = formData.get('gender') as string

    // Get external photos
    const existingPhotosStr = formData.get('existingPhotos') as string
    let photos: string[] = []

    if (existingPhotosStr) {
      try {
        photos = JSON.parse(existingPhotosStr)
      } catch (e) {
        console.error('Failed to parse existingPhotos:', e)
      }
    }

    // Validation
    if (!productId || !productId.trim()) {
      return { success: false, error: 'Product ID is required' }
    }
    if (!name || !name.trim()) {
      return { success: false, error: 'Product name is required' }
    }
    if (!brands || brands.length === 0) {
      return { success: false, error: 'At least one brand is required' }
    }
    if (!category) {
      return { success: false, error: 'Category is required' }
    }

    const price = parseFloat(priceStr)
    if (isNaN(price) || price < 0) {
      return { success: false, error: 'Price must be a positive number' }
    }

    // Prepare data
    const data: any = {
      productId: productId.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      price,
      status: status || 'active',
      brand: brands,
      category,
      subcategory,
      gender,
      photos, // Store array of URLs directly
      photos_processed: false,
    }

    // Create product
    await pb.collection(Collections.Products).create(data)
    revalidatePath('/admin')

    return { success: true }
  } catch (error: any) {
    console.error('Create product error:', error)

    if (error?.data?.data) {
      const fieldErrors = Object.entries(error.data.data)
        .map(([field, err]: [string, any]) => `${field}: ${err.message}`)
        .join(', ')
      return { success: false, error: `Validation error: ${fieldErrors}` }
    }

    return { success: false, error: 'Failed to create product' }
  }
}

/**
 * Update product action
 */
export async function updateProductAction(
  id: string,
  formData: FormData
): Promise<ActionResponse> {
  try {
    const pb = createClient()

    // Extract fields
    const productId = formData.get('productId') as string
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const priceStr = formData.get('price') as string
    const status = formData.get('status') as string
    const brands = formData.getAll('brand') as string[]
    const category = formData.get('category') as string
    const subcategory = formData.get('subcategory') as string
    const gender = formData.get('gender') as string
    const existingPhotosStr = formData.get('existingPhotos') as string

    // Get external photos
    let photos: string[] = []

    if (existingPhotosStr) {
      try {
        photos = JSON.parse(existingPhotosStr)
      } catch (e) {
        console.error('Failed to parse existingPhotos:', e)
      }
    }

    // Validation
    if (!productId || !productId.trim()) {
      return { success: false, error: 'Product ID is required' }
    }
    if (!name || !name.trim()) {
      return { success: false, error: 'Product name is required' }
    }
    if (!brands || brands.length === 0) {
      return { success: false, error: 'At least one brand is required' }
    }
    if (!category) {
      return { success: false, error: 'Category is required' }
    }

    const price = parseFloat(priceStr)
    if (isNaN(price) || price < 0) {
      return { success: false, error: 'Price must be a positive number' }
    }

    // Prepare data
    const data: any = {
      productId: productId.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      price,
      status: status || 'active',
      brand: brands,
      category,
      subcategory,
      gender,
    }

    // Update photos array (reordered URLs from drag-and-drop)
    if (existingPhotosStr) {
      try {
        const existingPhotos = JSON.parse(existingPhotosStr)
        // Photos are stored as JSON array of URLs
        data.photos = existingPhotos
      } catch (e) {
        console.error('Failed to parse existingPhotos:', e)
      }
    }

    // Update product
    await pb.collection(Collections.Products).update(id, data)
    revalidatePath('/admin')

    return { success: true }
  } catch (error: any) {
    console.error('Update product error:', error)

    if (error?.status === 404) {
      return { success: false, error: 'Product not found' }
    }

    if (error?.data?.data) {
      const fieldErrors = Object.entries(error.data.data)
        .map(([field, err]: [string, any]) => `${field}: ${err.message}`)
        .join(', ')
      return { success: false, error: `Validation error: ${fieldErrors}` }
    }

    return { success: false, error: 'Failed to update product' }
  }
}

/**
 * Delete product action
 */
export async function deleteProductAction(id: string): Promise<ActionResponse> {
  try {
    const pb = createClient()
    await pb.collection(Collections.Products).delete(id)
    revalidatePath('/admin')
    return { success: true }
  } catch (error: any) {
    console.error('Delete product error:', error)
    if (error?.status === 404) {
      return { success: false, error: 'Product not found' }
    }
    return { success: false, error: 'Failed to delete product' }
  }
}

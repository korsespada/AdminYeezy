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
    const brand = formData.get('brand') as string
    const category = formData.get('category') as string
    
    // Get all photo files
    const photos: File[] = []
    let photoIndex = 0
    while (formData.has(`photo_${photoIndex}`)) {
      const photo = formData.get(`photo_${photoIndex}`) as File
      if (photo && photo.size > 0) {
        photos.push(photo)
      }
      photoIndex++
    }

    // Validation
    if (!productId || !productId.trim()) {
      return { success: false, error: 'Product ID is required' }
    }
    if (!name || !name.trim()) {
      return { success: false, error: 'Product name is required' }
    }
    if (!brand) {
      return { success: false, error: 'Brand is required' }
    }
    if (!category) {
      return { success: false, error: 'Category is required' }
    }

    const price = parseFloat(priceStr)
    if (isNaN(price) || price < 0) {
      return { success: false, error: 'Price must be a positive number' }
    }

    // Validate photos
    const maxSize = 5 * 1024 * 1024 // 5MB
    for (const photo of photos) {
      if (photo.size > maxSize) {
        return { success: false, error: 'Each image must be smaller than 5MB' }
      }
      if (!photo.type.startsWith('image/')) {
        return { success: false, error: 'Please upload valid image files' }
      }
    }

    // Prepare data
    const data: any = {
      productId: productId.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      price,
      status: status || 'active',
      brand,
      category,
      photos_processed: false,
    }

    // Add photos
    photos.forEach((photo, index) => {
      data[`photos.${index}`] = photo
    })

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
    const brand = formData.get('brand') as string
    const category = formData.get('category') as string
    const existingPhotosStr = formData.get('existingPhotos') as string
    
    // Get new photos (not used for now, photos are external URLs)
    const photos: File[] = []
    let photoIndex = 0
    while (formData.has(`photo_${photoIndex}`)) {
      const photo = formData.get(`photo_${photoIndex}`) as File
      if (photo && photo.size > 0) {
        photos.push(photo)
      }
      photoIndex++
    }

    // Validation
    if (!productId || !productId.trim()) {
      return { success: false, error: 'Product ID is required' }
    }
    if (!name || !name.trim()) {
      return { success: false, error: 'Product name is required' }
    }
    if (!brand) {
      return { success: false, error: 'Brand is required' }
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
      brand,
      category,
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

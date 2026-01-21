/**
 * Brand type matching PocketBase collection schema
 */
export interface Brand {
  id: string
  name: string
  description: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}

/**
 * Category type matching PocketBase collection schema
 */
export interface Category {
  id: string
  name: string
  description: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}

/**
 * Product type matching PocketBase collection schema
 */
export interface Product {
  id: string
  productId: string
  name: string
  description: string
  price: number
  status: 'active' | 'inactive'
  brand: string // Brand ID
  category: string // Category ID
  photos: string[] // Array of photo filenames
  photos_processed: boolean
  thumb: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
  // Expanded relations (when using expand parameter)
  expand?: {
    brand?: Brand
    category?: Category
  }
}

/**
 * Form data for creating/updating products
 */
export interface ProductFormData {
  productId: string
  name: string
  description: string
  price: number
  status: 'active' | 'inactive'
  brand: string
  category: string
  photos?: File[]
}

/**
 * Server Action response type
 */
export interface ActionResponse {
  success: boolean
  error?: string
  data?: any
}

/**
 * PocketBase collection names
 */
export const Collections = {
  Products: 'products',
  Brand: 'brands',
  Category: 'categories',
} as const

export type CollectionName = typeof Collections[keyof typeof Collections]

/**
 * Brand type matching PocketBase collection schema
 */
export interface Brand {
  id: string
  name: string
  slug?: string
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
  slug?: string
  description: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}

/**
 * Subcategory type matching PocketBase collection schema
 */
export interface Subcategory {
  id: string
  name: string
  slug?: string
  category: string // Category ID
  description: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}

export interface ProductMedia {
  original_url: string
  thumb_url?: string
  preview_url?: string
  og_image_url?: string
  alt_text?: string
  sort_order: number
  processing_status: 'pending' | 'processed' | 'failed'
}

/**
 * Product type used by the admin UI. It preserves legacy field names consumed
 * by existing components while exposing Rails CRM fields used by edit forms.
 */
export interface Product {
  id: string
  productId: string
  external_id?: string
  sku?: string
  slug?: string
  name: string
  description: string
  price: number
  price_cents?: number
  price_on_request?: boolean
  status: 'draft' | 'active' | 'hidden' | 'archived' | 'inactive'
  brand: string | string[] // Brand ID or array of IDs
  category: string // Category ID
  subcategory: string // Subcategory ID
  photos: string[] // Array of photo filenames
  media?: ProductMedia[]
  photos_processed: boolean
  gender: string
  thumb: string
  fulfillment_mode?: 'ready_to_ship' | 'requires_confirmation' | 'made_to_order'
  availability_confidence?: 'unknown' | 'low' | 'medium' | 'high'
  indexing_status?: 'indexable' | 'noindex' | 'needs_review' | 'thin_content' | 'duplicate'
  currency?: 'RUB'
  production_min_days?: number | null
  production_max_days?: number | null
  office_delivery_min_days?: number | null
  office_delivery_max_days?: number | null
  seo_title?: string
  seo_description?: string
  h1?: string
  canonical_url?: string
  metadata?: Record<string, any>
  created: string
  updated: string
  collectionId: string
  collectionName: string
  // Expanded relations (when using expand parameter)
  expand?: {
    brand?: Brand | Brand[]
    category?: Category
    subcategory?: Subcategory
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
  subcategory: string
  gender: string
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
  Subcategory: 'subcategories',
} as const

export type CollectionName = typeof Collections[keyof typeof Collections]

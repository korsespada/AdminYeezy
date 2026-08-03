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

export interface CatalogSlugFacet {
  slug: string
  name?: string
  count: number
}

export interface CatalogValueFacet {
  value: string | null
  count: number
}

export interface ProductFilterFacets {
  brandFacets: CatalogSlugFacet[]
  supplierFacets?: CatalogSlugFacet[]
  categoryFacets: CatalogSlugFacet[]
  subcategoryFacets: CatalogSlugFacet[]
  genderFacets: CatalogValueFacet[]
  attributeFacets?: Record<string, CatalogValueFacet[]>
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

export interface ProductSupplier {
  id: string
  name: string
  avatar_url?: string | null
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
  seo_article?: string
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
  supplier?: ProductSupplier | null
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
  published_at?: string | null
  /** Structured catalog attributes from Rails; `attributes` is a compatibility alias. */
  catalog_attributes?: Record<string, any>
  attributes?: Record<string, any>
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

export interface SeoAiSetting {
  id?: string
  task_key: string
  provider: 'byesu' | 'openrouter' | 'cockpit'
  model: string
  temperature: number
  max_tokens: number
  system_prompt: string
  user_prompt_template: string
  enabled: boolean
}

export interface SeoAiGeneration {
  id: string
  target_type: 'Product' | 'Brand' | 'Category' | 'SeoLanding' | 'LandingIdea'
  target_id?: string | null
  target_label?: string | null
  draft_type: 'product' | 'brand' | 'category' | 'landing_ideas'
  status: 'queued' | 'processing' | 'draft' | 'applied' | 'rejected' | 'failed' | 'canceled'
  input_snapshot: Record<string, any>
  text_result: Record<string, any>
  vision_result: Record<string, any>
  output: Record<string, any>
  prompt_snapshot: Record<string, any>
  model_snapshot: Record<string, any>
  error_message?: string | null
  attempt_count?: number
  progress_stage?: string | null
  cancel_requested?: boolean
  lease_expires_at?: string | null
  completed_at?: string | null
  batch_id?: string | null
  created_at: string
  updated_at: string
  applied_at?: string | null
}

export interface SeoAiBatch {
  id: string
  name: string
  target_type: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'
  ids: string[]
  brand?: string | null
  category?: string | null
  subcategory?: string | null
  gender?: string | null
  target_status?: string | null
  missing_seo_only: boolean
  include_processed?: boolean
  include_images: boolean
  auto_apply?: boolean
  item_limit: number
  concurrency?: number
  total_count: number
  success_count: number
  failure_count: number
  started_at?: string | null
  completed_at?: string | null
  error_message?: string | null
  created_at: string
  updated_at: string
  summary?: SeoAiBatchSummary
}

export interface SeoAiBatchSummary {
  status_counts: Record<string, number>
  field_counts: Record<string, number>
  problem_counts: {
    low_confidence: number
    conflicts: number
    quality_warnings: number
    subcategory: number
    invalid_attributes: number
  }
  safe_count: number
  attention_count: number
}

export interface SeoAiBatchPreview {
  total_count: number
  brands: Array<{ id: string; name: string; count: number }>
  categories: Array<{ id: string; name: string; count: number }>
  subcategories: Array<{ id: string; name: string; category_id: string; count: number }>
  genders: Array<{ value: string; count: number }>
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

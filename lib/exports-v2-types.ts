export type V2AlbumRole =
  | 'UNASSIGNED'
  | 'PRIMARY_MEDIA'
  | 'ON_MODEL'
  | 'MEDIA_WITH_TEXT'
  | 'EXTRA_MEDIA'
  | 'TEXT_ONLY'
  | 'SIZE_CHART'
  | 'COMPARISON_OR_AD'
  | 'IGNORE'

export interface V2HistoricalSource {
  task_id: number
  batch_id: string | null
  supplier_id: number
  supplier_name: string
  supplier_avatar: string | null
  items_count: number
  created_at: string
  file_name: string
  script_name: string | null
  already_imported_run_id: string | null
}

export interface V2RunSummary {
  id: string
  name: string
  status: string
  supplier_id: number
  supplier_name: string
  supplier_avatar: string | null
  album_count: number
  assigned_count: number
  draft_count: number
  training_example_count: number
  source_kind: string
  source_task_id: number | null
  production_push_enabled: boolean
  last_started_at: string | null
  last_completed_at: string | null
  last_error: string | null
  last_received_count: number
  last_inserted_count: number
  last_updated_count: number
  last_unchanged_count: number
  created_at: string
}

export interface V2SupplierSource {
  id: number
  name: string
  avatar_url: string | null
  album_id: string
  group_id: string | null
  tag_id: string | null
}

export interface V2Album {
  id: string
  external_id: string
  source_order: number
  source_page: number | null
  page_position: number | null
  name: string
  description: string
  photos: string[]
  media: Array<{
    type: 'image' | 'video'
    url: string
    preview_url: string
  }>
  draft_id: string | null
  draft_sort_order: number | null
  role: V2AlbumRole | null
  use_text: boolean | null
  use_media: boolean | null
  use_photos: boolean | null
  use_for_ai: boolean | null
}

export interface V2DraftAlbum extends V2Album {
  draft_sort_order: number
  role: V2AlbumRole
  use_text: boolean
  use_media: boolean
  use_photos: boolean
  use_for_ai: boolean
}

export interface V2Draft {
  id: string
  status: string
  name: string
  origin: 'MANUAL' | 'AI'
  ai_confidence: number | null
  ai_group_reason: string
  ai_product: Record<string, any> | null
  ai_usage: Record<string, any>
  external_id: string | null
  pushed_product_id: string | null
  pushed_at: string | null
  created_at: string
  albums: V2DraftAlbum[]
}

export interface V2RunDetails extends V2RunSummary {
  source_batch_id: string | null
  max_on_model_media: number
  ai_instructions: string
  ai_cache_enabled: boolean
  ai_photo_enabled: boolean
  post_process_script: string | null
  post_process_description: string
  grouping_model: string
  product_model: string
  catalog_lookups: {
    brands: Array<{ id: string; name: string }>
    categories: Array<{ id: string; name: string }>
    subcategories: Array<{ id: string; name: string; parent_id: string | null }>
  }
  total_albums: number
  page: number
  per_page: number
  albums: V2Album[]
  drafts: V2Draft[]
}

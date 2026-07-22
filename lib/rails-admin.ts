import {
  type Brand,
  type CatalogSlugFacet,
  type CatalogValueFacet,
  type Category,
  type Product,
  type ProductFilterFacets,
  type ProductMedia,
  type SeoAiBatch,
  type SeoAiGeneration,
  type SeoAiSetting,
  type Subcategory,
} from './types'
import { cookies } from 'next/headers'
import { ADMIN_TOKEN_COOKIE } from './admin-session'
import { isPriceCentsOnRequest, isPriceOnRequest } from './product-pricing'

let cachedRailsAdminToken: { token: string; expiresAt: number } | null = null
const ADMIN_PRODUCTS_PAGE_CHUNK_SIZE = 40
const CATALOG_PRODUCTS_PAGE_CHUNK_SIZE = 40

export interface RailsCrmCustomer {
  id?: number | string
  display_name?: string | null
  email?: string | null
  phone?: string | null
  telegram_username?: string | null
  preferred_contact_channel?: string | null
}

export interface RailsCrmOrder {
  id: number | string
  public_number: string
  status: string
  currency?: string
  total_cents?: number
  paid_at?: string | null
  created_at?: string
  customer?: RailsCrmCustomer | null
  item_counts?: Record<string, number>
}

export interface RailsCrmRefund {
  id: number | string
  order_id?: number | string
  order_public_number?: string
  order_item_id?: number | string | null
  order_item_public_number?: string | null
  status: string
  target?: string
  reason?: string
  amount_cents?: number
  currency?: string
  created_at?: string
}

export interface RailsCrmWalletWithdrawal {
  id: number | string
  customer_name?: string
  amount_cents?: number
  currency?: string
  status: string
  created_at?: string
}

export interface RailsCrmListResult<T> {
  items: T[]
  totalItems: number
  totalPages: number
}

export interface RailsCatalogAttributeSuggestion {
  id: string
  attribute_code: string
  raw_value: string
  normalized_value: Record<string, any>
  source: string
  evidence?: string | null
  confidence: number
  status: 'suggested' | 'approved' | 'rejected'
  extractor_version: string
  public_filter?: boolean
  current_value?: Record<string, any> | null
  product: {
    id: string
    slug: string
    name: string
    image_url?: string | null
    brand?: { id: string; name: string; slug: string } | null
    category?: { id: string; name: string; slug: string } | null
  }
  reviewed_by_id?: string | null
  reviewed_at?: string | null
  created_at: string
  updated_at: string
}

export interface RailsCatalogAttributeSuggestionList {
  items: RailsCatalogAttributeSuggestion[]
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  availableValues?: Array<{ value: string; label: string; count: number }>
}

export interface RailsCrmCustomerSummary {
  id: number | string
  display_name?: string | null
  email?: string | null
  phone?: string | null
  telegram_id?: string | null
  telegram_username?: string | null
  country?: string
  preferred_contact_channel?: string
  referral_code?: string
  created_at?: string
  order_count: number
  last_order_at?: string | null
  wallet_cash_cents: number
  wallet_bonus_cents: number
  wallet_total_cents: number
}

export interface RailsTelegramNotificationRecipient {
  id: string
  telegram_id: string
  label?: string | null
  notify_new_orders: boolean
  notify_new_customers: boolean
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface RailsCrmSupplierRequest {
  id: number | string
  supplier_id?: number | string
  supplier_name?: string
  request_type?: string
  status: string
  message_text?: string | null
  sent_at?: string | null
  answered_at?: string | null
  sla_deadline_at?: string | null
  overdue?: boolean
  responses?: RailsCrmSupplierResponse[]
}

export interface RailsCrmSupplierResponse {
  id: number | string
  response_type: string
  message_text?: string | null
  price_cents?: number | null
  created_at?: string
}

export interface RailsCrmReplacementOffer {
  id: number | string
  order_item_id?: number | string
  status: string
  message?: string | null
  price_difference_cents?: number | null
  expires_at?: string | null
  replacement_product?: {
    id: number | string
    name?: string
    slug?: string
    price_cents?: number
    image_url?: string | null
  }
  replacement_variant?: {
    id: number | string
    size?: string
    sku?: string
    price_cents?: number
  } | null
}

export interface RailsCrmOrderItem {
  id: number | string
  public_number: string
  title: string
  image_url?: string | null
  size?: string | null
  sku?: string | null
  fulfillment_mode: string
  status: string
  public_status?: string
  public_message?: string
  quantity: number
  unit_price_cents: number
  total_price_cents: number
  production_min_days?: number | null
  production_max_days?: number | null
  supplier?: {
    id: number | string
    name?: string
    wechat_name?: string | null
  } | null
  metadata?: Record<string, any>
  replacement_offers?: RailsCrmReplacementOffer[]
  supplier_requests?: RailsCrmSupplierRequest[]
}

export interface RailsCrmPayment {
  id: number | string
  provider?: string
  status: string
  public_status?: string
  amount_cents?: number
  currency?: string
  payment_method?: string | null
  created_at?: string
}

export interface RailsCrmOrderEvent {
  id: number | string
  event_type: string
  from_status?: string | null
  to_status?: string | null
  message?: string | null
  actor_type?: string | null
  actor_id?: number | string | null
  order_item_id?: number | string | null
  created_at?: string
}

export interface RailsCrmOrderDetail extends RailsCrmOrder {
  public_status?: string
  public_message?: string
  next_step?: string
  subtotal_cents?: number
  delivery_cents?: number
  discount_cents?: number
  wallet_spent_cents?: number
  admin_comment?: string | null
  customer_comment?: string | null
  checkout?: {
    delivery_method?: string
    delivery_pricing?: string
    full_name?: string
    email?: string
    phone?: string
    city?: string
    address_line?: string
    postal_code?: string
    delivery_comment?: string
  }
  cancelled_at?: string | null
  delivered_at?: string | null
  items: RailsCrmOrderItem[]
  payments: RailsCrmPayment[]
  refunds: RailsCrmRefund[]
  timeline: RailsCrmOrderEvent[]
}

export interface RailsCrmReplacementProductOption {
  id: number | string
  name: string
  slug?: string
  sku?: string | null
  status?: string
  price_cents?: number
  currency?: string
  image_url?: string | null
  brand?: {
    id?: number | string
    name?: string
    slug?: string
  } | null
  variants?: Array<{
    id: number | string
    sku?: string | null
    size?: string | null
    color?: string | null
    price_cents?: number | null
    status?: string
  }>
}

function railsApiUrl(pathname: string) {
  const rawBase = process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL
  if (!rawBase) throw new Error('RAILS_API_URL or VITE_API_URL is required')

  let base = rawBase.replace(/\/+$/, '')
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

function jwtExpiresAt(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf-8'))
    return Number(payload.exp || 0) * 1000
  } catch {
    return 0
  }
}

async function railsAdminToken() {
  try {
    const cookieToken = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value
    if (cookieToken) return cookieToken
  } catch {
    // Server actions and server components have request cookies; tests and
    // background scripts fall back to env credentials below.
  }

  const staticToken = process.env.RAILS_ADMIN_TOKEN || process.env.ADMIN_RAILS_TOKEN
  if (staticToken) return staticToken

  if (cachedRailsAdminToken && cachedRailsAdminToken.expiresAt > Date.now() + 60_000) {
    return cachedRailsAdminToken.token
  }

  const localCredentialsAllowed = process.env.NODE_ENV !== 'production'
  const email = process.env.RAILS_ADMIN_EMAIL?.trim() ||
    (localCredentialsAllowed ? process.env.LOCAL_ADMIN_EMAIL?.trim() : undefined)
  const password = process.env.RAILS_ADMIN_PASSWORD?.trim() ||
    (localCredentialsAllowed ? process.env.LOCAL_ADMIN_PASSWORD?.trim() : undefined)
  if (!email || !password) {
    throw new Error(
      localCredentialsAllowed
        ? 'RAILS_ADMIN_EMAIL/RAILS_ADMIN_PASSWORD or LOCAL_ADMIN_EMAIL/LOCAL_ADMIN_PASSWORD are required'
        : 'RAILS_ADMIN_EMAIL and RAILS_ADMIN_PASSWORD are required'
    )
  }

  const response = await fetch(railsApiUrl('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) {
    throw new Error(payload.message || payload.error || `Rails admin login failed with ${response.status}`)
  }

  cachedRailsAdminToken = {
    token: payload.token,
    expiresAt: jwtExpiresAt(payload.token) || Date.now() + 60 * 60 * 1000,
  }
  return cachedRailsAdminToken.token
}

function mapRailsGenderToUi(gender: string) {
  if (gender === 'male') return 'Для мужчин'
  if (gender === 'female') return 'Для женщин'
  if (gender === 'unisex') return 'Унисекс'
  return gender
}

function mapUiGenderToRails(gender: string) {
  if (gender === 'Для мужчин' || gender === 'male') return 'male'
  if (gender === 'Для женщин' || gender === 'female') return 'female'
  if (gender === 'Унисекс' || gender === 'unisex') return 'unisex'
  return ''
}

async function railsFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const token = await railsAdminToken()
  const response = await fetch(railsApiUrl(pathname), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Rails API failed with ${response.status}`)
  }
  return payload as T
}

function openRouterRuntimeKeyPayload() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  return apiKey ? { openrouter_api_key: apiKey } : {}
}

async function publicRailsFetch<T>(pathname: string): Promise<T> {
  const response = await fetch(railsApiUrl(pathname), { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || `Rails API failed with ${response.status}`)
  return payload as T
}

function mapBrand(brand: any): Brand {
  return {
    id: String(brand.id),
    name: brand.name || '',
    slug: brand.slug || '',
    description: brand.description || '',
    created: brand.created_at || '',
    updated: brand.updated_at || '',
    collectionId: '',
    collectionName: 'brands',
  }
}

function flattenCategories(items: any[], parentId = ''): { categories: Category[]; subcategories: Subcategory[] } {
  const categories: Category[] = []
  const subcategories: Subcategory[] = []

  for (const item of items || []) {
    const mapped = {
      id: String(item.id),
      name: item.name || '',
      slug: item.slug || '',
      description: item.description || '',
      created: item.created_at || '',
      updated: item.updated_at || '',
      collectionId: '',
      collectionName: parentId ? 'subcategories' : 'categories',
    }

    if (parentId) {
      subcategories.push({ ...mapped, category: parentId })
    } else {
      categories.push(mapped)
    }

    const nested = flattenCategories(item.children || [], String(item.id))
    categories.push(...nested.categories)
    subcategories.push(...nested.subcategories)
  }

  return { categories, subcategories }
}

function normalizeRailsMedia(product: any): ProductMedia[] {
  const rawMedia = Array.isArray(product.media) ? product.media : []
  if (rawMedia.length > 0) {
    return rawMedia
      .filter((item: any) => item?.original_url || item?.preview_url || item?.thumb_url)
      .map((item: any, index: number) => ({
        original_url: String(item.original_url || item.preview_url || item.thumb_url || ''),
        thumb_url: item.thumb_url || item.preview_url || item.original_url || '',
        preview_url: item.preview_url || item.original_url || item.thumb_url || '',
        og_image_url: item.og_image_url || item.preview_url || item.original_url || '',
        alt_text: item.alt_text || '',
        sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
        processing_status: ['pending', 'processed', 'failed'].includes(String(item.processing_status))
          ? item.processing_status
          : 'processed',
      }))
      .sort((a: ProductMedia, b: ProductMedia) => a.sort_order - b.sort_order)
  }

  const urls = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : (product.image_url ? [product.image_url] : [])

  return urls.map((url: string, index: number) => ({
    original_url: String(url),
    thumb_url: String(url),
    preview_url: String(url),
    og_image_url: String(url),
    alt_text: product.name || '',
    sort_order: index,
    processing_status: 'processed',
  }))
}

export function mapRailsProduct(product: any): Product {
  const category = product.category || {}
  const categoryId = category.parent_id ? String(category.parent_id) : String(category.id || '')
  const subcategoryId = category.parent_id ? String(category.id || '') : ''
  const media = normalizeRailsMedia(product)
  const photos = media.map((item) => item.preview_url || item.original_url).filter(Boolean)
  const priceCents = Number(product.price_cents || 0)
  const priceOnRequest = isPriceCentsOnRequest(priceCents)
  const metadata = {
    ...(product.metadata && typeof product.metadata === 'object' ? product.metadata : {}),
    price_on_request: priceOnRequest,
  }
  const catalogAttributes = product.catalog_attributes && typeof product.catalog_attributes === 'object'
    ? product.catalog_attributes
    : (product.attributes && typeof product.attributes === 'object' ? product.attributes : {})

  return {
    id: String(product.id),
    productId: product.external_id || product.sku || String(product.id),
    external_id: product.external_id || '',
    sku: product.sku || '',
    slug: product.slug || '',
    name: product.name || '',
    description: product.description || '',
    price: priceCents / 100,
    price_cents: priceCents,
    price_on_request: priceOnRequest,
    status: ['draft', 'active', 'hidden', 'archived'].includes(String(product.status)) ? product.status : 'hidden',
    brand: product.brand?.id ? String(product.brand.id) : '',
    category: categoryId,
    subcategory: subcategoryId,
    photos,
    media,
    photos_processed: true,
    gender: mapRailsGenderToUi(product.gender || metadata.gender || ''),
    thumb: product.image_url || photos[0] || '',
    fulfillment_mode: product.fulfillment_mode || 'requires_confirmation',
    availability_confidence: product.availability_confidence || 'unknown',
    indexing_status: product.indexing_status || 'indexable',
    currency: product.currency || 'RUB',
    production_min_days: product.production_min_days ?? null,
    production_max_days: product.production_max_days ?? null,
    office_delivery_min_days: product.office_delivery_min_days ?? null,
    office_delivery_max_days: product.office_delivery_max_days ?? null,
    seo_title: product.seo_title || '',
    seo_description: product.seo_description || '',
    h1: product.h1 || '',
    canonical_url: product.canonical_url || '',
    metadata,
    catalog_attributes: catalogAttributes,
    attributes: catalogAttributes,
    created: product.created_at || '',
    updated: product.updated_at || '',
    collectionId: '',
    collectionName: 'products',
    expand: {
      brand: product.brand ? mapBrand(product.brand) : undefined,
      category: category.id ? {
        id: categoryId || String(category.id),
        name: category.parent_id ? '' : category.name,
        slug: category.parent_id ? '' : category.slug || '',
        description: '',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: 'categories',
      } : undefined,
      subcategory: subcategoryId ? {
        id: subcategoryId,
        name: category.name || '',
        slug: category.slug || '',
        category: categoryId,
        description: '',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: 'subcategories',
      } : undefined,
    },
  }
}

export async function getRailsCatalogLookups() {
  const [brandsPayload, categoriesPayload] = await Promise.all([
    publicRailsFetch<{ brands: any[] }>('/catalog/brands'),
    publicRailsFetch<{ categories: any[] }>('/catalog/categories'),
  ])
  const { categories, subcategories } = flattenCategories(categoriesPayload.categories || [])

  return {
    brands: (brandsPayload.brands || []).map(mapBrand),
    categories,
    subcategories,
  }
}

export async function listRailsAdminProducts(options: {
  page: number
  perPage: number
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  genderExact?: boolean
  status?: Product['status']
  noGender?: boolean
  attributeKey?: string
  attributeValue?: string
}) {
  if ((options.brand || options.category || options.subcategory || options.gender || options.noGender) && !options.status) {
    return listRailsCatalogProducts(options)
  }

  if (options.perPage > ADMIN_PRODUCTS_PAGE_CHUNK_SIZE) {
    return listRailsAdminProductsInChunks(options)
  }

  const params = buildRailsAdminProductsParams(options)
  const payload = await railsFetch<{ products: any[]; meta: { total: number; pages: number } }>(`/admin/products?${params}`)
  const products = (payload.products || []).map(mapRailsProduct)

  return {
    products: options.status ? products : products.filter((product) => product.status !== 'archived'),
    totalItems: Number(payload.meta?.total || 0),
    totalPages: Number(payload.meta?.pages || 0),
  }
}

async function listRailsCatalogProducts(options: {
  page: number
  perPage: number
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  genderExact?: boolean
  genderMissing?: boolean
  attributeKey?: string
  attributeValue?: string
}) {
  if (options.perPage > CATALOG_PRODUCTS_PAGE_CHUNK_SIZE) {
    return listRailsCatalogProductsInChunks(options)
  }

  const params = buildRailsAdminProductsParams(options)
  const payload = await publicRailsFetch<{ products: any[]; meta: { total: number; pages: number } }>(`/catalog/products?${params}`)
  const products = (payload.products || []).map(mapRailsProduct)

  return {
    products: products.filter((product) => product.status !== 'archived'),
    totalItems: Number(payload.meta?.total || 0),
    totalPages: Number(payload.meta?.pages || 0),
  }
}

async function listRailsCatalogProductsInChunks(options: {
  page: number
  perPage: number
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  genderExact?: boolean
  genderMissing?: boolean
}) {
  const requestedOffset = (options.page - 1) * options.perPage
  const firstSourcePage = Math.floor(requestedOffset / CATALOG_PRODUCTS_PAGE_CHUNK_SIZE) + 1
  const firstPageSkip = requestedOffset % CATALOG_PRODUCTS_PAGE_CHUNK_SIZE
  const products: Product[] = []
  let sourcePage = firstSourcePage
  let sourcePages = firstSourcePage
  let totalItems = 0

  while (sourcePage <= sourcePages && products.length < options.perPage) {
    const params = buildRailsAdminProductsParams({
      ...options,
      page: sourcePage,
      perPage: CATALOG_PRODUCTS_PAGE_CHUNK_SIZE,
    })
    const payload = await publicRailsFetch<{ products: any[]; meta: { total: number; pages: number } }>(`/catalog/products?${params}`)

    if (sourcePage === firstSourcePage) {
      totalItems = Number(payload.meta?.total || 0)
      sourcePages = Number(payload.meta?.pages || Math.ceil(totalItems / CATALOG_PRODUCTS_PAGE_CHUNK_SIZE) || firstSourcePage)
    }

    const pageProducts = (payload.products || []).map(mapRailsProduct).filter((product) => product.status !== 'archived')
    products.push(...(sourcePage === firstSourcePage ? pageProducts.slice(firstPageSkip) : pageProducts))
    sourcePage += 1
  }

  return {
    products: products.slice(0, options.perPage),
    totalItems,
    totalPages: Math.ceil(totalItems / options.perPage),
  }
}

async function listRailsAdminProductsInChunks(options: {
  page: number
  perPage: number
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  genderExact?: boolean
  status?: Product['status']
}) {
  const requestedOffset = (options.page - 1) * options.perPage
  const firstSourcePage = Math.floor(requestedOffset / ADMIN_PRODUCTS_PAGE_CHUNK_SIZE) + 1
  const firstPageSkip = requestedOffset % ADMIN_PRODUCTS_PAGE_CHUNK_SIZE
  const products: Product[] = []
  let sourcePage = firstSourcePage
  let sourcePages = firstSourcePage
  let totalItems = 0

  while (sourcePage <= sourcePages && products.length < options.perPage) {
    const params = buildRailsAdminProductsParams({
      ...options,
      page: sourcePage,
      perPage: ADMIN_PRODUCTS_PAGE_CHUNK_SIZE,
    })
    const payload = await railsFetch<{ products: any[]; meta: { total: number; pages: number } }>(`/admin/products?${params}`)

    if (sourcePage === firstSourcePage) {
      totalItems = Number(payload.meta?.total || 0)
      sourcePages = Number(payload.meta?.pages || Math.ceil(totalItems / ADMIN_PRODUCTS_PAGE_CHUNK_SIZE) || firstSourcePage)
    }

    const pageProducts = (payload.products || []).map(mapRailsProduct)
    products.push(...(sourcePage === firstSourcePage ? pageProducts.slice(firstPageSkip) : pageProducts))
    sourcePage += 1
  }

  const visibleProducts = products
    .slice(0, options.perPage)
    .filter((product) => options.status ? true : product.status !== 'archived')

  return {
    products: visibleProducts,
    totalItems,
    totalPages: Math.ceil(totalItems / options.perPage),
  }
}

export async function searchRailsAdminProductsExact(search: string, statuses: Product['status'][] = ['active', 'hidden', 'draft']) {
  const products: Product[] = []

  for (const status of statuses) {
    const params = buildRailsAdminProductsParams({
      page: 1,
      perPage: 20,
      search,
      status,
    })
    const payload = await railsFetch<{ products: any[] }>(`/admin/products?${params}`)
    products.push(...(payload.products || []).map(mapRailsProduct))
  }

  return products
}

export async function getRailsAdminProduct(id: string) {
  const result = await railsFetch<{ product: any }>(`/admin/products/${id}`)
  return mapRailsProduct(result.product)
}

export async function listRailsCrmOrders(options: {
  page?: number
  perPage?: number
  search?: string
  status?: string
  queue?: 'paid' | 'problem' | 'refund' | 'production' | string
} = {}): Promise<RailsCrmListResult<RailsCrmOrder>> {
  const params = new URLSearchParams()
  params.set('page', String(options.page || 1))
  params.set('per_page', String(options.perPage || 20))
  if (options.search?.trim()) params.set('q', options.search.trim())
  if (options.status) params.set('status', options.status)
  if (options.queue) params.set('queue', options.queue)

  const result = await railsFetch<{ orders: RailsCrmOrder[]; meta?: { total?: number; pages?: number } }>(`/admin/orders?${params}`)

  return {
    items: result.orders || [],
    totalItems: Number(result.meta?.total || 0),
    totalPages: Number(result.meta?.pages || 0),
  }
}

export async function getRailsCrmOrder(id: string): Promise<RailsCrmOrderDetail> {
  const result = await railsFetch<{ order: RailsCrmOrderDetail }>(`/admin/orders/${encodeURIComponent(id)}`)
  return result.order
}

export async function transitionRailsCrmOrder(id: string, input: {
  toStatus: string
  message?: string
}) {
  const result = await railsFetch<{ order: RailsCrmOrderDetail }>(`/admin/orders/${encodeURIComponent(id)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({
      to_status: input.toStatus,
      message: input.message || '',
    }),
  })
  return result.order
}

export async function transitionRailsCrmOrderItem(id: string, input: {
  toStatus: string
  message?: string
}) {
  const result = await railsFetch<{ item: RailsCrmOrderItem }>(`/admin/order_items/${encodeURIComponent(id)}/transitions`, {
    method: 'POST',
    body: JSON.stringify({
      to_status: input.toStatus,
      message: input.message || '',
    }),
  })
  return result.item
}

export async function createRailsCrmSupplierRequest(itemId: string, input: {
  supplierId?: string
  requestType?: string
  messageText?: string
  slaHours?: number
}) {
  const result = await railsFetch<{ supplier_request: RailsCrmSupplierRequest }>(
    `/admin/order_items/${encodeURIComponent(itemId)}/supplier_requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        supplier_id: input.supplierId || '',
        request_type: input.requestType || 'availability',
        message_text: input.messageText || '',
        sla_hours: input.slaHours || 6,
      }),
    }
  )
  return result.supplier_request
}

export async function recordRailsCrmSupplierResponse(requestId: string, input: {
  responseType: string
  messageText?: string
  priceCents?: number | null
}) {
  const result = await railsFetch<{ supplier_response: RailsCrmSupplierResponse }>(
    `/admin/supplier_requests/${encodeURIComponent(requestId)}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({
        response_type: input.responseType,
        message_text: input.messageText || '',
        price_cents: input.priceCents ?? null,
      }),
    }
  )
  return result.supplier_response
}

export async function createRailsCrmReplacementOffer(itemId: string, input: {
  replacementProductId: string
  replacementVariantId?: string
  message?: string
  expiresAt?: string
}) {
  const result = await railsFetch<{ replacement_offers: RailsCrmReplacementOffer[] }>(
    `/admin/order_items/${encodeURIComponent(itemId)}/replacement_offers`,
    {
      method: 'POST',
      body: JSON.stringify({
        offers: [{
          replacement_product_id: input.replacementProductId,
          replacement_variant_id: input.replacementVariantId || '',
          message: input.message || '',
          expires_at: input.expiresAt || '',
        }],
      }),
    }
  )
  return result.replacement_offers
}

export async function searchRailsCrmReplacementProducts(options: {
  search: string
  limit?: number
}): Promise<RailsCrmReplacementProductOption[]> {
  const search = options.search.trim()
  if (!search) return []

  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('per_page', String(options.limit || 8))
  params.set('q', search)
  params.set('status', 'active')

  const result = await railsFetch<{ products: RailsCrmReplacementProductOption[] }>(`/admin/products?${params}`)
  return result.products || []
}

export async function listRailsCrmRefunds(options: {
  page?: number
  perPage?: number
  status?: string
  target?: string
} = {}): Promise<RailsCrmListResult<RailsCrmRefund>> {
  const params = new URLSearchParams()
  params.set('page', String(options.page || 1))
  params.set('per_page', String(options.perPage || 20))
  if (options.status) params.set('status', options.status)
  if (options.target) params.set('target', options.target)

  const result = await railsFetch<{ refunds: RailsCrmRefund[]; meta?: { total?: number; pages?: number } }>(`/admin/refunds?${params}`)

  return {
    items: result.refunds || [],
    totalItems: Number(result.meta?.total || 0),
    totalPages: Number(result.meta?.pages || 0),
  }
}

export async function listRailsCrmWalletWithdrawals(options: {
  status?: string
} = {}): Promise<RailsCrmListResult<RailsCrmWalletWithdrawal>> {
  const params = new URLSearchParams()
  if (options.status) params.set('status', options.status)

  const suffix = params.toString() ? `?${params}` : ''
  const result = await railsFetch<{ wallet_withdrawal_requests: RailsCrmWalletWithdrawal[] }>(`/admin/wallet_withdrawal_requests${suffix}`)
  const items = result.wallet_withdrawal_requests || []

  return {
    items,
    totalItems: items.length,
    totalPages: 1,
  }
}

export async function listRailsCrmCustomers(options: {
  page?: number
  perPage?: number
  search?: string
} = {}): Promise<RailsCrmListResult<RailsCrmCustomerSummary>> {
  const params = new URLSearchParams()
  params.set('page', String(options.page || 1))
  params.set('per_page', String(options.perPage || 30))
  if (options.search?.trim()) params.set('q', options.search.trim())

  const result = await railsFetch<{
    customers: RailsCrmCustomerSummary[]
    meta?: { total?: number; pages?: number }
  }>(`/admin/customers?${params}`)

  return {
    items: result.customers || [],
    totalItems: Number(result.meta?.total || 0),
    totalPages: Number(result.meta?.pages || 0),
  }
}

export async function listRailsTelegramNotificationRecipients(): Promise<RailsTelegramNotificationRecipient[]> {
  const result = await railsFetch<{ recipients: RailsTelegramNotificationRecipient[] }>(
    '/admin/telegram_notification_recipients'
  )
  return result.recipients || []
}

export async function createRailsTelegramNotificationRecipient(input: {
  telegramId: string
  label?: string
  notifyNewOrders: boolean
  notifyNewCustomers: boolean
  isActive: boolean
}) {
  const result = await railsFetch<{ recipient: RailsTelegramNotificationRecipient }>(
    '/admin/telegram_notification_recipients',
    {
      method: 'POST',
      body: JSON.stringify({
        telegram_id: input.telegramId,
        label: input.label || '',
        notify_new_orders: input.notifyNewOrders,
        notify_new_customers: input.notifyNewCustomers,
        is_active: input.isActive,
      }),
    }
  )
  return result.recipient
}

export async function updateRailsTelegramNotificationRecipient(
  id: string,
  input: {
    telegramId: string
    label?: string
    notifyNewOrders: boolean
    notifyNewCustomers: boolean
    isActive: boolean
  }
) {
  const result = await railsFetch<{ recipient: RailsTelegramNotificationRecipient }>(
    `/admin/telegram_notification_recipients/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        telegram_id: input.telegramId,
        label: input.label || '',
        notify_new_orders: input.notifyNewOrders,
        notify_new_customers: input.notifyNewCustomers,
        is_active: input.isActive,
      }),
    }
  )
  return result.recipient
}

export async function deleteRailsTelegramNotificationRecipient(id: string) {
  await railsFetch<Record<string, never>>(
    `/admin/telegram_notification_recipients/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
}

export async function testRailsTelegramNotificationRecipient(id: string) {
  await railsFetch<{ delivered: boolean }>(
    `/admin/telegram_notification_recipients/${encodeURIComponent(id)}/test_delivery`,
    { method: 'POST' }
  )
}

export async function approveRailsCrmRefund(id: string) {
  const result = await railsFetch<{ refund: RailsCrmRefund }>(`/admin/refunds/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })
  return result.refund
}

export async function rejectRailsCrmRefund(id: string, message?: string) {
  const result = await railsFetch<{ refund: RailsCrmRefund }>(`/admin/refunds/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ message: message || '' }),
  })
  return result.refund
}

export async function approveRailsCrmWalletWithdrawal(id: string) {
  const result = await railsFetch<{ wallet_withdrawal_request: RailsCrmWalletWithdrawal }>(
    `/admin/wallet_withdrawal_requests/${encodeURIComponent(id)}/approve`,
    { method: 'POST' }
  )
  return result.wallet_withdrawal_request
}

export async function rejectRailsCrmWalletWithdrawal(id: string, message?: string) {
  const result = await railsFetch<{ wallet_withdrawal_request: RailsCrmWalletWithdrawal }>(
    `/admin/wallet_withdrawal_requests/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ message: message || '' }),
    }
  )
  return result.wallet_withdrawal_request
}

export async function markRailsCrmWalletWithdrawalPaid(id: string) {
  const result = await railsFetch<{ wallet_withdrawal_request: RailsCrmWalletWithdrawal }>(
    `/admin/wallet_withdrawal_requests/${encodeURIComponent(id)}/mark_paid`,
    { method: 'POST' }
  )
  return result.wallet_withdrawal_request
}

export async function getRailsSeoAiSettings() {
  const result = await railsFetch<{ settings: SeoAiSetting[] }>('/admin/seo_ai/settings')
  return result.settings
}

export async function updateRailsSeoAiSettings(settings: SeoAiSetting[]) {
  const result = await railsFetch<{ settings: SeoAiSetting[] }>('/admin/seo_ai/settings', {
    method: 'PATCH',
    body: JSON.stringify({ settings }),
  })
  return result.settings
}

export async function listRailsSeoAiDrafts(options: { status?: string; draftType?: string; targetType?: string; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.status) params.set('status', options.status)
  if (options.draftType) params.set('draft_type', options.draftType)
  if (options.targetType) params.set('target_type', options.targetType)
  if (options.limit) params.set('limit', String(options.limit))
  const result = await railsFetch<{ generations: SeoAiGeneration[] }>(`/admin/seo_ai/generations?${params}`)
  return result.generations
}

export async function runRailsSeoAiGeneration(input: {
  targetType: string
  targetId?: string | null
  draftType?: string
  includeImages?: boolean
  imageLimit?: number
}) {
  const result = await railsFetch<{ generation: SeoAiGeneration }>('/admin/seo_ai/generations', {
    method: 'POST',
    body: JSON.stringify({
      ...openRouterRuntimeKeyPayload(),
      generation: {
        target_type: input.targetType,
        target_id: input.targetId,
        draft_type: input.draftType,
        include_images: Boolean(input.includeImages),
        image_limit: input.imageLimit,
      },
    }),
  })
  return result.generation
}

export async function createRailsSeoAiBatch(input: {
  ids?: string[]
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  status?: string
  missingSeoOnly?: boolean
  includeImages?: boolean
}) {
  const result = await railsFetch<{ batch: SeoAiBatch; generations: SeoAiGeneration[] }>('/admin/seo_ai/batches', {
    method: 'POST',
    body: JSON.stringify({
      ...openRouterRuntimeKeyPayload(),
      batch: {
        ids: input.ids || [],
        brand: input.brand || '',
        category: input.category || '',
        subcategory: input.subcategory || '',
        gender: input.gender || '',
        status: input.status || '',
        missing_seo_only: Boolean(input.missingSeoOnly),
        include_images: Boolean(input.includeImages),
      },
    }),
  })
  return result
}

export async function applyRailsSeoAiDraft(id: string, fields?: string[]) {
  const result = await railsFetch<{ generation: SeoAiGeneration; result: any }>(`/admin/seo_ai/generations/${id}/apply`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  })
  return result
}

export async function rejectRailsSeoAiDraft(id: string) {
  const result = await railsFetch<{ generation: SeoAiGeneration }>(`/admin/seo_ai/generations/${id}/reject`, {
    method: 'POST',
  })
  return result.generation
}

export async function listRailsCatalogAttributeSuggestions(options: {
  page?: number
  perPage?: number
  status?: string
  attributeCode?: string
  source?: string
  query?: string
  brand?: string
  category?: string
  subcategory?: string
  suggestedValue?: string
} = {}): Promise<RailsCatalogAttributeSuggestionList> {
  const params = new URLSearchParams()
  params.set('page', String(options.page || 1))
  params.set('per_page', String(options.perPage || 30))
  if (options.status) params.set('status', options.status)
  if (options.attributeCode) params.set('attribute_code', options.attributeCode)
  if (options.source) params.set('source', options.source)
  if (options.query) params.set('query', options.query)
  if (options.brand) params.set('brand', options.brand)
  if (options.category) params.set('category', options.category)
  if (options.subcategory) params.set('subcategory', options.subcategory)
  if (options.suggestedValue) params.set('suggested_value', options.suggestedValue)

  const result = await railsFetch<{
    catalog_attribute_suggestions: RailsCatalogAttributeSuggestion[]
    meta: {
      page: number
      per_page: number
      total: number
      pages: number
      available_values?: Array<{ value: string; label: string; count: number }>
    }
  }>(`/admin/catalog_attribute_suggestions?${params}`)

  return {
    items: result.catalog_attribute_suggestions || [],
    page: Number(result.meta?.page || options.page || 1),
    perPage: Number(result.meta?.per_page || options.perPage || 30),
    totalItems: Number(result.meta?.total || 0),
    totalPages: Number(result.meta?.pages || 0),
    availableValues: result.meta?.available_values || [],
  }
}

export async function approveRailsCatalogAttributeSuggestion(id: string) {
  const result = await railsFetch<{ catalog_attribute_suggestion: RailsCatalogAttributeSuggestion }>(
    `/admin/catalog_attribute_suggestions/${encodeURIComponent(id)}/approve`,
    { method: 'POST' }
  )
  return result.catalog_attribute_suggestion
}

export async function rejectRailsCatalogAttributeSuggestion(id: string) {
  const result = await railsFetch<{ catalog_attribute_suggestion: RailsCatalogAttributeSuggestion }>(
    `/admin/catalog_attribute_suggestions/${encodeURIComponent(id)}/reject`,
    { method: 'POST' }
  )
  return result.catalog_attribute_suggestion
}

export async function updateRailsCatalogAttributeSuggestionValue(id: string, value: string) {
  const result = await railsFetch<{ catalog_attribute_suggestion: RailsCatalogAttributeSuggestion }>(
    `/admin/catalog_attribute_suggestions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ catalog_attribute_suggestion: { value } }),
    }
  )
  return result.catalog_attribute_suggestion
}

export async function bulkApproveRailsCatalogAttributeSuggestions(ids: string[]) {
  return railsFetch<{ reviewed_ids: string[]; status: 'approved' }>(
    '/admin/catalog_attribute_suggestions/bulk_approve',
    { method: 'POST', body: JSON.stringify({ ids }) }
  )
}

export async function bulkApproveFilteredRailsCatalogAttributeSuggestions(options: {
  query?: string
  attributeCode?: string
  source?: string
  brand?: string
  category?: string
  subcategory?: string
  suggestedValue?: string
}) {
  const params = new URLSearchParams()
  if (options.query) params.set('query', options.query)
  if (options.attributeCode) params.set('attribute_code', options.attributeCode)
  if (options.source) params.set('source', options.source)
  if (options.brand) params.set('brand', options.brand)
  if (options.category) params.set('category', options.category)
  if (options.subcategory) params.set('subcategory', options.subcategory)
  if (options.suggestedValue) params.set('suggested_value', options.suggestedValue)
  const suffix = params.size > 0 ? `?${params}` : ''

  return railsFetch<{ approved_count: number; status: 'approved' }>(
    `/admin/catalog_attribute_suggestions/bulk_approve_filtered${suffix}`,
    { method: 'POST' }
  )
}

export async function bulkRejectRailsCatalogAttributeSuggestions(ids: string[]) {
  return railsFetch<{ reviewed_ids: string[]; status: 'rejected' }>(
    '/admin/catalog_attribute_suggestions/bulk_reject',
    { method: 'POST', body: JSON.stringify({ ids }) }
  )
}

export async function aiRefineRailsCatalogAttributeSuggestions(ids: string[]) {
  return railsFetch<{
    catalog_attribute_suggestions: RailsCatalogAttributeSuggestion[]
    processed_products: number
  }>('/admin/catalog_attribute_suggestions/ai_refine', {
    method: 'POST',
    body: JSON.stringify({ ids, ...openRouterRuntimeKeyPayload() }),
  })
}

export async function deleteRailsSeoAiDraft(id: string) {
  await railsFetch(`/admin/seo_ai/generations/${id}`, {
    method: 'DELETE',
  })
}

export async function createRailsSeoAiLandingIdeas(filters: Record<string, any>) {
  const result = await railsFetch<{ generation: SeoAiGeneration }>('/admin/seo_ai/landing_ideas', {
    method: 'POST',
    body: JSON.stringify({ ...openRouterRuntimeKeyPayload(), filters }),
  })
  return result.generation
}

export function buildRailsAdminProductsParams(options: {
  page: number
  perPage: number
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  status?: Product['status']
  noGender?: boolean
  genderMissing?: boolean
  genderExact?: boolean
  attributeKey?: string
  attributeValue?: string
}) {
  const params = new URLSearchParams()
  params.set('page', String(options.page))
  params.set('per_page', String(options.perPage))
  const search = normalizeProductSearchInput(options.search)
  if (search) params.set('q', search)
  const name = options.name?.trim() || ''
  if (name) params.set('name', name)
  const description = options.description?.trim() || ''
  if (description) params.set('description', description)
  const priceMin = normalizePriceRublesFilter(options.priceMin)
  const priceMax = normalizePriceRublesFilter(options.priceMax)
  if (priceMin) params.set('price_min', priceMin)
  if (priceMax) params.set('price_max', priceMax)
  if (options.brand) params.set('brand', options.brand)
  if (options.category || options.subcategory) params.set('category', options.subcategory || options.category || '')
  if (options.genderMissing || options.noGender) {
    params.set('gender_missing', 'true')
  } else if (options.gender) {
    params.set('gender', options.gender)
    if (options.genderExact) params.set('gender_exact', 'true')
  }
  if (options.status) params.set('status', options.status)
  if (options.attributeKey?.trim()) params.set('attribute_key', options.attributeKey.trim())
  if (options.attributeValue?.trim()) params.set('attribute_value', options.attributeValue.trim())
  return params
}

function normalizePriceRublesFilter(value?: string | number) {
  const raw = String(value ?? '').trim().replace(',', '.')
  if (!raw) return ''
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return ''
  return String(Math.round(parsed * 100))
}

export function normalizeProductSearchInput(value?: string) {
  const search = value?.trim() || ''
  if (!search) return ''

  const directPath = extractProductSlugFromPath(search)
  if (directPath) return directPath

  try {
    const url = new URL(search)
    return extractProductSlugFromPath(url.pathname) || search
  } catch {
    return search
  }
}

function extractProductSlugFromPath(value: string) {
  const path = value.split(/[?#]/, 1)[0]
  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const productIndex = segments.findIndex((segment) => segment === 'product' || segment === 'products')
  const slug = productIndex >= 0 ? segments[productIndex + 1] : ''
  if (!slug) return ''

  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}

type ProductFacetFilters = {
  search?: string
  name?: string
  description?: string
  priceMin?: string | number
  priceMax?: string | number
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  genderExact?: boolean
  noGender?: boolean
  attributeKey?: string
  attributeValue?: string
}

type RailsProductFacetPayload = {
  facets?: {
    brands?: CatalogSlugFacet[]
    categories?: CatalogSlugFacet[]
    genders?: CatalogValueFacet[]
  }
  meta?: {
    total?: number
  }
}

async function fetchRailsProductFacets(options: ProductFacetFilters) {
  const params = buildRailsAdminProductsParams({
    ...options,
    page: 1,
    perPage: 1,
    genderMissing: options.noGender,
    gender: options.noGender ? '' : options.gender,
    genderExact: options.genderExact,
    attributeKey: options.attributeKey,
    attributeValue: options.attributeValue,
  })
  return publicRailsFetch<RailsProductFacetPayload>(`/catalog/products?${params}`)
}

export async function getRailsProductFilterFacets(filters: ProductFacetFilters): Promise<ProductFilterFacets> {
  const sharedFilters = {
    search: filters.search,
    name: filters.name,
    description: filters.description,
    priceMin: filters.priceMin,
    priceMax: filters.priceMax,
    attributeKey: filters.attributeKey,
    attributeValue: filters.attributeValue,
  }

  const [brandPayload, categoryPayload, subcategoryPayload, genderPayload, unisexPayload] = await Promise.all([
    fetchRailsProductFacets({
      ...sharedFilters,
      category: filters.category,
      subcategory: filters.subcategory,
      gender: filters.gender,
      genderExact: filters.genderExact,
      noGender: filters.noGender,
    }),
    fetchRailsProductFacets({
      ...sharedFilters,
      brand: filters.brand,
      gender: filters.gender,
      genderExact: filters.genderExact,
      noGender: filters.noGender,
    }),
    fetchRailsProductFacets({
      ...sharedFilters,
      brand: filters.brand,
      category: filters.category,
      gender: filters.gender,
      genderExact: filters.genderExact,
      noGender: filters.noGender,
    }),
    fetchRailsProductFacets({
      ...sharedFilters,
      brand: filters.brand,
      category: filters.category,
      subcategory: filters.subcategory,
    }),
    fetchRailsProductFacets({
      ...sharedFilters,
      brand: filters.brand,
      category: filters.category,
      subcategory: filters.subcategory,
      gender: 'unisex',
    }),
  ])

  const genderFacets = [...(genderPayload.facets?.genders || [])]
  const unisexCount = Number(unisexPayload.meta?.total || 0)
  if (unisexCount > 0 && !genderFacets.some(facet => facet.value === 'unisex')) {
    genderFacets.push({ value: 'unisex', count: unisexCount })
  }

  return {
    brandFacets: brandPayload.facets?.brands || [],
    categoryFacets: categoryPayload.facets?.categories || [],
    subcategoryFacets: subcategoryPayload.facets?.categories || [],
    genderFacets,
  }
}

function parseJsonArray(value: FormDataEntryValue | null): any[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(value: FormDataEntryValue | null): Record<string, any> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function optionalInt(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function formBoolean(value: FormDataEntryValue | null) {
  return String(value || '') === 'true'
}

function normalizeMediaForPayload(formData: FormData) {
  const rawMedia = formData.has('media')
    ? parseJsonArray(formData.get('media'))
    : parseJsonArray(formData.get('existingPhotos')).map((url) => ({ original_url: url }))

  if (!formData.has('media') && !formData.has('existingPhotos')) return undefined

  return rawMedia
    .filter((item) => item && (item.original_url || item.preview_url || item.thumb_url))
    .map((item, index) => {
      const originalUrl = String(item.original_url || item.preview_url || item.thumb_url || '')
      const previewUrl = String(item.preview_url || item.original_url || item.thumb_url || originalUrl)
      const thumbUrl = String(item.thumb_url || previewUrl || originalUrl)
      return {
        original_url: originalUrl,
        thumb_url: thumbUrl,
        preview_url: previewUrl,
        og_image_url: String(item.og_image_url || previewUrl || originalUrl),
        alt_text: String(item.alt_text || ''),
        sort_order: index,
        processing_status: ['pending', 'processed', 'failed'].includes(String(item.processing_status))
          ? String(item.processing_status)
          : 'processed',
      }
    })
}

export function productFormDataToRailsPayload(formData: FormData, options: { applyDefaults?: boolean } = {}) {
  const applyDefaults = options.applyDefaults !== false
  const product: Record<string, any> = {}
  let priceOnRequest: boolean | undefined

  if (formData.has('productId') || formData.has('external_id')) {
    product.external_id = String(formData.get('external_id') || formData.get('productId') || '')
  }
  if (formData.has('sku') || formData.has('productId')) {
    product.sku = String(formData.get('sku') || formData.get('productId') || '')
  }
  if (formData.has('name')) product.name = String(formData.get('name') || '')
  if (formData.has('description')) product.description = String(formData.get('description') || '')
  if (formData.has('price')) {
    const price = parseFloat(String(formData.get('price') || '0')) || 0
    product.price_cents = Math.round(price * 100)
    priceOnRequest = isPriceOnRequest(price)
    product.price_on_request = priceOnRequest
  }
  if (formData.has('status')) product.status = String(formData.get('status') || 'hidden')

  const brandId = String(formData.getAll('brand')[0] || '')
  if (formData.has('brand')) product.brand_id = brandId || null
  if (formData.has('category') || formData.has('subcategory')) {
    product.category_id = String(formData.get('subcategory') || formData.get('category') || '')
  }

  if (formData.has('currency')) product.currency = String(formData.get('currency') || 'RUB')
  if (formData.has('fulfillment_mode')) product.fulfillment_mode = String(formData.get('fulfillment_mode') || 'requires_confirmation')
  if (formData.has('indexing_status')) product.indexing_status = String(formData.get('indexing_status') || 'indexable')
  if (formData.has('availability_confidence')) product.availability_confidence = String(formData.get('availability_confidence') || 'unknown')
  if (formData.has('production_min_days')) product.production_min_days = optionalInt(formData.get('production_min_days'))
  if (formData.has('production_max_days')) product.production_max_days = optionalInt(formData.get('production_max_days'))
  if (formData.has('office_delivery_min_days')) product.office_delivery_min_days = optionalInt(formData.get('office_delivery_min_days'))
  if (formData.has('office_delivery_max_days')) product.office_delivery_max_days = optionalInt(formData.get('office_delivery_max_days'))
  if (formData.has('seo_title')) product.seo_title = String(formData.get('seo_title') || '')
  if (formData.has('seo_description')) product.seo_description = String(formData.get('seo_description') || '')
  if (formData.has('h1')) product.h1 = String(formData.get('h1') || '')
  if (formData.has('canonical_url')) product.canonical_url = String(formData.get('canonical_url') || '')
  if (formData.has('catalog_attributes')) {
    product.catalog_attributes = parseJsonObject(formData.get('catalog_attributes'))
  }

  if (formData.has('productMetadata') || formData.has('gender') || formData.has('price_on_request') || priceOnRequest !== undefined) {
    const metadata = parseJsonObject(formData.get('productMetadata'))
    if (formData.has('gender')) {
      const gender = String(formData.get('gender') || '')
      const railsGender = mapUiGenderToRails(gender)
      if (railsGender) {
        product.gender = railsGender
        metadata.gender = railsGender
      } else {
        product.gender = null
        delete metadata.gender
      }
    }
    if (priceOnRequest !== undefined) {
      metadata.price_on_request = priceOnRequest
    } else if (formData.has('price_on_request')) {
      metadata.price_on_request = formBoolean(formData.get('price_on_request'))
    }
    product.metadata = metadata
  }

  const media = normalizeMediaForPayload(formData)
  if (media !== undefined) product.media = media

  if (applyDefaults) {
    product.currency ||= 'RUB'
    product.status ||= 'active'
    product.fulfillment_mode ||= 'requires_confirmation'
    product.indexing_status ||= 'indexable'
    product.availability_confidence ||= 'unknown'
  }

  return { product }
}

export async function createRailsAdminProduct(formData: FormData) {
  const result = await railsFetch<{ product: any }>('/admin/products', {
    method: 'POST',
    body: JSON.stringify(productFormDataToRailsPayload(formData, { applyDefaults: true })),
  })
  return mapRailsProduct(result.product)
}

export async function updateRailsAdminProduct(id: string, formData: FormData) {
  const result = await railsFetch<{ product: any }>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(productFormDataToRailsPayload(formData, { applyDefaults: false })),
  })
  return mapRailsProduct(result.product)
}

export async function patchRailsAdminProduct(id: string, data: Record<string, any>) {
  const product: Record<string, any> = {}
  let currentProduct: any | null = null
  const getCurrentProduct = async () => {
    if (currentProduct) return currentProduct
    const current = await railsFetch<{ product: any }>(`/admin/products/${id}`)
    currentProduct = current.product || {}
    return currentProduct
  }
  const getCurrentMetadata = async () => {
    const current = await getCurrentProduct()
    return current.metadata && typeof current.metadata === 'object' ? current.metadata : {}
  }

  if (data.productId !== undefined) {
    product.external_id = String(data.productId)
    product.sku = String(data.productId)
  }
  if (data.name !== undefined) product.name = String(data.name)
  if (data.description !== undefined) product.description = String(data.description)
  if (data.price !== undefined) {
    const price = Number(data.price) || 0
    product.price_cents = Math.round(price * 100)
    product.price_on_request = isPriceOnRequest(price)
  }
  if (data.status !== undefined) {
    const status = String(data.status || 'hidden')
    product.status = ['draft', 'active', 'hidden', 'archived'].includes(status) ? status : 'hidden'
  }
  if (data.category !== undefined || data.subcategory !== undefined) {
    product.category_id = String(data.subcategory && data.subcategory !== '__none__' ? data.subcategory : data.category || '')
  }
  if (data.metadata !== undefined) {
    product.metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
  }
  if (data.catalog_attributes !== undefined || data.attributes !== undefined) {
    const attributes = data.catalog_attributes ?? data.attributes
    product.catalog_attributes = attributes && typeof attributes === 'object' ? attributes : {}
  }
  if (data.price !== undefined) {
    const metadata = product.metadata && typeof product.metadata === 'object'
      ? { ...product.metadata }
      : { ...(await getCurrentMetadata()) }
    metadata.price_on_request = isPriceOnRequest(data.price)
    product.metadata = metadata
  }
  if (data.gender !== undefined) {
    const currentMetadata = await getCurrentMetadata()
    const metadata = product.metadata && typeof product.metadata === 'object'
      ? { ...currentMetadata, ...product.metadata }
      : { ...currentMetadata }
    const railsGender = mapUiGenderToRails(String(data.gender || ''))
    if (data.gender === '__none__' || data.gender === '' || !railsGender) {
      product.gender = null
      delete metadata.gender
    } else {
      product.gender = railsGender
      metadata.gender = railsGender
    }
    product.metadata = metadata
  }

  const result = await railsFetch<{ product: any }>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ product }),
  })
  return mapRailsProduct(result.product)
}

export async function moveRailsAdminProductToTrash(id: string) {
  const current = await railsFetch<{ product: any }>(`/admin/products/${id}`)
  const currentProduct = current.product || {}
  const metadata = currentProduct.metadata && typeof currentProduct.metadata === 'object'
    ? { ...currentProduct.metadata }
    : {}

  metadata.admin_previous_status = ['draft', 'active', 'hidden'].includes(String(currentProduct.status))
    ? String(currentProduct.status)
    : 'hidden'
  metadata.admin_trashed_at = new Date().toISOString()

  return patchRailsAdminProduct(id, {
    status: 'archived',
    metadata,
  })
}

export async function restoreRailsAdminProductFromTrash(id: string) {
  const current = await railsFetch<{ product: any }>(`/admin/products/${id}`)
  const currentProduct = current.product || {}
  const metadata = currentProduct.metadata && typeof currentProduct.metadata === 'object'
    ? { ...currentProduct.metadata }
    : {}
  const previousStatus = ['draft', 'active', 'hidden'].includes(String(metadata.admin_previous_status))
    ? String(metadata.admin_previous_status)
    : 'hidden'

  delete metadata.admin_previous_status
  delete metadata.admin_trashed_at

  return patchRailsAdminProduct(id, {
    status: previousStatus,
    metadata,
  })
}

export async function deleteRailsAdminProduct(id: string) {
  await railsFetch(`/admin/products/${id}`, { method: 'DELETE' })
}

export async function deleteRailsAdminProductsByExternalIds(externalIds: string[]) {
  const ids = [...new Set(externalIds.map((value) => String(value || '').trim()).filter(Boolean))]
  let deleted = 0

  for (const externalId of ids) {
    const params = new URLSearchParams({
      page: '1',
      per_page: '10',
      external_id: externalId,
    })
    const result = await railsFetch<{ products: any[] }>(`/admin/products?${params}`)
    const matches = (result.products || []).filter((product) => String(product.external_id || '').trim() === externalId)
    for (const product of matches) {
      await deleteRailsAdminProduct(String(product.id))
      deleted += 1
    }
  }

  return { requested: ids.length, deleted }
}

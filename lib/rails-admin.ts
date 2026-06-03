import { type Brand, type Category, type Product, type Subcategory } from './types'

let cachedRailsAdminToken: { token: string; expiresAt: number } | null = null

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
  const staticToken = process.env.RAILS_ADMIN_TOKEN || process.env.ADMIN_RAILS_TOKEN
  if (staticToken) return staticToken

  if (cachedRailsAdminToken && cachedRailsAdminToken.expiresAt > Date.now() + 60_000) {
    return cachedRailsAdminToken.token
  }

  const email = process.env.RAILS_ADMIN_EMAIL
  const password = process.env.RAILS_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('RAILS_ADMIN_EMAIL and RAILS_ADMIN_PASSWORD are required')
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

function mapRailsProduct(product: any): Product {
  const category = product.category || {}
  const categoryId = category.parent_id ? String(category.parent_id) : String(category.id || '')
  const subcategoryId = category.parent_id ? String(category.id || '') : ''
  const photos = Array.isArray(product.images) ? product.images.filter(Boolean) : (product.image_url ? [product.image_url] : [])

  return {
    id: String(product.id),
    productId: product.external_id || product.sku || String(product.id),
    name: product.name || '',
    description: product.description || '',
    price: Number(product.price_cents || 0) / 100,
    status: product.status === 'active' ? 'active' : 'inactive',
    brand: product.brand?.id ? String(product.brand.id) : '',
    category: categoryId,
    subcategory: subcategoryId,
    photos,
    photos_processed: true,
    gender: product.gender || product.metadata?.gender || '',
    thumb: product.image_url || photos[0] || '',
    created: product.created_at || '',
    updated: product.updated_at || '',
    collectionId: '',
    collectionName: 'products',
    expand: {
      brand: product.brand ? mapBrand(product.brand) : undefined,
      category: category.id ? {
        id: categoryId || String(category.id),
        name: category.parent_id ? '' : category.name,
        description: '',
        created: '',
        updated: '',
        collectionId: '',
        collectionName: 'categories',
      } : undefined,
      subcategory: subcategoryId ? {
        id: subcategoryId,
        name: category.name || '',
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
  brand?: string
  category?: string
  subcategory?: string
}) {
  const params = new URLSearchParams()
  params.set('page', String(options.page))
  params.set('per_page', String(options.perPage))
  if (options.search) params.set('q', options.search)
  if (options.brand) params.set('brand', options.brand)
  if (options.category || options.subcategory) params.set('category', options.subcategory || options.category || '')

  const payload = await railsFetch<{ products: any[]; meta: { total: number; pages: number } }>(`/admin/products?${params}`)
  return {
    products: (payload.products || []).map(mapRailsProduct),
    totalItems: Number(payload.meta?.total || 0),
    totalPages: Number(payload.meta?.pages || 0),
  }
}

export function productFormDataToRailsPayload(formData: FormData) {
  const price = parseFloat(String(formData.get('price') || '0')) || 0
  const rawPhotos = String(formData.get('existingPhotos') || '[]')
  let photoUrls: string[] = []
  try {
    const parsed = JSON.parse(rawPhotos)
    if (Array.isArray(parsed)) photoUrls = parsed.filter(Boolean).map(String)
  } catch {
    photoUrls = []
  }

  const categoryId = String(formData.get('subcategory') || formData.get('category') || '')
  const brandId = String(formData.getAll('brand')[0] || '')
  const status = String(formData.get('status') || 'active') === 'active' ? 'active' : 'hidden'
  const gender = String(formData.get('gender') || '')

  return {
    product: {
      external_id: String(formData.get('productId') || ''),
      sku: String(formData.get('productId') || ''),
      name: String(formData.get('name') || ''),
      description: String(formData.get('description') || ''),
      price_cents: Math.round(price * 100),
      status,
      brand_id: brandId || null,
      category_id: categoryId,
      currency: 'RUB',
      fulfillment_mode: 'requires_confirmation',
      indexing_status: 'indexable',
      availability_confidence: 'unknown',
      metadata: gender ? { gender } : {},
      media: photoUrls.map((url, index) => ({
        original_url: url,
        thumb_url: url,
        preview_url: url,
        og_image_url: url,
        sort_order: index,
        processing_status: 'processed',
      })),
    },
  }
}

export async function createRailsAdminProduct(formData: FormData) {
  const result = await railsFetch<{ product: any }>('/admin/products', {
    method: 'POST',
    body: JSON.stringify(productFormDataToRailsPayload(formData)),
  })
  return mapRailsProduct(result.product)
}

export async function updateRailsAdminProduct(id: string, formData: FormData) {
  const result = await railsFetch<{ product: any }>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(productFormDataToRailsPayload(formData)),
  })
  return mapRailsProduct(result.product)
}

export async function patchRailsAdminProduct(id: string, data: Record<string, any>) {
  const product: Record<string, any> = {}

  if (data.productId !== undefined) {
    product.external_id = String(data.productId)
    product.sku = String(data.productId)
  }
  if (data.name !== undefined) product.name = String(data.name)
  if (data.description !== undefined) product.description = String(data.description)
  if (data.price !== undefined) product.price_cents = Math.round((Number(data.price) || 0) * 100)
  if (data.status !== undefined) product.status = data.status === 'active' ? 'active' : 'hidden'
  if (data.category !== undefined || data.subcategory !== undefined) {
    product.category_id = String(data.subcategory || data.category || '')
  }
  if (data.gender !== undefined) {
    product.metadata = { gender: data.gender === '__none__' ? '' : String(data.gender || '') }
  }

  const result = await railsFetch<{ product: any }>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ product }),
  })
  return mapRailsProduct(result.product)
}

export async function deleteRailsAdminProduct(id: string) {
  await railsFetch(`/admin/products/${id}`, { method: 'DELETE' })
}

import { normalizeDescription } from '@/components/products/ProductDescription'
import { isPriceOnRequest } from '@/lib/product-pricing'
import type { Product, ProductSupplierOption } from '@/lib/types'

/**
 * Builds FormData for creating a duplicate product in Rails CRM.
 * Preserves all fields from the source product:
 * - Brand(s), category, subcategory
 * - Catalog attributes (sizes, colors, etc. so variant SKUs are generated)
 * - Supplier (name, avatar, Rails ID, scraping source ID)
 * - Delivery/production intervals and SEO metadata
 * - Media and video assets
 */
export function buildDuplicateProductFormData(
  product: Product,
  supplierOptions: ProductSupplierOption[] = [],
): FormData {
  const newProductId = `SKU-${Math.random().toString(36).substring(2, 9).toUpperCase()}`
  const formData = new FormData()

  formData.append('productId', newProductId)
  formData.append('name', `${product.name} (Копия)`)
  formData.append('description', normalizeDescription(product.description))
  formData.append('price', (Number(product.price) || 0).toString())
  formData.append('status', product.status || 'hidden')
  formData.append('gender', product.gender || '')
  formData.append('price_on_request', isPriceOnRequest(product.price) ? 'true' : 'false')
  formData.append('fulfillment_mode', product.fulfillment_mode || 'made_to_order')

  if (product.currency) formData.append('currency', product.currency)
  if (product.availability_confidence) formData.append('availability_confidence', product.availability_confidence)
  if (product.indexing_status) formData.append('indexing_status', product.indexing_status)

  if (product.video_url) formData.append('video_url', product.video_url)
  if (product.video_poster_url) formData.append('video_poster_url', product.video_poster_url)

  if (product.production_min_days != null) formData.append('production_min_days', String(product.production_min_days))
  if (product.production_max_days != null) formData.append('production_max_days', String(product.production_max_days))
  if (product.office_delivery_min_days != null) formData.append('office_delivery_min_days', String(product.office_delivery_min_days))
  if (product.office_delivery_max_days != null) formData.append('office_delivery_max_days', String(product.office_delivery_max_days))

  if (product.seo_title) formData.append('seo_title', product.seo_title)
  if (product.seo_description) formData.append('seo_description', product.seo_description)
  if (product.h1) formData.append('h1', product.h1)
  if (product.canonical_url) formData.append('canonical_url', product.canonical_url)

  // Brands
  const b = product.brand || (product as any).expand?.brand
  if (Array.isArray(b)) {
    b.forEach((id) => {
      if (typeof id === 'string') formData.append('brand', id)
      else if (id && typeof id === 'object' && 'id' in id) formData.append('brand', id.id)
    })
  } else if (typeof b === 'string' && b) {
    formData.append('brand', b)
  } else if (b && typeof b === 'object' && 'id' in b) {
    formData.append('brand', b.id)
  }

  // Categories
  const categoryId = product.category || (product as any).expand?.category?.id || ''
  const subcategoryId = product.subcategory || (product as any).expand?.subcategory?.id || ''
  if (categoryId) formData.append('category', categoryId)
  if (subcategoryId) formData.append('subcategory', subcategoryId)

  // Catalog Attributes
  const catalogAttributes = product.catalog_attributes || product.attributes || {}
  formData.append('catalog_attributes', JSON.stringify(catalogAttributes))

  // Metadata & Supplier
  const metadata = { ...(product.metadata || {}) }
  const sourceSupplierId = String(metadata.source_supplier_id || '').trim()

  const matchingOption = supplierOptions.find((item) =>
    (sourceSupplierId && (item.source_id === sourceSupplierId || item.id === sourceSupplierId)) ||
    (product.supplier?.id && (item.rails_id === product.supplier.id || item.id === product.supplier.id)) ||
    (product.supplier?.name && item.name.toLowerCase() === product.supplier.name.toLowerCase()),
  )

  const supplierName = matchingOption?.name || product.supplier?.name || ''
  const supplierAvatar = matchingOption?.avatar_url || product.supplier?.avatar_url || ''
  const isUuid = (val?: string | null): val is string =>
    Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val))
  const supplierId = (isUuid(product.supplier?.id) ? product.supplier.id : null) ||
    (isUuid(matchingOption?.rails_id) ? matchingOption.rails_id : null) ||
    (isUuid(matchingOption?.id) ? matchingOption.id : null) ||
    product.supplier?.id ||
    matchingOption?.rails_id ||
    ''
  const finalSourceSupplierId = sourceSupplierId || matchingOption?.source_id || ''

  if (finalSourceSupplierId) {
    metadata.source_supplier_id = finalSourceSupplierId
  }
  formData.append('productMetadata', JSON.stringify(metadata))

  if (supplierName) formData.append('supplier_name', supplierName)
  if (supplierAvatar) formData.append('supplier_avatar', supplierAvatar)
  if (supplierId) formData.append('supplier_id', supplierId)
  if (finalSourceSupplierId) formData.append('supplier_source_id', finalSourceSupplierId)

  // Media
  const media = product.media && product.media.length > 0
    ? product.media
    : (product.photos || []).map((url, index) => ({
      original_url: url,
      preview_url: url,
      thumb_url: url,
      og_image_url: url,
      sort_order: index,
      processing_status: 'processed',
    }))
  formData.append('media', JSON.stringify(media))

  return formData
}

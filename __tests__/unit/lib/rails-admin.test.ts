import { describe, expect, it } from 'vitest'
import { mapRailsProduct, productFormDataToRailsPayload } from '@/lib/rails-admin'

describe('rails admin product adapter', () => {
  it('builds update payload without defaulting Rails fields and preserves metadata', () => {
    const formData = new FormData()
    formData.append('productId', 'ext-1')
    formData.append('sku', 'sku-1')
    formData.append('name', 'Product')
    formData.append('description', 'Desc')
    formData.append('price', '1234.56')
    formData.append('status', 'hidden')
    formData.append('brand', 'brand-id')
    formData.append('category', 'category-id')
    formData.append('fulfillment_mode', 'made_to_order')
    formData.append('availability_confidence', 'medium')
    formData.append('indexing_status', 'needs_review')
    formData.append('production_min_days', '3')
    formData.append('production_max_days', '')
    formData.append('seo_title', 'SEO')
    formData.append('gender', 'Для женщин')
    formData.append('price_on_request', 'true')
    formData.append('productMetadata', JSON.stringify({ source: 'admin', gender: 'old' }))
    formData.append('media', JSON.stringify([
      {
        original_url: 'https://example.com/original-a.jpg',
        preview_url: 'https://example.com/preview-a.jpg',
        thumb_url: 'https://example.com/thumb-a.jpg',
        alt_text: 'Alt A',
        processing_status: 'processed',
      },
      {
        original_url: 'https://example.com/original-b.jpg',
      },
    ]))

    const payload = productFormDataToRailsPayload(formData, { applyDefaults: false })

    expect(payload.product).toMatchObject({
      external_id: 'ext-1',
      sku: 'sku-1',
      name: 'Product',
      description: 'Desc',
      price_cents: 123456,
      status: 'hidden',
      brand_id: 'brand-id',
      category_id: 'category-id',
      fulfillment_mode: 'made_to_order',
      availability_confidence: 'medium',
      indexing_status: 'needs_review',
      production_min_days: 3,
      production_max_days: null,
      seo_title: 'SEO',
      metadata: {
        source: 'admin',
        gender: 'Для женщин',
        price_on_request: true,
      },
    })
    expect(payload.product.currency).toBeUndefined()
    expect(payload.product.media).toEqual([
      {
        original_url: 'https://example.com/original-a.jpg',
        thumb_url: 'https://example.com/thumb-a.jpg',
        preview_url: 'https://example.com/preview-a.jpg',
        og_image_url: 'https://example.com/preview-a.jpg',
        alt_text: 'Alt A',
        sort_order: 0,
        processing_status: 'processed',
      },
      {
        original_url: 'https://example.com/original-b.jpg',
        thumb_url: 'https://example.com/original-b.jpg',
        preview_url: 'https://example.com/original-b.jpg',
        og_image_url: 'https://example.com/original-b.jpg',
        alt_text: '',
        sort_order: 1,
        processing_status: 'processed',
      },
    ])
  })

  it('maps Rails product media and CRM fields into UI product', () => {
    const product = mapRailsProduct({
      id: 'product-id',
      external_id: 'ext-1',
      sku: 'sku-1',
      slug: 'slug-1',
      name: 'Product',
      description: 'Desc',
      status: 'draft',
      price_cents: 10000,
      price_on_request: false,
      currency: 'RUB',
      fulfillment_mode: 'ready_to_ship',
      availability_confidence: 'high',
      indexing_status: 'noindex',
      production_min_days: 1,
      production_max_days: 2,
      office_delivery_min_days: 3,
      office_delivery_max_days: 4,
      seo_title: 'SEO title',
      seo_description: 'SEO description',
      h1: 'H1',
      canonical_url: 'https://example.com/product',
      metadata: { gender: 'Для мужчин', source: 'rails' },
      brand: { id: 'brand-id', name: 'Brand' },
      category: { id: 'subcategory-id', name: 'Subcategory', parent_id: 'category-id' },
      media: [
        { original_url: 'b.jpg', preview_url: 'b-preview.jpg', sort_order: 1, processing_status: 'processed' },
        { original_url: 'a.jpg', preview_url: 'a-preview.jpg', sort_order: 0, processing_status: 'pending' },
      ],
      created_at: 'created',
      updated_at: 'updated',
    })

    expect(product).toMatchObject({
      id: 'product-id',
      productId: 'ext-1',
      external_id: 'ext-1',
      sku: 'sku-1',
      slug: 'slug-1',
      price: 100,
      price_cents: 10000,
      status: 'draft',
      brand: 'brand-id',
      category: 'category-id',
      subcategory: 'subcategory-id',
      gender: 'Для мужчин',
      fulfillment_mode: 'ready_to_ship',
      availability_confidence: 'high',
      indexing_status: 'noindex',
      photos: ['a-preview.jpg', 'b-preview.jpg'],
      thumb: 'a-preview.jpg',
    })
    expect(product.media?.map((item) => item.original_url)).toEqual(['a.jpg', 'b.jpg'])
  })
})

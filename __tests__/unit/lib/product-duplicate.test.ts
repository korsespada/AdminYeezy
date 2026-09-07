import { describe, expect, it } from 'vitest'
import { buildDuplicateProductFormData } from '@/lib/product-duplicate'
import type { Product, ProductSupplierOption } from '@/lib/types'

describe('buildDuplicateProductFormData', () => {
  const baseProduct: Product = {
    id: 'prod-123',
    productId: 'SKU-OLD123',
    name: 'Футболка Chrome Hearts',
    description: 'Оригинальное **описание**',
    price: 19000,
    price_cents: 1900000,
    price_on_request: false,
    status: 'active',
    brand: 'brand-ch',
    category: 'cat-clothing',
    subcategory: 'subcat-tees',
    photos: ['https://example.com/photo1.jpg'],
    photos_processed: true,
    gender: 'Унисекс',
    thumb: 'https://example.com/photo1.jpg',
    currency: 'RUB',
    fulfillment_mode: 'made_to_order',
    availability_confidence: 'high',
    indexing_status: 'indexable',
    production_min_days: 1,
    production_max_days: 3,
    office_delivery_min_days: 2,
    office_delivery_max_days: 5,
    seo_title: 'SEO Заголовок',
    seo_description: 'SEO Описание',
    h1: 'H1 Заголовок',
    canonical_url: 'https://example.com/canonical',
    video_url: 'https://example.com/video.mp4',
    video_poster_url: 'https://example.com/poster.jpg',
    supplier: {
      id: 'sup-1',
      name: 'Катя Поставщик',
      avatar_url: 'https://example.com/katya.jpg',
    },
    metadata: {
      source_supplier_id: 'album_katya_999',
    },
    catalog_attributes: {
      sizes: ['S', 'M', 'L'],
      color: 'Белый',
    },
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'products',
  }

  const supplierOptions: ProductSupplierOption[] = [
    {
      id: 'album_katya_999',
      name: 'Катя Поставщик',
      avatar_url: 'https://example.com/katya.jpg',
      source_id: 'album_katya_999',
      rails_id: 'sup-1',
    },
  ]

  it('duplicates all fields including supplier when product.supplier is present', () => {
    const formData = buildDuplicateProductFormData(baseProduct, supplierOptions)

    expect(formData.get('name')).toBe('Футболка Chrome Hearts (Копия)')
    expect(formData.get('productId')).toMatch(/^SKU-[A-Z0-9]+$/)
    expect(formData.get('productId')).not.toBe('SKU-OLD123')
    expect(formData.get('price')).toBe('19000')
    expect(formData.get('status')).toBe('active')
    expect(formData.get('gender')).toBe('Унисекс')
    expect(formData.get('currency')).toBe('RUB')
    expect(formData.get('availability_confidence')).toBe('high')
    expect(formData.get('indexing_status')).toBe('indexable')
    expect(formData.get('production_min_days')).toBe('1')
    expect(formData.get('production_max_days')).toBe('3')
    expect(formData.get('office_delivery_min_days')).toBe('2')
    expect(formData.get('office_delivery_max_days')).toBe('5')
    expect(formData.get('seo_title')).toBe('SEO Заголовок')
    expect(formData.get('seo_description')).toBe('SEO Описание')
    expect(formData.get('h1')).toBe('H1 Заголовок')
    expect(formData.get('canonical_url')).toBe('https://example.com/canonical')
    expect(formData.get('video_url')).toBe('https://example.com/video.mp4')
    expect(formData.get('video_poster_url')).toBe('https://example.com/poster.jpg')
    expect(formData.get('brand')).toBe('brand-ch')
    expect(formData.get('category')).toBe('cat-clothing')
    expect(formData.get('subcategory')).toBe('subcat-tees')

    // Catalog attributes
    const catalogAttributes = JSON.parse(formData.get('catalog_attributes') as string)
    expect(catalogAttributes.sizes).toEqual(['S', 'M', 'L'])
    expect(catalogAttributes.color).toBe('Белый')

    // Supplier fields
    expect(formData.get('supplier_name')).toBe('Катя Поставщик')
    expect(formData.get('supplier_avatar')).toBe('https://example.com/katya.jpg')
    expect(formData.get('supplier_id')).toBe('sup-1')
    expect(formData.get('supplier_source_id')).toBe('album_katya_999')

    const metadata = JSON.parse(formData.get('productMetadata') as string)
    expect(metadata.source_supplier_id).toBe('album_katya_999')
  })

  it('resolves supplier from supplierOptions when product.supplier is null but metadata has source_supplier_id', () => {
    const productWithoutSupplier: Product = {
      ...baseProduct,
      supplier: null,
      metadata: {
        source_supplier_id: 'album_katya_999',
      },
    }

    const formData = buildDuplicateProductFormData(productWithoutSupplier, supplierOptions)

    expect(formData.get('supplier_name')).toBe('Катя Поставщик')
    expect(formData.get('supplier_avatar')).toBe('https://example.com/katya.jpg')
    expect(formData.get('supplier_id')).toBe('sup-1')
    expect(formData.get('supplier_source_id')).toBe('album_katya_999')
  })
})

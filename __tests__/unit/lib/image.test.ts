import { describe, expect, it } from 'vitest'
import { imagePresets, productImageSource, productImageUrl, resizeImageUrl } from '@/lib/image'
import type { Product } from '@/lib/types'

describe('image URL helpers', () => {
  it('adds szwego resize params to the current image URL', () => {
    const url = resizeImageUrl('https://xcimg.szwego.com/image.jpg?token=abc', imagePresets.productGrid)

    expect(url).toContain('https://xcimg.szwego.com/image.jpg?token=abc&imageMogr2')
    expect(url).toContain('thumbnail/!420x420r')
    expect(url).toContain('format/webp')
  })

  it('routes own CDN images through resize proxy', () => {
    const url = resizeImageUrl('https://cdn.yeezyunique.ru/products/1/photo.jpg', imagePresets.productTable)

    expect(url).toContain('/api/media/resize?')
    expect(url).toContain('w=96')
    expect(url).toContain('h=96')
    expect(decodeURIComponent(url)).toContain('https://cdn.yeezyunique.ru/products/1/photo.jpg')
  })

  it('normalizes product thumb and first photo sources before resizing', () => {
    const productWithThumb = product({ id: 'p1', thumb: 'thumb.jpg', photos: [] })
    const productWithPhoto = product({ id: 'p2', thumb: '', photos: ['photo.jpg'] })

    expect(productImageSource(productWithThumb)).toBe('https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/p1/thumb.jpg')
    expect(decodeURIComponent(productImageUrl(productWithPhoto, imagePresets.productTable))).toContain('https://cdn.yeezyunique.ru/products/p2/photo.jpg')
  })
})

function product(overrides: Partial<Product>) {
  return {
    id: 'product-id',
    productId: 'SKU-1',
    name: 'Product',
    description: '',
    price: 1000,
    status: 'active',
    brand: '',
    category: '',
    subcategory: '',
    photos: [],
    photos_processed: true,
    gender: '',
    thumb: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: '',
    ...overrides,
  } as Product
}

import type { Product } from '@/lib/types'

type ResizeFit = 'cover' | 'inside'

export interface ResizeImageOptions {
  width: number
  height: number
  fit?: ResizeFit
  quality?: number
}

export const imagePresets = {
  productGrid: { width: 420, height: 420, fit: 'cover', quality: 78 },
  productTable: { width: 96, height: 96, fit: 'cover', quality: 72 },
  productForm: { width: 420, height: 420, fit: 'cover', quality: 78 },
  avatar: { width: 112, height: 112, fit: 'cover', quality: 76 },
} satisfies Record<string, ResizeImageOptions>

const RESIZABLE_HOSTS = new Set([
  'static.yeezyunique.ru',
  'cdn.yeezyunique.ru',
  'yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru',
  'localhost',
  '127.0.0.1',
])

export function resizeImageUrl(src: string | null | undefined, options: ResizeImageOptions) {
  if (!src) return ''
  if (src.startsWith('/api/media/resize') || src.startsWith('data:') || src.startsWith('blob:')) return src

  if (isSzwegoUrl(src)) {
    return appendSzwegoResize(src, options)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(src)
  } catch {
    return src
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !RESIZABLE_HOSTS.has(parsedUrl.hostname)) {
    return src
  }

  const params = new URLSearchParams({
    url: src,
    w: String(safeDimension(options.width)),
    h: String(safeDimension(options.height)),
    fit: options.fit || 'cover',
    q: String(safeQuality(options.quality)),
  })

  return `/api/media/resize?${params.toString()}`
}

export function productImageUrl(product: Product | null | undefined, options: ResizeImageOptions = imagePresets.productGrid) {
  return resizeImageUrl(productImageSource(product), options)
}

export function productImageAlt(product: Product | null | undefined) {
  if (!product) return ''

  const source = productImageSource(product)
  const media = [...(product.media || [])].sort((left, right) => left.sort_order - right.sort_order)
  const matchingMedia = media.find((item) => [item.original_url, item.preview_url, item.thumb_url, item.og_image_url]
    .some((url) => url && (url === source || url === product.thumb)))

  return matchingMedia?.alt_text?.trim() || media[0]?.alt_text?.trim() || product.name || ''
}

export function productImageSource(product: Product | null | undefined) {
  if (!product) return ''

  if (product.thumb && typeof product.thumb === 'string') {
    if (product.thumb.startsWith('http')) return product.thumb
    return `https://yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru/products/${product.id}/${product.thumb}`
  }

  const photoUrl = firstPhotoUrl(product.photos)
  if (!photoUrl) return ''

  if (!photoUrl.startsWith('http') && !photoUrl.includes('/')) {
    return `https://cdn.yeezyunique.ru/products/${product.id}/${photoUrl}`
  }

  return photoUrl
}

function appendSzwegoResize(src: string, options: ResizeImageOptions) {
  if (src.includes('imageMogr2')) return src

  const separator = src.includes('?') ? '&' : '?'
  const width = safeDimension(options.width)
  const height = safeDimension(options.height)
  const quality = safeQuality(options.quality)

  return `${src}${separator}imageMogr2/auto-orient/thumbnail/!${width}x${height}r/quality/${quality}/format/webp`
}

function firstPhotoUrl(photos: Product['photos'] | string | null | undefined) {
  if (!photos) return ''
  if (typeof photos === 'string') {
    if (photos.startsWith('[')) {
      try {
        const parsed = JSON.parse(photos)
        return typeof parsed?.[0] === 'string' ? parsed[0] : ''
      } catch {
        return ''
      }
    }
    return photos
  }

  return typeof photos[0] === 'string' ? photos[0] : ''
}

function isSzwegoUrl(src: string) {
  if (src.includes('szwego.com')) return true
  try {
    const hostname = new URL(src).hostname
    return hostname === 'szwego.com' || hostname.endsWith('.szwego.com')
  } catch {
    return false
  }
}

function safeDimension(value: number) {
  return Math.min(2400, Math.max(64, Math.round(value)))
}

function safeQuality(value: number | undefined) {
  return Math.min(95, Math.max(30, Math.round(value || 82)))
}

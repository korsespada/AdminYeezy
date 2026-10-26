const sharp = require('sharp')

const DEFAULT_PREVIEW_WIDTH = 64
const DEFAULT_MIN_PORTRAIT_RATIO = 1.25
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_RETRIES = 1
const DEFAULT_ALLOWED_HOSTS = ['static.yeezyunique.ru', 'xcimg.szwego.com']

function allowedPhotoHosts(options = {}) {
  const raw = options.allowedHosts
    || process.env.AI_CATALOG_MEDIA_HOSTS
    || DEFAULT_ALLOWED_HOSTS.join(',')
  return new Set(
    (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((host) => String(host).trim().toLowerCase())
      .filter(Boolean),
  )
}

function isAllowedPhotoUrl(value, hosts) {
  try {
    const parsed = new URL(String(value))
    return ['http:', 'https:'].includes(parsed.protocol)
      && hosts.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function previewUrl(url, width = DEFAULT_PREVIEW_WIDTH) {
  const separator = String(url).includes('?') ? '&' : '?'
  return `${url}${separator}imageView2/0/w/${width}`
}

async function measureFirstPhoto(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : DEFAULT_RETRIES
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(previewUrl(url, options.previewWidth), {
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const metadata = await sharp(buffer).metadata()
      if (!metadata.width || !metadata.height) throw new Error('no image dimensions')
      return { width: metadata.width, height: metadata.height }
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  throw lastError || new Error('image measurement failed')
}

function isPortraitScreenshot(width, height, minRatio = DEFAULT_MIN_PORTRAIT_RATIO) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false
  return h > w * Number(minRatio)
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Remove the first gallery photo when its aspect ratio proves an official-site
 * screenshot (tall portrait) rather than a product shot.
 *
 * The feed's product photos are square; the inserted screenshots are 1.33-2.2x
 * taller than wide. Only a tiny CDN preview is fetched (`imageView2/0/w/64`),
 * so this is cheap. A failed measurement never drops a photo: the product is
 * returned unchanged and the failure is counted.
 */
async function filterFirstPhotoScreenshots(products, options = {}) {
  const list = Array.isArray(products) ? products : []
  const measurePhoto = options.measurePhoto || ((url) => measureFirstPhoto(url, options))
  const minRatio = Number(options.minRatio || DEFAULT_MIN_PORTRAIT_RATIO)
  const concurrency = Number(options.concurrency || 8)
  const maxConsecutiveFailures = Number(options.maxConsecutiveFailures || 20)
  const maxDurationMs = Number(options.maxDurationMs || 300000)
  const deadline = Date.now() + maxDurationMs
  const hosts = allowedPhotoHosts(options)

  let checked = 0
  let removed = 0
  let failed = 0
  let skipped = 0
  let consecutiveFailures = 0
  let aborted = false

  const result = await mapLimit(list, concurrency, async (product) => {
    if (!product || typeof product !== 'object') return product
    const photos = Array.isArray(product.photos) ? product.photos : []
    if (photos.length < 2) {
      skipped++
      return product
    }
    const firstPhoto = String(photos[0] || '').trim()
    if (!isAllowedPhotoUrl(firstPhoto, hosts)) {
      skipped++
      return product
    }
    if (aborted || Date.now() > deadline) {
      skipped++
      return product
    }
    checked++
    let dimensions
    try {
      dimensions = await measurePhoto(firstPhoto)
      consecutiveFailures = 0
    } catch (error) {
      failed++
      consecutiveFailures++
      if (consecutiveFailures >= maxConsecutiveFailures) aborted = true
      return product
    }
    if (!isPortraitScreenshot(dimensions.width, dimensions.height, minRatio)) {
      return product
    }

    const attributes = {
      ...(product.attributes && typeof product.attributes === 'object' ? product.attributes : {}),
      first_photo_screenshot_removed: true,
      first_photo_screenshot_dimensions: `${dimensions.width}x${dimensions.height}`,
      first_photo_screenshot_url: firstPhoto,
    }
    removed++
    return { ...product, photos: photos.slice(1), attributes }
  })

  return { products: result, checked, removed, failed, skipped, aborted }
}

module.exports = {
  filterFirstPhotoScreenshots,
  isPortraitScreenshot,
  measureFirstPhoto,
  previewUrl,
}

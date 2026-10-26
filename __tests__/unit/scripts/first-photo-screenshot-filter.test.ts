import { describe, expect, it } from 'vitest'

const {
  filterFirstPhotoScreenshots,
  isPortraitScreenshot,
} = require('../../../scripts/lib/first-photo-screenshot-filter')

describe('first-photo screenshot filter', () => {
  it('removes a portrait first photo and keeps the rest of the gallery', async () => {
    const product = {
      external_id: 'zegna-794',
      photos: ['https://xcimg.szwego.com/screenshot.jpg', 'https://xcimg.szwego.com/product-1.jpg', 'https://xcimg.szwego.com/product-2.jpg'],
      attributes: { szwego_tags: ['Zegna'] },
    }
    const result = await filterFirstPhotoScreenshots([product], {
      measurePhoto: async () => ({ width: 48, height: 64 }),
    })

    expect(result.removed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.products[0].photos).toEqual(['https://xcimg.szwego.com/product-1.jpg', 'https://xcimg.szwego.com/product-2.jpg'])
    expect(result.products[0].attributes.szwego_tags).toEqual(['Zegna'])
    expect(result.products[0].attributes.first_photo_screenshot_removed).toBe(true)
    expect(result.products[0].attributes.first_photo_screenshot_dimensions).toBe('48x64')
  })

  it('keeps a square first photo unchanged', async () => {
    const product = {
      external_id: 'square',
      photos: ['https://xcimg.szwego.com/square.jpg', 'https://xcimg.szwego.com/product-1.jpg'],
      attributes: {},
    }
    const result = await filterFirstPhotoScreenshots([product], {
      measurePhoto: async () => ({ width: 64, height: 64 }),
    })

    expect(result.removed).toBe(0)
    expect(result.products[0]).toBe(product)
  })

  it('does not touch a product with fewer than two photos', async () => {
    const product = { external_id: 'one', photos: ['https://xcimg.szwego.com/only.jpg'], attributes: {} }
    const result = await filterFirstPhotoScreenshots([product], {
      measurePhoto: async () => ({ width: 30, height: 64 }),
    })

    expect(result.skipped).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.products[0]).toBe(product)
  })

  it('keeps the photo when its preview cannot be measured', async () => {
    const product = {
      external_id: 'broken',
      photos: ['https://xcimg.szwego.com/broken.jpg', 'https://xcimg.szwego.com/product-1.jpg'],
      attributes: {},
    }
    const result = await filterFirstPhotoScreenshots([product], {
      measurePhoto: async () => { throw new Error('timeout') },
    })

    expect(result.failed).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.products[0].photos).toEqual(['https://xcimg.szwego.com/broken.jpg', 'https://xcimg.szwego.com/product-1.jpg'])
  })

  it('skips URLs outside the media host allowlist', async () => {
    let measured = false
    const product = {
      external_id: 'foreign',
      photos: ['https://evil.test/screenshot.jpg', 'https://evil.test/product.jpg'],
      attributes: {},
    }
    const result = await filterFirstPhotoScreenshots([product], {
      measurePhoto: async () => {
        measured = true
        return { width: 30, height: 64 }
      },
    })

    expect(measured).toBe(false)
    expect(result.skipped).toBe(1)
    expect(result.products[0]).toBe(product)
  })

  it('stops checking after repeated CDN failures', async () => {
    const products = Array.from({ length: 4 }, (_, index) => ({
      external_id: `broken-${index}`,
      photos: [`https://xcimg.szwego.com/broken-${index}.jpg`, 'https://xcimg.szwego.com/real.jpg'],
      attributes: {},
    }))
    const result = await filterFirstPhotoScreenshots(products, {
      concurrency: 1,
      maxConsecutiveFailures: 2,
      measurePhoto: async () => { throw new Error('timeout') },
    })

    expect(result.failed).toBe(2)
    expect(result.aborted).toBe(true)
    expect(result.skipped).toBe(2)
    expect(result.products[3].photos).toEqual(['https://xcimg.szwego.com/broken-3.jpg', 'https://xcimg.szwego.com/real.jpg'])
  })

  it('uses a strict portrait threshold', () => {
    expect(isPortraitScreenshot(64, 64)).toBe(false)
    expect(isPortraitScreenshot(64, 80)).toBe(false)
    expect(isPortraitScreenshot(48, 64)).toBe(true)
    expect(isPortraitScreenshot(30, 64)).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  requireAdmin: vi.fn(),
  getRailsAdminProduct: vi.fn(),
  patchRailsAdminProduct: vi.fn(),
  uploadProductPhotoFromUrl: vi.fn(),
  uploadProductPhotoFromBuffer: vi.fn(),
  uploadProductVideoFromUrl: vi.fn(),
  uploadProductVideoFromBuffer: vi.fn(),
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/admin-session', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/rails-admin', () => ({
  getRailsAdminProduct: mocks.getRailsAdminProduct,
  patchRailsAdminProduct: mocks.patchRailsAdminProduct,
}))
vi.mock('@/lib/product-media-upload', () => ({
  uploadProductPhotoFromUrl: mocks.uploadProductPhotoFromUrl,
  uploadProductPhotoFromBuffer: mocks.uploadProductPhotoFromBuffer,
  uploadProductVideoFromUrl: mocks.uploadProductVideoFromUrl,
  uploadProductVideoFromBuffer: mocks.uploadProductVideoFromBuffer,
}))

describe('product media upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue(undefined)
    mocks.getRailsAdminProduct.mockResolvedValue({
      id: 'product-1',
      name: 'Product',
      photos: ['https://static.yeezyunique.ru/products/media/existing.webp'],
      media: [],
    })
    mocks.uploadProductPhotoFromUrl.mockResolvedValue({
      source: 'https://cdn.example/photo.jpg',
      media: { original_url: 'https://static.yeezyunique.ru/products/media/new.webp' },
    })
    mocks.uploadProductVideoFromUrl.mockResolvedValue({
      source: 'https://cdn.example/video.mp4',
      url: 'https://static.yeezyunique.ru/videos/new.mp4',
      posterUrl: 'https://static.yeezyunique.ru/videos/new-poster.webp',
    })
  })

  it('returns immediately and patches Rails after all product media finishes', async () => {
    let backgroundWork: (() => Promise<void>) | undefined
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      backgroundWork = callback
    })
    const { POST } = await import('@/app/api/admin/products/media-upload/route')
    const formData = new FormData()
    formData.append('product_id', 'product-1')
    formData.append('photo_url', 'https://cdn.example/photo.jpg')
    formData.append('video_url', 'https://cdn.example/video.mp4')
    formData.append('video_poster_url', 'https://cdn.example/manual-poster.webp')

    const response = await POST({ formData: async () => formData } as Request)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ success: true, queued: true })
    expect(backgroundWork).toBeTypeOf('function')
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()

    await backgroundWork?.()

    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('product-1', expect.objectContaining({
      media: expect.arrayContaining([
        expect.objectContaining({ original_url: 'https://static.yeezyunique.ru/products/media/existing.webp' }),
        expect.objectContaining({ original_url: 'https://static.yeezyunique.ru/products/media/new.webp' }),
      ]),
      videoUrl: 'https://static.yeezyunique.ru/videos/new.mp4',
      videoPosterUrl: 'https://cdn.example/manual-poster.webp',
    }))
  })
})

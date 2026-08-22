import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  isAlreadyHosted: vi.fn(),
  videoStorageKeys: vi.fn(),
  uploadVideoIfNeeded: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock('@/lib/rails-admin', () => ({
  createRailsAdminProduct: vi.fn(),
  deleteRailsAdminProduct: vi.fn(),
  getRailsAdminProduct: vi.fn(),
  moveRailsAdminProductToTrash: vi.fn(),
  restoreRailsAdminProductFromTrash: vi.fn(),
  updateRailsAdminProduct: vi.fn(),
}))

vi.mock('../../../scripts/batch-workflow', () => ({
  isAlreadyHosted: mocks.isAlreadyHosted,
  videoStorageKeys: mocks.videoStorageKeys,
  uploadVideoIfNeeded: mocks.uploadVideoIfNeeded,
}))

describe('rehostProductVideoAction', () => {
  const originalBucket = process.env.S3_BUCKET

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue(undefined)
    process.env.S3_BUCKET = 'test-bucket'
  })

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.S3_BUCKET
    else process.env.S3_BUCKET = originalBucket
  })

  it('не перекодирует ссылку, которая уже ведёт на наш S3', async () => {
    mocks.isAlreadyHosted.mockReturnValue(true)

    const { rehostProductVideoAction } = await import('@/actions/products')
    const result = await rehostProductVideoAction('https://static.yeezyunique.ru/videos/abc.mp4')

    expect(result.success).toBe(true)
    expect(result.alreadyHosted).toBe(true)
    expect(result.url).toBe('https://static.yeezyunique.ru/videos/abc.mp4')
    expect(mocks.videoStorageKeys).not.toHaveBeenCalled()
    expect(mocks.uploadVideoIfNeeded).not.toHaveBeenCalled()
  })

  it('передаёт внешнее видео в схему выгрузок и возвращает ссылки на наш бакет', async () => {
    mocks.isAlreadyHosted.mockReturnValue(false)
    mocks.videoStorageKeys.mockReturnValue({
      videoKey: 'videos/hash.mp4',
      posterKey: 'videos/hash-poster.webp',
    })
    mocks.uploadVideoIfNeeded.mockResolvedValue({
      url: 'https://static.yeezyunique.ru/videos/hash.mp4',
      posterUrl: 'https://static.yeezyunique.ru/videos/hash-poster.webp',
    })

    const { rehostProductVideoAction } = await import('@/actions/products')
    const result = await rehostProductVideoAction('https://xcimg.szwego.com/video.mp4')

    expect(mocks.videoStorageKeys).toHaveBeenCalledWith('https://xcimg.szwego.com/video.mp4')
    expect(mocks.uploadVideoIfNeeded).toHaveBeenCalledWith(
      'https://xcimg.szwego.com/video.mp4',
      'videos/hash.mp4',
      'videos/hash-poster.webp',
    )
    expect(result).toEqual({
      success: true,
      url: 'https://static.yeezyunique.ru/videos/hash.mp4',
      posterUrl: 'https://static.yeezyunique.ru/videos/hash-poster.webp',
    })
  })

  it('возвращает ошибку без S3_BUCKET', async () => {
    delete process.env.S3_BUCKET
    mocks.isAlreadyHosted.mockReturnValue(false)

    const { rehostProductVideoAction } = await import('@/actions/products')
    const result = await rehostProductVideoAction('https://xcimg.szwego.com/video.mp4')

    expect(result.success).toBe(false)
    expect(result.error).toContain('S3_BUCKET')
    expect(mocks.uploadVideoIfNeeded).not.toHaveBeenCalled()
  })

  it('отклоняет не-HTTP(S) ссылки и пустой ввод', async () => {
    const { rehostProductVideoAction } = await import('@/actions/products')
    await expect(rehostProductVideoAction('ftp://example.com/video.mp4')).resolves.toMatchObject({ success: false })
    await expect(rehostProductVideoAction('   ')).resolves.toMatchObject({ success: false })
    expect(mocks.uploadVideoIfNeeded).not.toHaveBeenCalled()
  })

  it('сохраняет ошибку переноса как ответ с ошибкой', async () => {
    mocks.isAlreadyHosted.mockReturnValue(false)
    mocks.videoStorageKeys.mockReturnValue({ videoKey: 'k', posterKey: 'p' })
    mocks.uploadVideoIfNeeded.mockRejectedValue(new Error('видео больше 150 МБ'))

    const { rehostProductVideoAction } = await import('@/actions/products')
    const result = await rehostProductVideoAction('https://xcimg.szwego.com/big.mp4')

    expect(result).toMatchObject({ success: false, error: 'видео больше 150 МБ' })
  })
})

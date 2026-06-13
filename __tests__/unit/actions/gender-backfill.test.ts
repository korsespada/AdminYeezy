import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  listRailsAdminProducts: vi.fn(),
  getRailsAdminProduct: vi.fn(),
  patchRailsAdminProduct: vi.fn(),
  revalidatePath: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/lib/rails-admin', () => ({
  listRailsAdminProducts: mocks.listRailsAdminProducts,
  getRailsAdminProduct: mocks.getRailsAdminProduct,
  patchRailsAdminProduct: mocks.patchRailsAdminProduct,
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: mocks.requireAdmin,
}))

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    productId: 'ext-1',
    external_id: 'ext-1',
    sku: 'sku-1',
    name: 'CRM Product',
    description: 'Тип обуви: Кроссовки Размеры: 35-41',
    price: 0,
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
    collectionName: 'products',
    ...overrides,
  }
}

describe('gender backfill actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com', source: 'rails' })
  })

  it('parses CSV rows', async () => {
    const { parseGenderCsvAction } = await import('@/actions/gender-backfill')

    const res = await parseGenderCsvAction('productId;name;description\next-1;Product;Desc')

    expect(res.success).toBe(true)
    expect(res.data?.rows[0]).toMatchObject({ productId: 'ext-1', name: 'Product' })
  })

  it('bulk loads rails products for preview without patching anything', async () => {
    const { lookupGenderBackfillProductsAction } = await import('@/actions/gender-backfill')
    mocks.listRailsAdminProducts.mockResolvedValue({
      products: [product()],
      totalItems: 1,
      totalPages: 1,
    })

    const res = await lookupGenderBackfillProductsAction(['ext-1', 'ext-1'])

    expect(res.success).toBe(true)
    expect(res.data?.matched).toBe(1)
    expect(res.data?.matches['ext-1']).toMatchObject({ id: 'p1', productId: 'ext-1' })
  })

  it('applies only selected updates with valid gender', async () => {
    const { applyGenderUpdatesAction } = await import('@/actions/gender-backfill')
    mocks.getRailsAdminProduct.mockResolvedValueOnce(product())
    mocks.patchRailsAdminProduct.mockResolvedValueOnce(product({ gender: 'Для женщин' }))

    const res = await applyGenderUpdatesAction([{ productId: 'p1', gender: 'Для женщин' }])

    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ updated: 1, skipped: 0, failed: 0 })
    expect(mocks.patchRailsAdminProduct).toHaveBeenCalledWith('p1', { gender: 'Для женщин' })
  })

  it('does not overwrite products that already have gender during apply', async () => {
    const { applyGenderUpdatesAction } = await import('@/actions/gender-backfill')
    mocks.getRailsAdminProduct.mockResolvedValueOnce(product({ gender: 'Для мужчин' }))

    const res = await applyGenderUpdatesAction([{ productId: 'p1', gender: 'Для женщин' }])

    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ updated: 0, skipped: 1, failed: 0 })
    expect(mocks.patchRailsAdminProduct).not.toHaveBeenCalled()
  })
})

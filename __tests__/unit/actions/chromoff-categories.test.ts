import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRailsChromoffCategories: vi.fn(),
  runRailsChromoffImport: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/rails-admin', () => ({
  bulkUpdateRailsChromoffListingsPublished: vi.fn(),
  bulkUpdateRailsChromoffListingsSupplier: vi.fn(),
  createRailsChromoffListing: vi.fn(),
  deleteRailsChromoffListing: vi.fn(),
  listRailsChromoffCategories: mocks.listRailsChromoffCategories,
  runRailsChromoffImport: mocks.runRailsChromoffImport,
  updateRailsChromoffCategory: vi.fn(),
  updateRailsChromoffListing: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { createChromoffSubcategoryAction } from '@/actions/chromoff'

function buildFormData(overrides: Record<string, string> = {}) {
  const data = new FormData()
  data.set('parent_id', 'root-1')
  data.set('parent_source_id', 'src-root-1')
  data.set('name', 'Ремни')
  data.set('slug', '')
  data.set('catalog_category_id', 'cat-9')
  data.set('sort_order', '20')
  for (const [key, value] of Object.entries(overrides)) data.set(key, value)
  return data
}

describe('createChromoffSubcategoryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRailsChromoffCategories.mockResolvedValue([
      { id: 'root-1', source_id: 'src-root-1', parent_id: null, name: 'Аксессуары', slug: 'aksessuary', sort_order: 0, active: true },
      { id: 'child-1', source_id: '55', parent_id: 'root-1', name: 'Кепки', slug: 'kepki', sort_order: 10, active: true },
    ])
    mocks.runRailsChromoffImport.mockResolvedValue({ categories_received: 1, products_received: 0 })
  })

  it('creates a subcategory through the import endpoint with a manual source id', async () => {
    const result = await createChromoffSubcategoryAction(buildFormData())

    expect(result.success).toBe(true)
    expect(mocks.runRailsChromoffImport).toHaveBeenCalledTimes(1)
    const [payload, dryRun] = mocks.runRailsChromoffImport.mock.calls[0]
    expect(dryRun).toBe(false)
    expect(payload.categories).toEqual([{
      source_id: 'manual-remni',
      parent_source_id: 'src-root-1',
      catalog_category_id: 'cat-9',
      name: 'Ремни',
      slug: 'remni',
      sort_order: 20,
    }])
    expect(payload.products).toEqual([])
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/chromoff')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/chromoff/categories')
  })

  it('rejects a slug that already exists without calling Rails', async () => {
    const result = await createChromoffSubcategoryAction(buildFormData({ name: 'Кепки', slug: '' }))

    expect(result.success).toBe(false)
    expect(mocks.runRailsChromoffImport).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name inside the same section', async () => {
    const result = await createChromoffSubcategoryAction(buildFormData({ name: 'Кепки', slug: 'kepki-2' }))

    expect(result.success).toBe(false)
    expect(mocks.runRailsChromoffImport).not.toHaveBeenCalled()
  })

  it('requires a catalog mapping', async () => {
    const result = await createChromoffSubcategoryAction(buildFormData({ catalog_category_id: '' }))

    expect(result.success).toBe(false)
    expect(mocks.listRailsChromoffCategories).not.toHaveBeenCalled()
  })

  it('rejects a slug with unsupported characters', async () => {
    const result = await createChromoffSubcategoryAction(buildFormData({ slug: 'ремни!' }))

    expect(result.success).toBe(false)
    expect(mocks.runRailsChromoffImport).not.toHaveBeenCalled()
  })

  it('fails when Rails does not accept the category', async () => {
    mocks.runRailsChromoffImport.mockResolvedValue({ categories_received: 0, products_received: 0 })
    const result = await createChromoffSubcategoryAction(buildFormData())

    expect(result.success).toBe(false)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

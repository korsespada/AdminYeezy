import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const scrapingQuery = vi.fn()
  const query = vi.fn()
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  }
  return {
    scrapingQuery,
    query,
    client,
    getScrapingClient: vi.fn(async () => client),
    revalidatePath: vi.fn(),
    requireAdmin: vi.fn(),
  }
})

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/lib/s3', () => ({
  uploadToS3: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: mocks.query,
  scrapingQuery: mocks.scrapingQuery,
  getScrapingClient: mocks.getScrapingClient,
  redis: {
    del: vi.fn(),
    on: vi.fn(),
  },
  elastic: {},
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: mocks.requireAdmin,
}))

describe('batch product server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com', source: 'rails' })
  })

  it('loads and normalizes products for a batch', async () => {
    const { getBatchProductsAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          external_id: 'ext-1',
          name: 'Product',
          description: 'Desc',
          price: '123.45',
          status: 'inactive',
          brand: 'brand-id',
          category: 'cat-id',
          subcategory: null,
          gender: 'women',
          photos: ['https://example.com/a.jpg'],
          attributes: { color: 'black', sizes: ['M', 'L'] },
          batch_id: 'batch-1',
          ai_processed: true,
        },
      ],
    }).mockResolvedValueOnce({ rows: [{ stage: 'AI_PROCESSED' }] })

    const res = await getBatchProductsAction('batch-1')

    expect(res.success).toBe(true)
    expect(res.data?.products[0]).toMatchObject({
      id: 7,
      external_id: 'ext-1',
      price: 123.45,
      status: 'inactive',
      brand: 'brand-id',
      subcategory: '',
      batchId: 'batch-1',
      ai_processed: true,
      attributes: { color: 'black', sizes: ['M', 'L'] },
    })
    expect(mocks.scrapingQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE p.batch_id = $1'), ['batch-1'])
  })

  it('omits translations from the batch list so saving the list cannot wipe them', async () => {
    const { getBatchProductsAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [{ id: 8, external_id: 'ext-2', name: 'P', photos: [], has_en: true }] })
      .mockResolvedValueOnce({ rows: [{ stage: 'AI_PROCESSED' }] })

    const res = await getBatchProductsAction('batch-1')
    const product = res.data?.products[0] as Record<string, unknown>

    expect(product.has_en).toBe(true)
    expect('translations' in product).toBe(false)
    expect('photo_alts_en' in product).toBe(false)
    expect(mocks.scrapingQuery.mock.calls[0][0]).not.toContain("'translations' AS translations")
  })

  it('saves a full batch inside a transaction and prunes removed rows', async () => {
    const { saveBatchProductsAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    mocks.client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})

    const res = await saveBatchProductsAction('batch-1', [
      {
        id: 10,
        external_id: 'ext-1',
        name: 'Updated',
        description: '',
        price: 100,
        status: 'active',
        brand: 'brand-id',
        category: 'cat-id',
        photos: ['a.jpg'],
        slug: 'brand-model-black-ext-1',
        photo_alts: ['Черные кроссовки Brand Model, вид сбоку'],
        photo_slugs: ['vid-sboku'],
        supplier_published_on: '2026-08-02',
        ai_processed: true,
        attributes: { color: 'black', sizes: ['M', 'L'] },
      },
    ])

    expect(res.success).toBe(true)
    expect(mocks.client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(mocks.client.query).toHaveBeenCalledWith(
      'DELETE FROM products WHERE batch_id=$1 AND NOT (id = ANY($2::int[]))',
      ['batch-1', [10]],
    )
    expect(mocks.client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(mocks.client.release).toHaveBeenCalled()
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining('attributes=$18::jsonb'),
      expect.arrayContaining([
        'brand-model-black-ext-1',
        JSON.stringify(['Черные кроссовки Brand Model, вид сбоку']),
        JSON.stringify(['vid-sboku']),
        JSON.stringify({ color: 'black', sizes: ['M', 'L'] }),
        '2026-08-02',
      ]),
    )
  })

  it('patches one batch product by id', async () => {
    const { updateBatchProductAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })

    const res = await updateBatchProductAction(10, { price: 250, photos: ['next.jpg'] }, 'batch-1')

    expect(res.success).toBe(true)
    expect(mocks.scrapingQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products'),
      [250, JSON.stringify(['next.jpg']), 10, 'batch-1'],
    )
  })

  it('deletes one batch product and refreshes the batch count', async () => {
    const { deleteBatchProductAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rowCount: 1 })

    const res = await deleteBatchProductAction('ext-1', 'batch-1')

    expect(res.success).toBe(true)
    expect(mocks.scrapingQuery).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM products WHERE external_id=$1 AND batch_id=$2',
      ['ext-1', 'batch-1'],
    )
    expect(mocks.scrapingQuery).toHaveBeenNthCalledWith(
      3,
      'UPDATE scraping_batches SET items_count=(SELECT COUNT(*) FROM products WHERE batch_id=$1), updated_at=NOW() WHERE id=$1',
      ['batch-1'],
    )
  })

  it('deletes selected batch products in one query', async () => {
    const { deleteBatchProductsAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, external_id: 'ext-7' }, { id: 9, external_id: 'ext-1' }] })
      .mockResolvedValue({ rowCount: 1 })

    const res = await deleteBatchProductsAction([7, '9', 'ext-1', ''], 'batch-1')

    expect(res).toEqual({
      success: true,
      data: { deleted: [{ id: 7, external_id: 'ext-7' }, { id: 9, external_id: 'ext-1' }] },
    })
    expect(mocks.scrapingQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM products'),
      ['batch-1', [7, 9], ['ext-1']],
    )
    expect(mocks.scrapingQuery).toHaveBeenCalledTimes(3)
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2)
  })

  it('exports batch products as csv content', async () => {
    const { exportBatchProductsCsvAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          external_id: 'ext-1',
          name: 'Product',
          description: 'Text',
          price: 100,
          status: 'active',
          brand: 'brand-id',
          category: 'cat-id',
          subcategory: '',
          gender: '',
          photos: ['a.jpg', 'b.jpg'],
          batch_id: 'batch-1',
          ai_processed: false,
          attributes: { color: 'black', model: 'M60895' },
        },
      ],
    }).mockResolvedValueOnce({ rows: [{ stage: 'SCRAPED' }] })

    const res = await exportBatchProductsCsvAction('batch-1')

    expect(res.success).toBe(true)
    expect(res.data?.fileName).toBe('batch_batch-1.csv')
    expect(res.data?.content).toContain('external_id;name;description')
    expect(res.data?.content).toContain('ext-1;Product;Text')
    expect(res.data?.content).toContain('[""a.jpg"",""b.jpg""]')
    expect(res.data?.content).toContain('attributes')
    expect(res.data?.content).toContain('color')
  })

  it('creates a manual color family for selected batch products', async () => {
    const { assignBatchVariantFamilyAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery.mockResolvedValueOnce({ rows: [] })
    mocks.client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 10 }, { id: 11 }] })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({})

    const res = await assignBatchVariantFamilyAction('batch-1', [10, 11], undefined, 'Тестовая семья')

    expect(res.success).toBe(true)
    expect(res.data?.groupKey).toMatch(/^[0-9a-f]{32}$/)
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products SET variant_group_key=$1'),
      [res.data?.groupKey, 'Тестовая семья', 'batch-1', [10, 11]],
    )
    expect(mocks.client.query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('detaches one batch product from its color family', async () => {
    const { detachBatchVariantProductAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 })

    const res = await detachBatchVariantProductAction('batch-1', 10)

    expect(res.success).toBe(true)
    expect(mocks.scrapingQuery).toHaveBeenLastCalledWith(
      'UPDATE products SET variant_group_key=NULL,variant_group_name=NULL,updated_at=NOW() WHERE batch_id=$1 AND id=$2',
      ['batch-1', 10],
    )
  })
})

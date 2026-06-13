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
          batch_id: 'batch-1',
          ai_processed: true,
        },
      ],
    })

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
    })
    expect(mocks.scrapingQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE batch_id = $1'), ['batch-1'])
  })

  it('saves a full batch inside a transaction and prunes removed rows', async () => {
    const { saveBatchProductsAction } = await import('@/actions/csv-import')
    mocks.client.query
      .mockResolvedValueOnce({})
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
        ai_processed: true,
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
  })

  it('patches one batch product by id', async () => {
    const { updateBatchProductAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery.mockResolvedValueOnce({ rowCount: 1 })

    const res = await updateBatchProductAction(10, { price: 250, photos: ['next.jpg'] }, 'batch-1')

    expect(res.success).toBe(true)
    expect(mocks.scrapingQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products'),
      [250, JSON.stringify(['next.jpg']), 10, 'batch-1'],
    )
  })

  it('deletes one batch product and refreshes the batch count', async () => {
    const { deleteBatchProductAction } = await import('@/actions/csv-import')
    mocks.scrapingQuery.mockResolvedValue({ rowCount: 1 })

    const res = await deleteBatchProductAction('ext-1', 'batch-1')

    expect(res.success).toBe(true)
    expect(mocks.scrapingQuery).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM products WHERE external_id=$1 AND batch_id=$2',
      ['ext-1', 'batch-1'],
    )
    expect(mocks.scrapingQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE scraping_batches SET items_count=(SELECT COUNT(*) FROM products WHERE batch_id=$1), updated_at=NOW() WHERE id=$1',
      ['batch-1'],
    )
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
        },
      ],
    })

    const res = await exportBatchProductsCsvAction('batch-1')

    expect(res.success).toBe(true)
    expect(res.data?.fileName).toBe('batch_batch-1.csv')
    expect(res.data?.content).toContain('external_id;name;description')
    expect(res.data?.content).toContain('ext-1;Product;Text')
    expect(res.data?.content).toContain('[""a.jpg"",""b.jpg""]')
  })
})

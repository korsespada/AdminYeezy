import { afterAll, describe, expect, it, vi } from 'vitest'

const workflow = require('../../../scripts/batch-workflow')

afterAll(async () => {
  await workflow.closePools()
})

describe('batch workflow CSV compatibility adapter', () => {
  it('detects comma CSV and preserves quoted separators', () => {
    const rows = workflow.parseCsvObjects('external_id,name,description\n1,"Сумка, малая","Кожа, цепочка"')
    expect(rows).toEqual([{ external_id: '1', name: 'Сумка, малая', description: 'Кожа, цепочка' }])
  })

  it('flattens stored attributes for legacy supplier scripts', () => {
    const products = [{
      external_id: '1', name: 'Сумка', description: '', price: 0, status: 'inactive',
      brand: '', category: '', subcategory: '', gender: '', photos: [], ai_processed: false,
      attributes: { details: 'кожа', hardware: 'золото' },
    }]
    const columns = workflow.supplierScriptColumns(products)
    const csv = workflow.serializeProductsToCsv(products, columns, ';')
    expect(csv.split('\n')[0]).toMatch(/^external_id;name;description;price;brand;category;subcategory;gender;photos/)
    expect(csv.split('\n')[0]).toContain('details')
    expect(csv.split('\n')[0]).toContain('hardware')
    expect(csv).toContain('кожа')
  })

  it('converts legacy script catalog IDs to current Rails IDs', () => {
    const mappings = [
      { entity_type: 'brand', legacy_id: 'old-brand', canonical_id: 'new-brand', name: 'Chanel' },
      { entity_type: 'category', legacy_id: 'old-bags', canonical_id: 'new-bags', name: 'Сумки' },
      {
        entity_type: 'subcategory', legacy_id: 'old-wallets', canonical_id: 'new-wallets',
        canonical_parent_id: 'new-accessories', name: 'Кошельки и картхолдеры',
      },
    ]
    const product = workflow.normalizeProductCatalogReferences({
      brand: 'old-brand', category: 'old-bags', subcategory: 'old-wallets', gender: 'Для женщин',
    }, mappings)

    expect(product).toMatchObject({
      brand: 'new-brand',
      category: 'new-accessories',
      subcategory: 'new-wallets',
      gender: 'female',
    })
  })

  it('resolves catalog IDs to names before creating a Rails CSV import', () => {
    const id = '9168dfab-3808-4c98-85f2-827de398f959'
    expect(workflow.lookupName(new Map([[id, 'Обувь']]), id, 'категории')).toBe('Обувь')
  })

  it('stops publication instead of creating a UUID-named category', () => {
    expect(() => workflow.lookupName(
      new Map(),
      '9168dfab-3808-4c98-85f2-827de398f959',
      'категории',
    )).toThrow('не найдено название категории')
  })

  it('recognizes only the configured S3 host as already stored', () => {
    const previous = process.env.S3_PUBLIC_DOMAIN
    process.env.S3_PUBLIC_DOMAIN = 'https://static.yeezyunique.ru'
    try {
      expect(workflow.isAlreadyHosted('https://static.yeezyunique.ru/batches/a/1.jpg')).toBe(true)
      expect(workflow.isAlreadyHosted('https://api.yeezyunique.ru/media/1.jpg')).toBe(false)
      expect(workflow.isAlreadyHosted('https://xcimg.szwego.com/1.jpg')).toBe(false)
    } finally {
      process.env.S3_PUBLIC_DOMAIN = previous
    }
  })

  it('reuses an already hosted photo without another S3 request', async () => {
    const previousDomain = process.env.S3_PUBLIC_DOMAIN
    const previousBucket = process.env.S3_BUCKET
    process.env.S3_PUBLIC_DOMAIN = 'https://static.yeezyunique.ru'
    process.env.S3_BUCKET = 'yeezy-products'
    try {
      await expect(workflow.uploadPhotoIfNeeded(
        'https://static.yeezyunique.ru/batches/old/product-1.jpg',
        'unused.jpg',
      )).resolves.toBe('https://static.yeezyunique.ru/batches/old/product-1.jpg')
    } finally {
      if (previousDomain === undefined) delete process.env.S3_PUBLIC_DOMAIN
      else process.env.S3_PUBLIC_DOMAIN = previousDomain
      if (previousBucket === undefined) delete process.env.S3_BUCKET
      else process.env.S3_BUCKET = previousBucket
    }
  })

  it('recognizes photos already attached to an existing Rails product', () => {
    const urls = workflow.existingRailsPhotoMap({
      media: [{
        original_url: 'https://s3.example/original.jpg',
        preview_url: 'https://s3.example/preview.jpg',
        thumb_url: 'https://s3.example/thumb.jpg',
      }],
    })

    expect(urls.get('https://s3.example/original.jpg')).toBe('https://s3.example/original.jpg')
    expect(urls.get('https://s3.example/preview.jpg')).toBe('https://s3.example/original.jpg')
  })

  it('finds exact existing external IDs before a batch push', async () => {
    const previousToken = process.env.RAILS_ADMIN_TOKEN
    const previousUrl = process.env.RAILS_API_URL
    process.env.RAILS_ADMIN_TOKEN = 'test-token'
    process.env.RAILS_API_URL = 'https://rails.example.test'
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const externalIds = new URL(String(input)).searchParams.get('external_ids')?.split(',') || []
      return new Response(JSON.stringify({
        products: externalIds.includes('exists') ? [{ external_id: 'exists' }] : [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      const existing = await workflow.existingRailsExternalIds(['exists', 'new', 'exists'])
      expect([...existing]).toEqual(['exists'])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('external_ids')).toBe('exists,new')
    } finally {
      fetchMock.mockRestore()
      if (previousToken === undefined) delete process.env.RAILS_ADMIN_TOKEN
      else process.env.RAILS_ADMIN_TOKEN = previousToken
      if (previousUrl === undefined) delete process.env.RAILS_API_URL
      else process.env.RAILS_API_URL = previousUrl
    }
  })

  it('loads full Rails media for an existing product during an update', async () => {
    const previousToken = process.env.RAILS_ADMIN_TOKEN
    const previousUrl = process.env.RAILS_API_URL
    process.env.RAILS_ADMIN_TOKEN = 'test-token'
    process.env.RAILS_API_URL = 'https://rails.example.test'
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/admin/products/product-1')) {
        return new Response(JSON.stringify({
          product: {
            id: 'product-1',
            external_id: 'exists',
            media: [{ original_url: 'https://s3.example/product-1.jpg' }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        products: [{ id: 'product-1', external_id: 'exists' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      const existing = await workflow.existingRailsProducts(['exists'], { includeDetails: true })
      expect(workflow.existingRailsPhotoMap(existing.get('exists')).size).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      fetchMock.mockRestore()
      if (previousToken === undefined) delete process.env.RAILS_ADMIN_TOKEN
      else process.env.RAILS_ADMIN_TOKEN = previousToken
      if (previousUrl === undefined) delete process.env.RAILS_API_URL
      else process.env.RAILS_API_URL = previousUrl
    }
  })

  it('checks large external ID lists in batches and reports progress', async () => {
    const previousToken = process.env.RAILS_ADMIN_TOKEN
    const previousUrl = process.env.RAILS_API_URL
    process.env.RAILS_ADMIN_TOKEN = 'test-token'
    process.env.RAILS_API_URL = 'https://rails.example.test'
    const ids = Array.from({ length: 120 }, (_, index) => `product-${index + 1}`)
    const progress: number[] = []
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const externalIds = new URL(String(input)).searchParams.get('external_ids')?.split(',') || []
      return new Response(JSON.stringify({
        products: externalIds.map((external_id) => ({ external_id })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      const existing = await workflow.existingRailsProducts(ids, {
        onProgress: ({ current }: { current: number }) => progress.push(current),
      })
      expect(existing.size).toBe(120)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(progress).toContain(120)
    } finally {
      fetchMock.mockRestore()
      if (previousToken === undefined) delete process.env.RAILS_ADMIN_TOKEN
      else process.env.RAILS_ADMIN_TOKEN = previousToken
      if (previousUrl === undefined) delete process.env.RAILS_API_URL
      else process.env.RAILS_API_URL = previousUrl
    }
  })

  it('uses a stable publication hash and changes it only when catalog payload changes', () => {
    const product = {
      external_id: 'item-1',
      name: 'Футболка',
      description: 'Хлопок',
      price: 21000,
      status: 'active',
      brand: 'brand-1',
      category: 'category-1',
      subcategory: '',
      gender: 'male',
      photos: ['https://static.example/item-1.jpg'],
      attributes: { color: 'синий', sizes: ['M', 'L'] },
    }
    const reorderedAttributes = {
      ...product,
      attributes: { sizes: ['M', 'L'], color: 'синий' },
    }

    expect(workflow.publicationPayloadHash(reorderedAttributes))
      .toBe(workflow.publicationPayloadHash(product))
    expect(workflow.publicationPayloadHash({ ...product, price: 24000 }))
      .not.toBe(workflow.publicationPayloadHash(product))
  })

  it('includes supplier identity and publication time in Rails updates', () => {
    const payload = workflow.railsUpdatePayload({
      external_id: 'item-1',
      supplier_id: 28,
      supplier_name: 'LP, Zegna, BC Мужская одежда',
      source_published_at: '2026-08-03T12:00:00.000Z',
      supplier_published_on: '2026-08-02',
      attributes: {},
      photos: [],
    }).product

    expect(payload.primary_supplier_name).toBe('LP, Zegna, BC Мужская одежда')
    expect(payload.published_at).toBe('2026-08-03T12:00:00.000Z')
    expect(payload.metadata.source_supplier_id).toBe(28)
    expect(payload.metadata.source_published_at).toBe('2026-08-03T12:00:00.000Z')
    expect(payload.metadata.supplier_published_on).toBe('2026-08-02')
  })

  it('publishes processed inactive batch rows as active catalog products', () => {
    const row = workflow.productToRailsJsonRow({
      external_id: 'item-1',
      name: 'Кроссовки',
      status: 'inactive',
      brand: 'brand-1',
      category: 'category-1',
      subcategory: 'subcategory-1',
      photos: [],
      attributes: {
        measurements: {
          unit: 'см',
          columns: [{ key: 'insole_length', label: 'Длина стельки' }],
          rows: [{ size: '39', values: { insole_length: '25' } }],
          note: '',
        },
      },
      supplier_published_on: '2026-08-02',
    }, {
      brands: new Map([['brand-1', 'Brunello Cucinelli']]),
      categories: new Map([['category-1', 'Обувь']]),
      subcategories: new Map([['subcategory-1', 'Кроссовки']]),
    })

    expect(row.status).toBe('active')
    expect(row.attributes.measurements.rows[0].values.insole_length).toBe('25')
    expect(row.supplier_published_on).toBe('2026-08-02')
    expect(workflow.railsUpdatePayload({ external_id: 'item-1', status: 'inactive', attributes: {}, photos: [] }).product.status)
      .toBe('active')
  })

  it('clamps Rails JSON chunks to the API limit', () => {
    const previous = process.env.RAILS_IMPORT_CHUNK_SIZE
    process.env.RAILS_IMPORT_CHUNK_SIZE = '200'
    try {
      expect(workflow.railsImportChunkSize()).toBe(100)
    } finally {
      if (previous === undefined) delete process.env.RAILS_IMPORT_CHUNK_SIZE
      else process.env.RAILS_IMPORT_CHUNK_SIZE = previous
    }
  })
})

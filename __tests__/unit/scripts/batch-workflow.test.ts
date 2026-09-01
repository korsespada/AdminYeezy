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

  it('does not schedule video transfer when the video is already hosted locally or in Rails', () => {
    const previousDomain = process.env.S3_PUBLIC_DOMAIN
    process.env.S3_PUBLIC_DOMAIN = 'https://static.yeezyunique.ru'
    try {
      const sourceProduct = { attributes: { szwego_video_url: 'https://supplier.example/source.mov' } }
      expect(workflow.needsVideoTransfer(sourceProduct)).toBe(true)
      expect(workflow.needsVideoTransfer({
        attributes: {
          szwego_video_url: 'https://supplier.example/source.mov',
          hosted_video_url: 'https://static.yeezyunique.ru/batches/old/item.mp4',
        },
      })).toBe(false)
      expect(workflow.needsVideoTransfer(sourceProduct, {
        video_url: 'https://static.yeezyunique.ru/batches/old/item.mp4',
        video_poster_url: 'https://static.yeezyunique.ru/batches/old/item-poster.webp',
      })).toBe(false)
      const alreadyHostedSource = {
        external_id: 'item-static',
        name: 'Товар со статическим видео',
        attributes: {
          szwego_video_url: 'https://static.yeezyunique.ru/batches/old/item.mp4',
        },
      }
      expect(workflow.needsVideoTransfer(alreadyHostedSource)).toBe(false)
      expect(workflow.railsUpdatePayload(alreadyHostedSource).product.video_url)
        .toBe('https://static.yeezyunique.ru/batches/old/item.mp4')
    } finally {
      if (previousDomain === undefined) delete process.env.S3_PUBLIC_DOMAIN
      else process.env.S3_PUBLIC_DOMAIN = previousDomain
    }
  })

  it('deduplicates identical supplier galleries while protecting an existing external id', () => {
    const products = [
      {
        external_id: 'new-copy', source_position: 20,
        description: 'короткое описание', photos: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
        attributes: {},
      },
      {
        external_id: 'existing-product', source_position: 10,
        description: 'полное описание товара', photos: ['https://cdn.example/b.jpg?x=1', 'https://cdn.example/a.jpg'],
        attributes: { szwego_video_url: 'https://cdn.example/video.mp4' },
      },
      {
        external_id: 'different-color', source_position: 30,
        description: 'другой цвет', photos: ['https://cdn.example/c.jpg', 'https://cdn.example/d.jpg'],
        attributes: {},
      },
    ]

    const result = workflow.deduplicatePostProcessedProducts(products, new Set(['existing-product']))

    expect(result.map((item: any) => item.external_id)).toEqual(['existing-product', 'different-color'])
    expect(result[0]).toMatchObject({
      description: 'полное описание товара',
      attributes: { szwego_video_url: 'https://cdn.example/video.mp4' },
    })
  })

  it('keeps every protected external id in one identical-gallery group', () => {
    const products = [
      { external_id: 'a', source_position: 200, description: 'a', photos: ['https://cdn.example/a.jpg'], attributes: {} },
      { external_id: 'b', source_position: 300, description: 'b', photos: ['https://cdn.example/a.jpg?x=1'], attributes: {} },
      { external_id: 'new', source_position: 3, description: 'new', photos: ['https://cdn.example/a.jpg'], attributes: {} },
    ]

    const result = workflow.deduplicatePostProcessedProducts(products, new Set(['a', 'b']))

    expect(result.map((item: any) => item.external_id)).toEqual(['a', 'b'])
  })

  it('removes remote-content duplicates only when the full gallery matches', () => {
    const family = '0123456789abcdef0123456789abcdef'
    const oldCopy = {
      external_id: 'old-copy', source_position: 10, variant_group_key: family,
      photos: ['https://cdn.example/a-1.jpg', 'https://cdn.example/a-2.jpg', 'https://cdn.example/a-3.jpg', 'https://cdn.example/a-4.jpg', 'https://cdn.example/a-5.jpg', 'https://cdn.example/a-6.jpg'],
      attributes: {},
    }
    const latestCopy = {
      external_id: 'latest-copy', source_position: 20, variant_group_key: family,
      photos: ['https://cdn.example/b-1.jpg', 'https://cdn.example/b-2.jpg', 'https://cdn.example/b-3.jpg', 'https://cdn.example/b-4.jpg', 'https://cdn.example/b-5.jpg', 'https://cdn.example/b-6.jpg'],
      attributes: {},
    }
    const differentColor = {
      external_id: 'different-color', source_position: 30, variant_group_key: family,
      photos: ['https://cdn.example/c-1.jpg', 'https://cdn.example/c-2.jpg', 'https://cdn.example/c-3.jpg', 'https://cdn.example/c-4.jpg', 'https://cdn.example/c-5.jpg', 'https://cdn.example/c-6.jpg'],
      attributes: {},
    }
    const fingerprints = new Map([
      ['https://cdn.example/a-1.jpg', 'etag-1'],
      ['https://cdn.example/a-2.jpg', 'etag-2'],
      ['https://cdn.example/a-3.jpg', 'etag-3'],
      ['https://cdn.example/a-4.jpg', 'etag-4'],
      ['https://cdn.example/a-5.jpg', 'etag-5'],
      ['https://cdn.example/a-6.jpg', 'etag-6'],
      ['https://cdn.example/b-1.jpg', 'etag-1'],
      ['https://cdn.example/b-2.jpg', 'etag-2'],
      ['https://cdn.example/b-3.jpg', 'etag-3'],
      ['https://cdn.example/b-4.jpg', 'etag-4'],
      ['https://cdn.example/b-5.jpg', 'etag-5'],
      ['https://cdn.example/b-6.jpg', 'etag-6'],
      ['https://cdn.example/c-1.jpg', 'etag-1'],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(
      [oldCopy, latestCopy, differentColor], fingerprints,
    )

    expect(result.products.map((item: any) => item.external_id)).toEqual(['latest-copy', 'different-color'])
    expect(result.report.removedProducts).toBe(1)
    expect(result.report.candidateEdges).toBe(1)
    expect(result.report.exactGalleryEdges).toBe(1)
  })

  it('reports partial remote-content overlap without removing either BV product', () => {
    const family = 'abcdef0123456789abcdef0123456789'
    const products = [
      {
        external_id: 'partial-old', source_position: 10, variant_group_key: family,
        photos: Array.from({ length: 6 }, (_, index) => `https://cdn.example/partial-a-${index}.jpg`),
        attributes: {},
      },
      {
        external_id: 'partial-new', source_position: 20, variant_group_key: family,
        photos: Array.from({ length: 6 }, (_, index) => `https://cdn.example/partial-b-${index}.jpg`),
        attributes: {},
      },
    ]
    const fingerprints = new Map([
      ['https://cdn.example/partial-a-0.jpg', 'shared-1'],
      ['https://cdn.example/partial-a-1.jpg', 'shared-2'],
      ['https://cdn.example/partial-a-2.jpg', 'shared-3'],
      ['https://cdn.example/partial-b-0.jpg', 'shared-1'],
      ['https://cdn.example/partial-b-1.jpg', 'shared-2'],
      ['https://cdn.example/partial-b-2.jpg', 'shared-3'],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(products, fingerprints)

    expect(result.products.map((item: any) => item.external_id)).toEqual(['partial-old', 'partial-new'])
    expect(result.report.candidateEdges).toBe(0)
    expect(result.report.partialContentEdges).toBe(1)
    expect(result.report.removedProducts).toBe(0)
  })

  it('does not treat one shared BV photo as a duplicate', () => {
    const family = 'fedcba9876543210fedcba9876543210'
    const products = [10, 20].map((source_position, index) => ({
      external_id: `color-${index}`, source_position, variant_group_key: family,
      photos: Array.from({ length: 6 }, (_, photoIndex) => `https://cdn.example/${index}-${photoIndex}.jpg`),
      attributes: {},
    }))
    const fingerprints = new Map<string, string>([
      ['https://cdn.example/0-0.jpg', 'shared'],
      ['https://cdn.example/1-0.jpg', 'shared'],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(products, fingerprints)

    expect(result.products).toHaveLength(2)
    expect(result.report.candidateEdges).toBe(0)
  })

  it('deduplicates a complete short gallery without a preassigned family key', () => {
    const products = [
      {
        external_id: 'short-old', source_position: 10,
        description: '6608 Andiamo 32*24*12',
        photos: ['https://cdn.example/old-a.jpg', 'https://cdn.example/old-b.jpg'],
        attributes: {},
      },
      {
        external_id: 'short-latest', source_position: 20,
        description: '6608 Andiamo 32*24*12',
        photos: ['https://cdn.example/new-a.jpg', 'https://cdn.example/new-b.jpg'],
        attributes: {},
      },
    ]
    const fingerprints = new Map([
      ['https://cdn.example/old-a.jpg', 'same-a'],
      ['https://cdn.example/old-b.jpg', 'same-b'],
      ['https://cdn.example/new-a.jpg', 'same-a'],
      ['https://cdn.example/new-b.jpg', 'same-b'],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(products, fingerprints)

    expect(result.products.map((item: any) => item.external_id)).toEqual(['short-latest'])
    expect(result.report.exactGalleryEdges).toBe(1)
    expect(result.report.removedProducts).toBe(1)
  })

  it('removes an unambiguous one-photo repost contained in one long BV gallery', () => {
    const family = '0123456789abcdef0123456789abcdef'
    const products = [
      {
        external_id: 'album', source_position: 10, variant_group_key: family,
        variant_group_name: 'Bottega Veneta 6608 32x24x12',
        photos: Array.from({ length: 6 }, (_, index) => `https://cdn.example/album-${index}.jpg`),
        attributes: {},
      },
      {
        external_id: 'cover-copy', source_position: 20,
        description: '6608 Andiamo 32*24*12',
        photos: ['https://cdn.example/cover.jpg'],
        attributes: {},
      },
    ]
    const fingerprints = new Map([
      ['https://cdn.example/album-0.jpg', 'cover'],
      ['https://cdn.example/cover.jpg', 'cover'],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(products, fingerprints)

    expect(result.products.map((item: any) => item.external_id)).toEqual(['album'])
    expect(result.report.shortGalleryEdges).toBe(1)
  })

  it('deduplicates visually identical re-encoded galleries when ETags differ', () => {
    const products = [
      {
        external_id: 'visual-old', source_position: 10,
        description: '6608 Andiamo 32*24*12',
        photos: ['https://cdn.example/old-a.jpg', 'https://cdn.example/old-b.jpg'],
        attributes: {},
      },
      {
        external_id: 'visual-latest', source_position: 20,
        description: '6608 Andiamo 32*24*12',
        photos: ['https://cdn.example/new-a.jpg', 'https://cdn.example/new-b.jpg'],
        attributes: {},
      },
    ]
    const pixels = (value: number) => Buffer.alloc(16 * 16 * 3, value).toString('base64')
    const visualFingerprints = new Map([
      ['https://cdn.example/old-a.jpg', { hash: '00'.repeat(32), pixels: pixels(80) }],
      ['https://cdn.example/old-b.jpg', { hash: 'ff'.repeat(32), pixels: pixels(160) }],
      ['https://cdn.example/new-a.jpg', { hash: '00'.repeat(29) + 'ffffff', pixels: pixels(80) }],
      ['https://cdn.example/new-b.jpg', { hash: 'ff'.repeat(32), pixels: pixels(160) }],
    ])

    const result = workflow.deduplicateBvByContentFingerprints(
      products,
      new Map(),
      new Set(),
      visualFingerprints,
    )

    expect(result.products.map((item: any) => item.external_id)).toEqual(['visual-latest'])
    expect(result.report.exactGalleryEdges).toBe(1)
  })

  it('does not leave a singleton BV family after exact-gallery deduplication', () => {
    const result = workflow.finalizeBvPostProcess([
      {
        external_id: 'old-copy', source_position: 10,
        photos: ['https://cdn.example/bv.jpg'],
        variant_group_key: '0123456789abcdef0123456789abcdef',
        variant_group_name: 'Bottega Veneta 6608 32x24x12', attributes: {},
      },
      {
        external_id: 'latest-copy', source_position: 20,
        photos: ['https://cdn.example/bv.jpg?repost=1'],
        variant_group_key: '0123456789abcdef0123456789abcdef',
        variant_group_name: 'Bottega Veneta 6608 32x24x12', attributes: {},
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ variant_group_key: null, variant_group_name: null })
  })

  it('uses one stable S3 key for the same source video URL', () => {
    expect(workflow.videoStorageKeys(' https://supplier.example/video.mp4 '))
      .toEqual(workflow.videoStorageKeys('https://supplier.example/video.mp4'))
    expect(workflow.videoStorageKeys('https://supplier.example/video.mp4').videoKey)
      .toMatch(/^videos\/[a-f0-9]{64}\.mp4$/)
    expect(workflow.videoStorageKeys('https://supplier.example/other.mp4').videoKey)
      .not.toBe(workflow.videoStorageKeys('https://supplier.example/video.mp4').videoKey)
  })

  it('uses a manually supplied video instead of an older Szwego or hosted video', () => {
    const previousDomain = process.env.S3_PUBLIC_DOMAIN
    process.env.S3_PUBLIC_DOMAIN = 'https://static.yeezyunique.ru'
    try {
      expect(workflow.needsVideoTransfer({
        attributes: {
          manual_video_url: 'https://operator.example/replacement.mp4',
          szwego_video_url: 'https://supplier.example/original.mov',
          hosted_video_url: 'https://static.yeezyunique.ru/batches/old/item.mp4',
        },
      })).toBe(true)
    } finally {
      if (previousDomain === undefined) delete process.env.S3_PUBLIC_DOMAIN
      else process.env.S3_PUBLIC_DOMAIN = previousDomain
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

  it('decodes encoded measurement tables before a Rails publication', () => {
    const measurements = {
      unit: 'см',
      columns: [{ key: 'bust', label: 'Обхват груди' }],
      rows: [{ size: 'S', values: { bust: '116' } }],
      note: '',
    }
    const payload = workflow.railsUpdatePayload({
      external_id: 'encoded-measurements',
      name: 'Футболка',
      description: '',
      price: 0,
      status: 'active',
      brand: '',
      category: '',
      subcategory: '',
      gender: '',
      photos: [],
      attributes: { measurements: JSON.stringify(measurements) },
    })

    expect(payload.product.catalog_attributes.measurements).toEqual(measurements)
  })

  it('includes supplier identity and publication time in Rails updates', () => {
    const payload = workflow.railsUpdatePayload({
      external_id: 'item-1',
      supplier_id: 'supplier-album-id',
      supplier_name: 'LP, Zegna, BC Мужская одежда',
      source_published_at: '2026-08-03T12:00:00.000Z',
      supplier_published_on: '2026-08-02',
      attributes: {},
      photos: [],
    }).product

    expect(payload.primary_supplier_name).toBe('LP, Zegna, BC Мужская одежда')
    expect(payload.published_at).toBe('2026-08-03T12:00:00.000Z')
    expect(payload.metadata.source_supplier_id).toBe('supplier-album-id')
    expect(payload.metadata.source_published_at).toBe('2026-08-03T12:00:00.000Z')
    expect(payload.metadata.supplier_published_on).toBe('2026-08-02')
  })

  it('overwrites a stale price-on-request flag when publishing an existing product', () => {
    const pricedPayload = workflow.railsUpdatePayload({
      external_id: 'item-1',
      price: 91000,
      _railsMetadata: { price_on_request: true, source: 'legacy' },
      attributes: {},
      photos: [],
    }).product
    const requestPayload = workflow.railsUpdatePayload({
      external_id: 'item-2',
      price: 0,
      _railsMetadata: { price_on_request: false, source: 'legacy' },
      attributes: {},
      photos: [],
    }).product

    expect(pricedPayload.price_cents).toBe(9_100_000)
    expect(pricedPayload.metadata.price_on_request).toBe(false)
    expect(requestPayload.metadata.price_on_request).toBe(true)
  })

  it('keeps the color family when updating an existing Rails product', () => {
    const payload = workflow.railsUpdatePayload({
      external_id: 'item-1',
      variant_group_key: 'color-family-1',
      attributes: { colors: ['Белый'], sizes: ['S', 'M'] },
      photos: [],
    }).product

    expect(payload.variant_group_key).toBe('color-family-1')
    expect(payload.variants.map((variant: { size: string }) => variant.size)).toEqual(['S', 'M'])
  })

  it('publishes hosted video and keeps supplier media fields out of catalog attributes', () => {
    const payload = workflow.railsUpdatePayload({
      external_id: 'item-1',
      name: 'Шапка',
      slug: 'shapka-seraya-item-1',
      photo_alts: ['Серая шапка, вид спереди'],
      photo_slugs: ['vid-speredi'],
      photos: ['https://cdn.example/item-1.webp'],
      attributes: {
        color: 'Серый',
        szwego_video_url: 'https://supplier.example/source.mov',
        hosted_video_url: 'https://cdn.example/item-1.mp4',
        hosted_video_poster_url: 'https://cdn.example/item-1-poster.webp',
        source_parent_external_id: 'source-1',
      },
    }).product

    expect(payload.catalog_attributes).toEqual({ color: 'Серый' })
    expect(payload.video_url).toBe('https://cdn.example/item-1.mp4')
    expect(payload.video_poster_url).toBe('https://cdn.example/item-1-poster.webp')
    expect(payload.media[0].alt_text).toBe('Серая шапка, вид спереди')
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
    const previous = process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE
    process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE = '200'
    try {
      expect(workflow.railsImportChunkSize()).toBe(100)
    } finally {
      if (previous === undefined) delete process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE
      else process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE = previous
    }
  })

  it('uses production-safe defaults for publish concurrency and Rails chunks', () => {
    const previousChunkSize = process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE
    const previousMediaConcurrency = process.env.MEDIA_UPLOAD_CONCURRENCY
    delete process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE
    delete process.env.MEDIA_UPLOAD_CONCURRENCY
    try {
      expect(workflow.railsImportChunkSize()).toBe(50)
      expect(workflow.mediaUploadConcurrency()).toBe(4)
    } finally {
      if (previousChunkSize === undefined) delete process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE
      else process.env.RAILS_BATCH_PUBLISH_CHUNK_SIZE = previousChunkSize
      if (previousMediaConcurrency === undefined) delete process.env.MEDIA_UPLOAD_CONCURRENCY
      else process.env.MEDIA_UPLOAD_CONCURRENCY = previousMediaConcurrency
    }
  })

  it('keeps concurrent mapping ordered and within the configured limit', async () => {
    let active = 0
    let peak = 0
    const result = await workflow.mapWithConcurrency([30, 5, 20, 10], 2, async (delay: number) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, delay))
      active -= 1
      return delay / 5
    })

    expect(result).toEqual([6, 1, 4, 2])
    expect(peak).toBe(2)
  })
})

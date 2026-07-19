import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveRailsCrmRefund,
  approveRailsCrmWalletWithdrawal,
  buildRailsAdminProductsParams,
  getRailsProductFilterFacets,
  listRailsCrmCustomers,
  listRailsAdminProducts,
  mapRailsProduct,
  markRailsCrmWalletWithdrawalPaid,
  normalizeProductSearchInput,
  patchRailsAdminProduct,
  productFormDataToRailsPayload,
  rejectRailsCrmRefund,
  rejectRailsCrmWalletWithdrawal,
  restoreRailsAdminProductFromTrash,
} from '@/lib/rails-admin'

describe('rails admin product adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.RAILS_API_URL = 'https://rails.example.test'
    process.env.RAILS_ADMIN_TOKEN = 'test-token'
  })

  it('builds product list query params for filters', () => {
    const params = buildRailsAdminProductsParams({
      page: 2,
      perPage: 100,
      search: 'mules',
      name: 'Gucci mule',
      description: 'leather',
      priceMin: '0',
      priceMax: '1250.99',
      brand: 'brand-id',
      category: 'category-id',
      subcategory: 'subcategory-id',
      gender: 'Унисекс',
      genderExact: true,
      status: 'archived',
      attributeKey: 'material',
      attributeValue: 'leather',
    })

    expect(params.toString()).toContain('page=2')
    expect(params.toString()).toContain('per_page=100')
    expect(params.get('q')).toBe('mules')
    expect(params.get('name')).toBe('Gucci mule')
    expect(params.get('description')).toBe('leather')
    expect(params.get('price_min')).toBe('0')
    expect(params.get('price_max')).toBe('125099')
    expect(params.get('brand')).toBe('brand-id')
    expect(params.get('category')).toBe('subcategory-id')
    expect(params.get('gender')).toBe('Унисекс')
    expect(params.get('gender_exact')).toBe('true')
    expect(params.get('status')).toBe('archived')
    expect(params.get('attribute_key')).toBe('material')
    expect(params.get('attribute_value')).toBe('leather')
  })

  it('trims product search before sending it to Rails', () => {
    const params = buildRailsAdminProductsParams({
      page: 1,
      perPage: 40,
      search: '  ext-1  ',
    })

    expect(params.get('q')).toBe('ext-1')
  })

  it('normalizes pasted product URLs to product slugs for search', () => {
    expect(normalizeProductSearchInput('https://yeezyunique.ru/product/gucci-kurtka-abc123?utm=share')).toBe('gucci-kurtka-abc123')
    expect(normalizeProductSearchInput('/product/dior-sneakers-42')).toBe('dior-sneakers-42')

    const params = buildRailsAdminProductsParams({
      page: 1,
      perPage: 40,
      search: 'https://yeezyunique.ru/product/gucci-kurtka-abc123?utm=share',
    })

    expect(params.get('q')).toBe('gucci-kurtka-abc123')
  })

  it('loads searched products from the admin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 'product-id',
            external_id: 'ext-1',
            name: 'Admin Product',
            status: 'hidden',
            price_cents: 0,
            media: [],
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 40,
      search: 'ext-1',
    })

    expect(result.products).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://rails.example.test/api/v1/admin/products?page=1&per_page=40&q=ext-1')
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  it('uses local admin credentials for Rails authentication in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RAILS_ADMIN_TOKEN', '')
    vi.stubEnv('RAILS_ADMIN_EMAIL', '')
    vi.stubEnv('RAILS_ADMIN_PASSWORD', '')
    vi.stubEnv('LOCAL_ADMIN_EMAIL', 'local@example.com')
    vi.stubEnv('LOCAL_ADMIN_PASSWORD', 'local-password')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'local-rails-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          products: [],
          meta: { total: 0, pages: 0 },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await listRailsAdminProducts({ page: 1, perPage: 40, search: 'local' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://rails.example.test/api/v1/admin/auth/login')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'local@example.com',
      password: 'local-password',
    })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer local-rails-token')

    vi.unstubAllEnvs()
  })

  it('loads separately filtered products from the admin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [],
        meta: { total: 0, pages: 0 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await listRailsAdminProducts({
      page: 1,
      perPage: 40,
      name: 'bag',
      description: 'leather',
      priceMin: '0',
      priceMax: '50000',
    })

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://rails.example.test/api/v1/admin/products?page=1&per_page=40&name=bag&description=leather&price_min=0&price_max=5000000'
    )
  })

  it('loads CRM customers from the admin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        customers: [
          {
            id: 'customer-1',
            display_name: 'VIP Customer',
            order_count: 2,
            wallet_total_cents: 15000,
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsCrmCustomers({ page: 2, perPage: 30, search: 'vip' })

    expect(result.items).toHaveLength(1)
    expect(result.totalItems).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://rails.example.test/api/v1/admin/customers?page=2&per_page=30&q=vip')
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  it('calls CRM refund and wallet mutation endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        refund: { id: 'refund-1', status: 'approved' },
        wallet_withdrawal_request: { id: 'withdrawal-1', status: 'approved' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await approveRailsCrmRefund('refund-1')
    await rejectRailsCrmRefund('refund-2', 'bad request')
    await approveRailsCrmWalletWithdrawal('withdrawal-1')
    await rejectRailsCrmWalletWithdrawal('withdrawal-2', 'bad payout')
    await markRailsCrmWalletWithdrawalPaid('withdrawal-3')

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://rails.example.test/api/v1/admin/refunds/refund-1/approve')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://rails.example.test/api/v1/admin/refunds/refund-2/reject')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ message: 'bad request' })
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://rails.example.test/api/v1/admin/wallet_withdrawal_requests/withdrawal-1/approve')
    expect(String(fetchMock.mock.calls[3][0])).toBe('https://rails.example.test/api/v1/admin/wallet_withdrawal_requests/withdrawal-2/reject')
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ message: 'bad payout' })
    expect(String(fetchMock.mock.calls[4][0])).toBe('https://rails.example.test/api/v1/admin/wallet_withdrawal_requests/withdrawal-3/mark_paid')
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'POST')).toBe(true)
  })

  it('loads gender-filtered products from the catalog endpoint with exact admin semantics', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 'product-id',
            external_id: 'ext-1',
            name: 'Gender Product',
            gender: 'female',
            status: 'active',
            price_cents: 0,
            media: [],
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 40,
      brand: 'hermes',
      gender: 'female',
      genderExact: true,
    })

    expect(result.products).toHaveLength(1)
    expect(result.products[0].gender).toBe('Для женщин')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://rails.example.test/api/v1/catalog/products?page=1&per_page=40&brand=hermes&gender=female&gender_exact=true')
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('loads category-filtered products from the catalog endpoint so parent categories include children', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 'product-id',
            external_id: 'ext-1',
            name: 'Bag Product',
            status: 'active',
            price_cents: 0,
            media: [],
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 40,
      category: 'bags-parent',
    })

    expect(result.products).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://rails.example.test/api/v1/catalog/products?page=1&per_page=40&category=bags-parent')
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('loads products without gender through the Rails gender_missing filter', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [
          {
            id: 'no-gender-product',
            external_id: 'ext-no-gender',
            name: 'No Gender Product',
            status: 'active',
            price_cents: 0,
            media: [],
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 40,
      brand: 'hermes',
      noGender: true,
    })

    expect(result.products).toHaveLength(1)
    expect(result.products[0].gender).toBe('')
    expect(result.totalItems).toBe(1)
    expect(result.totalPages).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const params = new URL(String(url)).searchParams
    expect(String(url)).toContain('/catalog/products?')
    expect(params.get('gender_missing')).toBe('true')
    expect(params.get('gender')).toBeNull()
    expect(params.get('brand')).toBe('hermes')
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('loads filter facets while excluding the current facet dimension', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const requestUrl = new URL(url)
      const hasBrand = requestUrl.searchParams.has('brand')
      const hasCategory = requestUrl.searchParams.has('category')
      const gender = requestUrl.searchParams.get('gender')

      return {
        ok: true,
        json: async () => ({
          facets: {
            brands: [{ slug: hasBrand ? 'unexpected' : 'gucci', name: 'Gucci', count: 2 }],
            categories: [{ slug: hasCategory ? 'bags-child' : 'bags-parent', name: 'Сумки', count: 3 }],
            genders: gender === 'unisex' ? [] : [{ value: 'female', count: 4 }],
          },
          meta: { total: gender === 'unisex' ? 2 : 4, pages: 1 },
          products: [],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getRailsProductFilterFacets({
      search: ' bag ',
      brand: 'gucci',
      category: 'bags-parent',
      subcategory: 'bags-child',
      gender: 'female',
    })

    expect(result.brandFacets).toEqual([{ slug: 'gucci', name: 'Gucci', count: 2 }])
    expect(result.categoryFacets).toEqual([{ slug: 'bags-parent', name: 'Сумки', count: 3 }])
    expect(result.subcategoryFacets).toEqual([{ slug: 'bags-child', name: 'Сумки', count: 3 }])
    expect(result.genderFacets).toEqual([{ value: 'female', count: 4 }, { value: 'unisex', count: 2 }])
    expect(fetchMock).toHaveBeenCalledTimes(5)

    const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams)
    expect(calls[0].get('brand')).toBeNull()
    expect(calls[0].get('category')).toBe('bags-child')
    expect(calls[0].get('gender')).toBe('female')
    expect(calls[1].get('brand')).toBe('gucci')
    expect(calls[1].get('category')).toBeNull()
    expect(calls[1].get('gender')).toBe('female')
    expect(calls[2].get('brand')).toBe('gucci')
    expect(calls[2].get('category')).toBe('bags-parent')
    expect(calls[2].get('gender')).toBe('female')
    expect(calls[3].get('brand')).toBe('gucci')
    expect(calls[3].get('category')).toBe('bags-child')
    expect(calls[3].get('gender')).toBeNull()
    expect(calls[4].get('brand')).toBe('gucci')
    expect(calls[4].get('category')).toBe('bags-child')
    expect(calls[4].get('gender')).toBe('unisex')
  })

  it('loads 500-product admin pages in chunks', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const requestUrl = new URL(url)
      const page = Number(requestUrl.searchParams.get('page') || 1)
      const perPage = Number(requestUrl.searchParams.get('per_page') || 100)
      const start = (page - 1) * perPage + 1

      return {
        ok: true,
        json: async () => ({
          products: Array.from({ length: perPage }, (_, index) => ({
            id: `product-${start + index}`,
            external_id: `ext-${start + index}`,
            name: `Product ${start + index}`,
            status: 'active',
            price_cents: 0,
            media: [],
          })),
          meta: { total: 1200, pages: Math.ceil(1200 / perPage) },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 500,
      search: 'sneaker',
    })

    expect(result.products).toHaveLength(500)
    expect(result.products[0].id).toBe('product-1')
    expect(result.products[499].id).toBe('product-500')
    expect(result.totalItems).toBe(1200)
    expect(result.totalPages).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(13)
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('per_page'))).toEqual(
      Array.from({ length: 13 }, () => '40')
    )
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('page'))).toEqual(
      Array.from({ length: 13 }, (_, index) => String(index + 1))
    )
  })

  it('loads 500-product filtered catalog pages in chunks', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const requestUrl = new URL(url)
      const page = Number(requestUrl.searchParams.get('page') || 1)
      const perPage = Number(requestUrl.searchParams.get('per_page') || 40)
      const start = (page - 1) * perPage + 1

      return {
        ok: true,
        json: async () => ({
          products: Array.from({ length: perPage }, (_, index) => ({
            id: `filtered-product-${start + index}`,
            external_id: `filtered-ext-${start + index}`,
            name: `Filtered Product ${start + index}`,
            status: 'active',
            gender: 'unisex',
            price_cents: 0,
            media: [],
          })),
          meta: { total: 620, pages: Math.ceil(620 / perPage) },
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await listRailsAdminProducts({
      page: 1,
      perPage: 500,
      gender: 'unisex',
      brand: 'hermes',
    })

    expect(result.products).toHaveLength(500)
    expect(result.products[0].id).toBe('filtered-product-1')
    expect(result.products[499].id).toBe('filtered-product-500')
    expect(result.totalItems).toBe(620)
    expect(result.totalPages).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(13)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/catalog/products?'))).toBe(true)
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('per_page'))).toEqual(
      Array.from({ length: 13 }, () => '40')
    )
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('gender'))).toEqual(
      Array.from({ length: 13 }, () => 'unisex')
    )
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('brand'))).toEqual(
      Array.from({ length: 13 }, () => 'hermes')
    )
  })

  it('builds update payload without defaulting Rails fields and derives price-on-request from price', () => {
    const formData = new FormData()
    formData.append('productId', 'ext-1')
    formData.append('sku', 'sku-1')
    formData.append('name', 'Product')
    formData.append('description', 'Desc')
    formData.append('price', '1234.56')
    formData.append('status', 'hidden')
    formData.append('brand', 'brand-id')
    formData.append('category', 'category-id')
    formData.append('fulfillment_mode', 'made_to_order')
    formData.append('availability_confidence', 'medium')
    formData.append('indexing_status', 'needs_review')
    formData.append('production_min_days', '3')
    formData.append('production_max_days', '')
    formData.append('seo_title', 'SEO')
    formData.append('gender', 'Для женщин')
    formData.append('price_on_request', 'true')
    formData.append('productMetadata', JSON.stringify({ source: 'admin', gender: 'old' }))
    formData.append('catalog_attributes', JSON.stringify({ material: ['leather'], colors: ['black'] }))
    formData.append('media', JSON.stringify([
      {
        original_url: 'https://example.com/original-a.jpg',
        preview_url: 'https://example.com/preview-a.jpg',
        thumb_url: 'https://example.com/thumb-a.jpg',
        alt_text: 'Alt A',
        processing_status: 'processed',
      },
      {
        original_url: 'https://example.com/original-b.jpg',
      },
    ]))

    const payload = productFormDataToRailsPayload(formData, { applyDefaults: false })

    expect(payload.product).toMatchObject({
      external_id: 'ext-1',
      sku: 'sku-1',
      name: 'Product',
      description: 'Desc',
      price_cents: 123456,
      status: 'hidden',
      brand_id: 'brand-id',
      category_id: 'category-id',
      fulfillment_mode: 'made_to_order',
      availability_confidence: 'medium',
      indexing_status: 'needs_review',
      production_min_days: 3,
      production_max_days: null,
      seo_title: 'SEO',
      price_on_request: false,
      metadata: {
        source: 'admin',
        gender: 'female',
        price_on_request: false,
      },
      catalog_attributes: {
        material: ['leather'],
        colors: ['black'],
      },
    })
    expect(payload.product.currency).toBeUndefined()
    expect(payload.product.media).toEqual([
      {
        original_url: 'https://example.com/original-a.jpg',
        thumb_url: 'https://example.com/thumb-a.jpg',
        preview_url: 'https://example.com/preview-a.jpg',
        og_image_url: 'https://example.com/preview-a.jpg',
        alt_text: 'Alt A',
        sort_order: 0,
        processing_status: 'processed',
      },
      {
        original_url: 'https://example.com/original-b.jpg',
        thumb_url: 'https://example.com/original-b.jpg',
        preview_url: 'https://example.com/original-b.jpg',
        og_image_url: 'https://example.com/original-b.jpg',
        alt_text: '',
        sort_order: 1,
        processing_status: 'processed',
      },
    ])
  })

  it('marks zero-price products as price-on-request in payload metadata', () => {
    const formData = new FormData()
    formData.append('price', '0')
    formData.append('productMetadata', JSON.stringify({ source: 'admin', price_on_request: false }))

    const payload = productFormDataToRailsPayload(formData, { applyDefaults: false })

    expect(payload.product).toMatchObject({
      price_cents: 0,
      price_on_request: true,
      metadata: {
        source: 'admin',
        price_on_request: true,
      },
    })
  })

  it('patches price and syncs price-on-request metadata from price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          product: {
            id: 'product-id',
            metadata: { source: 'admin', price_on_request: true },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          product: {
            id: 'product-id',
            external_id: 'ext-1',
            name: 'Product',
            price_cents: 123400,
            metadata: { source: 'admin', price_on_request: false },
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await patchRailsAdminProduct('product-id', { price: 1234 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(patchBody.product).toMatchObject({
      price_cents: 123400,
      price_on_request: false,
      metadata: {
        source: 'admin',
        price_on_request: false,
      },
    })
  })

  it('keeps archived status and uses subcategory as Rails category id', () => {
    const formData = new FormData()
    formData.append('status', 'archived')
    formData.append('category', 'category-id')
    formData.append('subcategory', 'subcategory-id')

    const payload = productFormDataToRailsPayload(formData, { applyDefaults: false })

    expect(payload.product.status).toBe('archived')
    expect(payload.product.category_id).toBe('subcategory-id')
  })

  it('maps Rails product media and CRM fields into UI product', () => {
    const product = mapRailsProduct({
      id: 'product-id',
      external_id: 'ext-1',
      sku: 'sku-1',
      slug: 'slug-1',
      name: 'Product',
      description: 'Desc',
      status: 'draft',
      price_cents: 10000,
      price_on_request: true,
      currency: 'RUB',
      fulfillment_mode: 'ready_to_ship',
      availability_confidence: 'high',
      indexing_status: 'noindex',
      production_min_days: 1,
      production_max_days: 2,
      office_delivery_min_days: 3,
      office_delivery_max_days: 4,
      seo_title: 'SEO title',
      seo_description: 'SEO description',
      h1: 'H1',
      canonical_url: 'https://example.com/product',
      metadata: { gender: 'Для мужчин', source: 'rails', price_on_request: true },
      catalog_attributes: { material: ['leather'] },
      brand: { id: 'brand-id', name: 'Brand' },
      category: { id: 'subcategory-id', name: 'Subcategory', parent_id: 'category-id' },
      media: [
        { original_url: 'b.jpg', preview_url: 'b-preview.jpg', sort_order: 1, processing_status: 'processed' },
        { original_url: 'a.jpg', preview_url: 'a-preview.jpg', sort_order: 0, processing_status: 'pending' },
      ],
      created_at: 'created',
      updated_at: 'updated',
    })
    expect(product.catalog_attributes).toEqual({ material: ['leather'] })
    expect(product.attributes).toEqual({ material: ['leather'] })

    expect(product).toMatchObject({
      id: 'product-id',
      productId: 'ext-1',
      external_id: 'ext-1',
      sku: 'sku-1',
      slug: 'slug-1',
      price: 100,
      price_cents: 10000,
      price_on_request: false,
      status: 'draft',
      brand: 'brand-id',
      category: 'category-id',
      subcategory: 'subcategory-id',
      gender: 'Для мужчин',
      fulfillment_mode: 'ready_to_ship',
      availability_confidence: 'high',
      indexing_status: 'noindex',
      photos: ['a-preview.jpg', 'b-preview.jpg'],
      thumb: 'a-preview.jpg',
    })
    expect(product.media?.map((item) => item.original_url)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('restores a trashed product to previous status and clears trash metadata', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          product: {
            id: 'product-id',
            status: 'archived',
            metadata: {
              admin_previous_status: 'active',
              admin_trashed_at: '2026-06-07T00:00:00.000Z',
              source: 'test',
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          product: {
            id: 'product-id',
            name: 'Restored',
            status: 'active',
            metadata: { source: 'test' },
            price_cents: 0,
            media: [],
          },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    await restoreRailsAdminProductFromTrash('product-id')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const patchBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(patchBody.product.status).toBe('active')
    expect(patchBody.product.metadata).toEqual({ source: 'test' })
  })
})

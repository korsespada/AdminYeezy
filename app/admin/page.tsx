import ProductList from '@/components/products/ProductList'
import PerPageSelector from '@/components/ui/PerPageSelector'
import { getRailsCatalogLookups, getRailsProductFilterFacets, listRailsAdminProducts } from '@/lib/rails-admin'
import { connection } from 'next/server'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

const PRODUCT_PAGE_SIZES = [40, 100, 500]
type AdminSearchParams = {
  page?: string
  search?: string
  name?: string
  description?: string
  priceMin?: string
  priceMax?: string
  brand?: string
  supplier?: string
  category?: string
  subcategory?: string
  gender?: string
  attributeKey?: string
  attributeValue?: string
  perPage?: string
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<AdminSearchParams>
}) {
  await connection()
  const params = await searchParams
  const rawPage = Number(params.page)
  const rawPerPage = Number(params.perPage)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const perPage = PRODUCT_PAGE_SIZES.includes(rawPerPage) ? rawPerPage : 40
  const offset = (page - 1) * perPage
  const nameSearch = params.name || params.search || ''
  const descriptionSearch = params.description || ''
  const priceMin = params.priceMin || ''
  const priceMax = params.priceMax || ''
  const brandFilter = params.brand || ''
  const supplierFilter = params.supplier || ''
  const categoryFilter = params.category || ''
  const subcategoryFilter = params.subcategory || ''
  const genderFilter = params.gender || ''
  const attributeKeyFilter = params.attributeKey || ''
  const attributeValueFilter = attributeKeyFilter ? params.attributeValue || '' : ''
  const hasActiveFilters = Boolean(
    nameSearch
    || descriptionSearch
    || priceMin
    || priceMax
    || brandFilter
    || supplierFilter
    || categoryFilter
    || subcategoryFilter
    || genderFilter
    || attributeKeyFilter
    || attributeValueFilter
  )

  const buildPaginationUrl = (p: number) => {
    const params = new URLSearchParams()
    if (p !== 1) params.set('page', p.toString())
    if (nameSearch) params.set('name', nameSearch)
    if (descriptionSearch) params.set('description', descriptionSearch)
    if (priceMin) params.set('priceMin', priceMin)
    if (priceMax) params.set('priceMax', priceMax)
    if (brandFilter) params.set('brand', brandFilter)
    if (supplierFilter) params.set('supplier', supplierFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (subcategoryFilter) params.set('subcategory', subcategoryFilter)
    if (genderFilter) params.set('gender', genderFilter)
    if (attributeKeyFilter) params.set('attributeKey', attributeKeyFilter)
    if (attributeValueFilter) params.set('attributeValue', attributeValueFilter)
    if (perPage !== 40) params.set('perPage', perPage.toString())
    return `/admin?${params.toString()}`
  }

  try {
    const { brands, categories, subcategories } = await getRailsCatalogLookups()
    const brandSlug = brands.find((brand) => brand.id === brandFilter)?.slug || brandFilter
    const categorySlug = categories.find((category) => category.id === categoryFilter)?.slug || categoryFilter
    const subcategorySlug = subcategories.find((subcategory) => subcategory.id === subcategoryFilter)?.slug || subcategoryFilter
    const genderParam = genderFilter === 'Для мужчин'
      ? 'male'
      : genderFilter === 'Для женщин'
        ? 'female'
        : genderFilter === 'Унисекс'
          ? 'unisex'
          : genderFilter

    const productFilters = {
      page,
      perPage,
      name: nameSearch,
      description: descriptionSearch,
      priceMin,
      priceMax,
      brand: brandSlug,
      supplier: supplierFilter,
      category: categorySlug,
      subcategory: subcategoryFilter === '__none__' ? '' : subcategorySlug,
      gender: genderFilter === '__none__' ? '' : genderParam,
      genderExact: Boolean(genderParam && genderFilter !== '__none__'),
      noGender: genderFilter === '__none__',
      attributeKey: attributeKeyFilter,
      attributeValue: attributeValueFilter,
    }

    const [productPage, filterFacets, attributeDefinitions] = await Promise.all([
      hasActiveFilters
        ? listRailsAdminProducts(productFilters)
        : Promise.resolve({ products: [], totalItems: 0, totalPages: 0 }),
      getRailsProductFilterFacets({
        name: nameSearch,
        description: descriptionSearch,
        priceMin,
        priceMax,
        brand: brandSlug,
        supplier: supplierFilter,
        category: categorySlug,
        subcategory: subcategoryFilter === '__none__' ? '' : subcategorySlug,
        gender: genderFilter === '__none__' ? '' : genderParam,
        genderExact: Boolean(genderParam && genderFilter !== '__none__'),
        noGender: genderFilter === '__none__',
        attributeKey: attributeKeyFilter,
        attributeValue: attributeValueFilter,
      }),
      getCatalogAttributeDefinitions(),
    ])

    const products = productPage.products
    const catalogTotal = filterFacets.categoryFacets.reduce((sum, facet) => sum + Number(facet.count || 0), 0)
    const totalItems = hasActiveFilters ? productPage.totalItems : catalogTotal
    const totalPages = productPage.totalPages
    const shownFrom = products.length > 0 ? offset + 1 : 0
    const shownTo = products.length > 0 ? offset + products.length : 0
    const productListKey = [
      page,
      perPage,
      nameSearch,
      descriptionSearch,
      priceMin,
      priceMax,
      brandFilter,
      supplierFilter,
      categoryFilter,
      subcategoryFilter,
      genderFilter,
      attributeKeyFilter,
      attributeValueFilter,
    ].join('\u001f')

    return (
      <ProductList
        key={productListKey}
        initialData={products}
        brands={brands}
        allBrands={brands}
        categories={categories}
        subcategories={subcategories}
        attributeDefinitions={attributeDefinitions}
        activeSubcategoryIds={[]}
        filterFacets={filterFacets}
        totalItems={totalItems}
        showCategoryBrowser={!hasActiveFilters}
        pagination={
          totalItems > 0 && (
            <div className="mt-6 flex flex-col md:flex-row items-center justify-between border-t border-slate-700 bg-slate-800/50 px-4 py-4 sm:px-6 rounded-xl gap-4">
              <div className="flex items-center gap-4">
                <p className="text-sm text-slate-400">
                  Показано <span className="font-medium text-slate-200">{shownFrom}</span> - <span className="font-medium text-slate-200">{shownTo}</span> из <span className="font-medium text-slate-200">{totalItems}</span>
                </p>
                <PerPageSelector currentPerPage={perPage} />
              </div>

              {totalPages > 1 && (
                <nav className="isolate inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-sm">
                  <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700 hover:text-slate-100">
                    <a href={buildPaginationUrl(Math.max(1, page - 1))}>«</a>
                  </Button>
                  {[...Array(totalPages)].map((_, i) => {
                    const p = i + 1
                    if (p < page - 2 || p > page + 2) return null
                    return (
                      <Button key={p} asChild variant={p === page ? 'default' : 'ghost'} size="sm" className={p === page ? '' : 'text-slate-300 hover:bg-slate-700'}>
                        <a href={buildPaginationUrl(p)}>{p}</a>
                      </Button>
                    )
                  })}
                  <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:bg-slate-700 hover:text-slate-100">
                    <a href={buildPaginationUrl(Math.min(totalPages, page + 1))}>»</a>
                  </Button>
                </nav>
              )}
            </div>
          )
        }
      />
    )
  } catch (err: any) {
    console.error('Admin page error:', err)
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-400">
        <AlertTitle className="text-xl font-bold">Ошибка подключения к Rails API</AlertTitle>
        <AlertDescription>
        <p>{err.message}</p>
        <p className="mt-4 text-sm opacity-70">Проверьте `RAILS_API_URL`, `RAILS_ADMIN_EMAIL` и `RAILS_ADMIN_PASSWORD`.</p>
        </AlertDescription>
      </Alert>
    )
  }
}

import ProductList from '@/components/products/ProductList'
import { unstable_noStore as noStore } from 'next/cache'
import PerPageSelector from '@/components/ui/PerPageSelector'
import { getRailsCatalogLookups, listRailsAdminProducts } from '@/lib/rails-admin'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; brand?: string; category?: string; subcategory?: string; gender?: string; perPage?: string }
}) {
  noStore()
  const page = Number(searchParams.page) || 1
  const perPage = Number(searchParams.perPage) || 40
  const offset = (page - 1) * perPage
  const searchTerm = searchParams.search || ''
  const brandFilter = searchParams.brand || ''
  const categoryFilter = searchParams.category || ''
  const subcategoryFilter = searchParams.subcategory || ''
  const genderFilter = searchParams.gender || ''

  const buildPaginationUrl = (p: number) => {
    const params = new URLSearchParams()
    if (p !== 1) params.set('page', p.toString())
    if (searchTerm) params.set('search', searchTerm)
    if (brandFilter) params.set('brand', brandFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (subcategoryFilter) params.set('subcategory', subcategoryFilter)
    if (genderFilter) params.set('gender', genderFilter)
    if (perPage !== 40) params.set('perPage', perPage.toString())
    return `/admin?${params.toString()}`
  }

  try {
    const [{ brands, categories, subcategories }, productPage] = await Promise.all([
      getRailsCatalogLookups(),
      listRailsAdminProducts({
        page,
        perPage,
        search: searchTerm,
        brand: brandFilter.split(',').filter(Boolean)[0],
        category: categoryFilter,
        subcategory: subcategoryFilter === '__none__' ? '' : subcategoryFilter,
      }),
    ])

    const products = productPage.products
    const totalItems = productPage.totalItems
    const totalPages = productPage.totalPages

    return (
      <ProductList
        initialData={products}
        brands={brands}
        allBrands={brands}
        categories={categories}
        subcategories={subcategories}
        activeSubcategoryIds={[]}
        totalItems={totalItems}
        pagination={
          totalItems > 0 && (
            <div className="mt-6 flex flex-col md:flex-row items-center justify-between border-t border-slate-700 bg-slate-800/50 px-4 py-4 sm:px-6 rounded-xl gap-4">
              <div className="flex items-center gap-4">
                <p className="text-sm text-slate-400">
                  Показано <span className="font-medium text-slate-200">{offset + 1}</span> - <span className="font-medium text-slate-200">{Math.min(offset + perPage, totalItems)}</span> из <span className="font-medium text-slate-200">{totalItems}</span>
                </p>
                <PerPageSelector currentPerPage={perPage} />
              </div>

              {totalPages > 1 && (
                <nav className="isolate inline-flex -space-x-px rounded-lg shadow-sm border border-slate-700">
                  <a href={buildPaginationUrl(Math.max(1, page - 1))} className="px-3 py-2 text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-l-lg border-r border-slate-700">«</a>
                  {[...Array(totalPages)].map((_, i) => {
                    const p = i + 1
                    if (p < page - 2 || p > page + 2) return null
                    return (
                      <a key={p} href={buildPaginationUrl(p)} className={`px-4 py-2 text-sm font-semibold transition-colors ${p === page ? 'bg-indigo-600 text-white' : 'text-slate-300 bg-slate-800 hover:bg-slate-700'}`}>
                        {p}
                      </a>
                    )
                  })}
                  <a href={buildPaginationUrl(Math.min(totalPages, page + 1))} className="px-3 py-2 text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-r-lg border-l border-slate-700">»</a>
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
      <div className="p-8 bg-red-900/20 border border-red-800 rounded-lg text-red-400">
        <h2 className="text-xl font-bold mb-2">Ошибка подключения к Rails API</h2>
        <p>{err.message}</p>
        <p className="mt-4 text-sm opacity-70">Проверьте `RAILS_API_URL`, `RAILS_ADMIN_EMAIL` и `RAILS_ADMIN_PASSWORD`.</p>
      </div>
    )
  }
}

import { createClient } from '@/lib/pocketbase'
import { Collections, type Product, type Brand, type Category, type Subcategory } from '@/lib/types'
import ProductList from '@/components/ProductList'
import { unstable_noStore as noStore } from 'next/cache'
import { logoutAction } from '@/actions/auth'
import { LogOut } from 'lucide-react'

import PerPageSelector from '@/components/PerPageSelector'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; brand?: string; category?: string; subcategory?: string; gender?: string; perPage?: string }
}) {
  // Opt out of static rendering; page always fetches fresh data on request
  noStore()
  const page = Number(searchParams.page) || 1
  const perPage = Number(searchParams.perPage) || 40
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

    const q = params.toString()
    return `/admin${q ? `?${q}` : ''}`
  }

  let products: Product[] = []
  let brands: Brand[] = []
  let allBrands: Brand[] = []
  let categories: Category[] = []
  let subcategories: Subcategory[] = []
  let totalPages = 1
  let totalItems = 0
  let activeSubcategoryIds: string[] = []
  let error: string | null = null

  try {
    const pb = createClient()

    // 1. Build filters
    const filters: string[] = []
    if (searchTerm) {
      const searchWords = searchTerm.trim().toLowerCase().split(/\s+/)
      const wordFilters = searchWords.map(word =>
        `(name ~ "${word}" || productId ~ "${word}" || description ~ "${word}")`
      )
      filters.push(`(${wordFilters.join(' && ')})`)
    }
    if (brandFilter) {
      const brandIds = brandFilter.split(',')
      const brandFilters = brandIds.map(id => `brand ~ "${id}"`)
      filters.push(`(${brandFilters.join(' || ')})`)
    }
    if (categoryFilter) filters.push(`category = "${categoryFilter}"`)
    if (subcategoryFilter === '__none__') {
      filters.push(`subcategory = ""`)
    } else if (subcategoryFilter) {
      filters.push(`subcategory = "${subcategoryFilter}"`)
    }
    if (genderFilter === '__none__') {
      filters.push(`gender = ""`)
    } else if (genderFilter) {
      filters.push(`gender = "${genderFilter}"`)
    }
    const filter = filters.length > 0 ? filters.join(' && ') : ''

    // 2. Build lookup filters for sidebar
    const brandLookupFilters: string[] = []
    if (categoryFilter) brandLookupFilters.push(`category = "${categoryFilter}"`)
    if (subcategoryFilter) {
      if (subcategoryFilter === '__none__') brandLookupFilters.push(`subcategory = ""`)
      else brandLookupFilters.push(`subcategory = "${subcategoryFilter}"`)
    }
    if (genderFilter) {
      if (genderFilter === '__none__') brandLookupFilters.push(`gender = ""`)
      else brandLookupFilters.push(`gender = "${genderFilter}"`)
    }
    const brandLookupFilterStr = brandLookupFilters.join(' && ')

    const subcatLookupFilters: string[] = []
    if (categoryFilter) subcatLookupFilters.push(`category = "${categoryFilter}"`)
    if (genderFilter) {
      if (genderFilter === '__none__') subcatLookupFilters.push(`gender = ""`)
      else subcatLookupFilters.push(`gender = "${genderFilter}"`)
    }
    if (brandFilter) {
      const brandIds = brandFilter.split(',')
      const bFilters = brandIds.map(id => `brand ~ "${id}"`)
      subcatLookupFilters.push(`(${bFilters.join(' || ')})`)
    }
    const subcatLookupFilterStr = subcatLookupFilters.join(' && ')

    // 3. Выполняем ВСЕ запросы параллельно одним Promise.all
    const [
      categoriesData,
      subcategoriesData,
      productsForBrands,
      productsForSubcats,
      result,
      allBrandsResult,
    ] = await Promise.all([
      pb.collection(Collections.Category).getFullList<Category>({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as Category[]),
      pb.collection(Collections.Subcategory).getFullList<Subcategory>({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as Subcategory[]),
      pb.collection(Collections.Products).getFullList({
        filter: brandLookupFilterStr,
        fields: 'brand',
        requestKey: null,
      }).catch(() => [] as any[]),
      pb.collection(Collections.Products).getFullList({
        filter: subcatLookupFilterStr,
        fields: 'subcategory',
        requestKey: null,
      }).catch(() => [] as any[]),
      pb.collection(Collections.Products).getList<Product>(page, perPage, {
        sort: '-created',
        expand: 'brand,category,subcategory',
        filter: filter,
        requestKey: null,
      }).catch((err) => {
        console.error('Error fetching products:', err)
        return { items: [], totalItems: 0, totalPages: 1, page: 1, perPage: perPage }
      }),
      pb.collection(Collections.Brand).getFullList<Brand>({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as Brand[]),
    ])

    categories = categoriesData
    subcategories = subcategoriesData

    // Compute brand selection filter from lookup results
    let brandSelectionFilter = ''
    const uniqueBrandIds = Array.from(new Set(
      productsForBrands.flatMap((p: any) => {
        if (Array.isArray(p.brand)) return p.brand
        return p.brand ? [p.brand] : []
      })
    ))
    if (uniqueBrandIds.length > 0) {
      brandSelectionFilter = uniqueBrandIds.map(id => `id = "${id}"`).join(' || ')
    } else {
      brandSelectionFilter = 'id = "none"'
    }

    // Compute active subcategory IDs
    const activeSubcatIdsRaw = Array.from(new Set(
      productsForSubcats.map((p: any) => p.subcategory).filter(Boolean)
    ))
    activeSubcategoryIds = activeSubcatIdsRaw as string[]

    // Filter brands list for sidebar from allBrands (already fetched)
    const brandsResult = allBrandsResult.filter((b: Brand) => {
      if (brandSelectionFilter === 'id = "none"') return false
      return uniqueBrandIds.includes(b.id)
    })

    products = result.items
    totalPages = result.totalPages
    totalItems = result.totalItems
    brands = brandsResult
    allBrands = allBrandsResult

    // Ensure all products have their relation IDs populated (fallback to expand)
    products = products.map(p => {
      let brandValue = p.brand || ''
      if (!brandValue && p.expand?.brand) {
        if (Array.isArray(p.expand.brand)) {
          brandValue = p.expand.brand.map(b => b.id)
        } else {
          brandValue = p.expand.brand.id
        }
      }

      return {
        ...p,
        brand: brandValue,
        category: p.category || p.expand?.category?.id || '',
        subcategory: p.subcategory || p.expand?.subcategory?.id || ''
      }
    })

  } catch (err: any) {
    console.error('Admin page error:', err)
    error = `Failed to load data: ${err?.message || 'Unknown error'}`
  }

  return (
    <>
      {error ? (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium mb-4">{error}</p>
          <p className="text-gray-600 dark:text-gray-400 mb-6 text-center max-w-md">
            This error usually occurs when your session has expired or you don't have sufficient permissions.
            Please sign out and sign in again.
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-sm"
            >
              <LogOut size={18} />
              Sign Out & Retry
            </button>
          </form>
        </div>
      ) : (
        <>
          <ProductList
            initialData={products}
            brands={brands}
            allBrands={allBrands}
            categories={categories}
            subcategories={subcategories}
            activeSubcategoryIds={activeSubcategoryIds}
            totalItems={totalItems}
            pagination={
              /* Pagination */
              totalItems > 0 && (
                <div className="mt-6 flex flex-col md:flex-row sm:items-center justify-between border-t border-slate-700 bg-slate-800/50 px-4 py-4 sm:px-6 rounded-xl gap-4">
                  <div className="flex flex-1 justify-between sm:hidden">
                    <a
                      href={page > 1 ? buildPaginationUrl(page - 1) : '#'}
                      className={`relative inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${page > 1
                        ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                      Previous
                    </a>
                    <a
                      href={page < totalPages ? buildPaginationUrl(page + 1) : '#'}
                      className={`relative ml-3 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${page < totalPages
                        ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                      Next
                    </a>
                  </div>
                  <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <p className="text-sm text-slate-400">
                        Showing <span className="font-medium text-slate-200">{(page - 1) * perPage + 1}</span> to{' '}
                        <span className="font-medium text-slate-200">{Math.min(page * perPage, totalItems)}</span> of{' '}
                        <span className="font-medium text-slate-200">{totalItems}</span> results
                      </p>

                      <div className="h-4 w-px bg-slate-700"></div>
                      <PerPageSelector currentPerPage={perPage} />
                    </div>

                    {totalPages > 1 && (
                      <div>
                        <nav className="isolate inline-flex -space-x-px rounded-lg shadow-sm overflow-hidden border border-slate-700">
                          <a
                            href={page > 1 ? buildPaginationUrl(page - 1) : '#'}
                            className={`relative inline-flex items-center px-2 py-2 text-slate-400 bg-slate-800 hover:bg-slate-700 ${page > 1 ? '' : 'opacity-50 pointer-events-none'
                              }`}
                          >
                            <span className="sr-only">Previous</span>
                            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                            </svg>
                          </a>

                          {(() => {
                            const pages: (number | '...')[] = []
                            const delta = 2
                            const left = Math.max(2, page - delta)
                            const right = Math.min(totalPages - 1, page + delta)

                            pages.push(1)
                            if (left > 2) pages.push('...')
                            for (let i = left; i <= right; i++) {
                              pages.push(i)
                            }
                            if (right < totalPages - 1) pages.push('...')
                            if (totalPages > 1) pages.push(totalPages)

                            return pages.map((pageNum, idx) =>
                              pageNum === '...' ? (
                                <span
                                  key={`dots-${idx}`}
                                  className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-slate-500 bg-slate-800"
                                >
                                  …
                                </span>
                              ) : (
                                <a
                                  key={pageNum}
                                  href={buildPaginationUrl(pageNum as number)}
                                  className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold transition-colors ${pageNum === page
                                    ? 'z-10 bg-indigo-600 text-white'
                                    : 'text-slate-300 bg-slate-800 hover:bg-slate-700'
                                    }`}
                                >
                                  {pageNum}
                                </a>
                              )
                            )
                          })()}

                          <a
                            href={page < totalPages ? buildPaginationUrl(page + 1) : '#'}
                            className={`relative inline-flex items-center px-2 py-2 text-slate-400 bg-slate-800 hover:bg-slate-700 ${page < totalPages ? '' : 'opacity-50 pointer-events-none'
                              }`}
                          >
                            <span className="sr-only">Next</span>
                            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                            </svg>
                          </a>
                        </nav>
                      </div>
                    )}
                  </div>
                </div>
              )
            }
          />
        </>
      )}
    </>
  )
}

import { createClient } from '@/lib/pocketbase'
import { Collections, type Product, type Brand, type Category } from '@/lib/types'
import ProductList from '@/components/ProductList'
import { unstable_noStore as noStore } from 'next/cache'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; brand?: string; category?: string; subcategory?: string }
}) {
  // Opt out of static rendering; page always fetches fresh data on request
  noStore()
  const page = Number(searchParams.page) || 1
  const perPage = 40
  const searchTerm = searchParams.search || ''
  const brandFilter = searchParams.brand || ''
  const categoryFilter = searchParams.category || ''
  const subcategoryFilter = searchParams.subcategory || ''

  let products: Product[] = []
  let brands: Brand[] = []
  let categories: Category[] = []
  let subcategories: any[] = []
  let totalPages = 1
  let totalItems = 0
  let error: string | null = null

  try {
    const pb = createClient()

    // Build filter for search and filters
    const filters: string[] = []

    if (searchTerm) {
      const searchWords = searchTerm.trim().toLowerCase().split(/\s+/)
      if (searchWords.length === 1) {
        const word = searchWords[0]
        filters.push(`(name ~ "${word}" || productId ~ "${word}" || description ~ "${word}")`)
      } else {
        const wordFilters = searchWords.map(word =>
          `(name ~ "${word}" || productId ~ "${word}" || description ~ "${word}")`
        )
        filters.push(`(${wordFilters.join(' && ')})`)
      }
    }

    if (brandFilter) filters.push(`brand = "${brandFilter}"`)
    if (categoryFilter) filters.push(`category = "${categoryFilter}"`)
    if (subcategoryFilter === '__none__') {
      filters.push(`subcategory = ""`)
    } else if (subcategoryFilter) {
      filters.push(`subcategory = "${subcategoryFilter}"`)
    }

    const filter = filters.length > 0 ? filters.join(' && ') : ''

    // Fetch everything in parallel
    const [result, brandsResult, categoriesResult, subcategoriesResult] = await Promise.all([
      pb.collection(Collections.Products).getList<Product>(page, perPage, {
        sort: '-created',
        expand: 'brand,category,subcategory',
        filter: filter,
        requestKey: null,
      }),
      pb.collection(Collections.Brand).getFullList<Brand>({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as Brand[]),
      pb.collection(Collections.Category).getFullList<Category>({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as Category[]),
      pb.collection(Collections.Subcategory).getFullList({
        sort: 'name',
        requestKey: null,
      }).catch(() => [] as any[])
    ])

    products = result.items
    totalPages = result.totalPages
    totalItems = result.totalItems
    brands = brandsResult
    categories = categoriesResult
    subcategories = subcategoriesResult

    // Handle fallbacks if direct collections failed but we have products
    if (brands.length === 0 && products.length > 0) {
      const brandMap = new Map<string, Brand>()
      products.forEach(p => p.expand?.brand && brandMap.set(p.expand.brand.id, p.expand.brand))
      brands = Array.from(brandMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    if (categories.length === 0 && products.length > 0) {
      const categoryMap = new Map<string, Category>()
      products.forEach(p => p.expand?.category && categoryMap.set(p.expand.category.id, p.expand.category))
      categories = Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    if (subcategories.length === 0 && products.length > 0) {
      const subMap = new Map<string, any>()
      products.forEach(p => p.expand?.subcategory && subMap.set(p.expand.subcategory.id, p.expand.subcategory))
      subcategories = Array.from(subMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    // Ensure all products have their relation IDs populated (fallback to expand)
    products = products.map(p => ({
      ...p,
      brand: p.brand || p.expand?.brand?.id || '',
      category: p.category || p.expand?.category?.id || '',
      subcategory: p.subcategory || p.expand?.subcategory?.id || ''
    }))

  } catch (err: any) {
    error = `Failed to load data: ${err?.message || 'Unknown error'}`
  }

  return (
    <>
      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : (
        <>
          <ProductList initialData={products} brands={brands} categories={categories} subcategories={subcategories} totalItems={totalItems} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 sm:px-6 rounded-lg">
              <div className="flex flex-1 justify-between sm:hidden">
                <a
                  href={page > 1 ? `/admin?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}${subcategoryFilter ? `&subcategory=${subcategoryFilter}` : ''}` : '#'}
                  className={`relative inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${page > 1
                    ? 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                    }`}
                >
                  Previous
                </a>
                <a
                  href={page < totalPages ? `/admin?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}${subcategoryFilter ? `&subcategory=${subcategoryFilter}` : ''}` : '#'}
                  className={`relative ml-3 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${page < totalPages
                    ? 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                    }`}
                >
                  Next
                </a>
              </div>
              <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Showing <span className="font-medium">{(page - 1) * perPage + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(page * perPage, totalItems)}</span> of{' '}
                    <span className="font-medium">{totalItems}</span> results
                  </p>
                </div>
                <div>
                  <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm">
                    <a
                      href={page > 1 ? `/admin?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}${subcategoryFilter ? `&subcategory=${subcategoryFilter}` : ''}` : '#'}
                      className={`relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 ${page > 1 ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'cursor-not-allowed opacity-50'
                        }`}
                    >
                      <span className="sr-only">Previous</span>
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                      </svg>
                    </a>

                    {(() => {
                      // Build smart page numbers: 1 ... (page-2) (page-1) [page] (page+1) (page+2) ... last
                      const pages: (number | '...')[] = []
                      const delta = 2
                      const left = Math.max(2, page - delta)
                      const right = Math.min(totalPages - 1, page + delta)

                      // Always show page 1
                      pages.push(1)

                      // Left ellipsis
                      if (left > 2) pages.push('...')

                      // Middle pages
                      for (let i = left; i <= right; i++) {
                        pages.push(i)
                      }

                      // Right ellipsis
                      if (right < totalPages - 1) pages.push('...')

                      // Always show last page
                      if (totalPages > 1) pages.push(totalPages)

                      return pages.map((pageNum, idx) =>
                        pageNum === '...' ? (
                          <span
                            key={`dots-${idx}`}
                            className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-500 dark:text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-gray-600"
                          >
                            …
                          </span>
                        ) : (
                          <a
                            key={pageNum}
                            href={`/admin?page=${pageNum}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}${subcategoryFilter ? `&subcategory=${subcategoryFilter}` : ''}`}
                            className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${pageNum === page
                              ? 'z-10 bg-blue-600 text-white'
                              : 'text-gray-900 dark:text-gray-300 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                          >
                            {pageNum}
                          </a>
                        )
                      )
                    })()}

                    <a
                      href={page < totalPages ? `/admin?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}${subcategoryFilter ? `&subcategory=${subcategoryFilter}` : ''}` : '#'}
                      className={`relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 ${page < totalPages ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'cursor-not-allowed opacity-50'
                        }`}
                    >
                      <span className="sr-only">Next</span>
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                      </svg>
                    </a>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

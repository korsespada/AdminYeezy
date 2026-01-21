import { createClient } from '@/lib/pocketbase'
import { Collections, type Product, type Brand, type Category } from '@/lib/types'
import ProductList from '@/components/ProductList'

// Force dynamic rendering to prevent caching
export const dynamic = 'force-dynamic'

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; brand?: string; category?: string }
}) {
  const page = Number(searchParams.page) || 1
  const perPage = 40
  const searchTerm = searchParams.search || ''
  const brandFilter = searchParams.brand || ''
  const categoryFilter = searchParams.category || ''
  
  let products: Product[] = []
  let brands: Brand[] = []
  let categories: Category[] = []
  let totalPages = 1
  let totalItems = 0
  let error: string | null = null

  try {
    const pb = createClient()
    
    console.log('Fetching products from PocketBase...')
    console.log('Search term:', searchTerm)
    console.log('Brand filter:', brandFilter)
    console.log('Category filter:', categoryFilter)
    console.log('Auth store valid:', pb.authStore.isValid)
    
    // Build filter for search and filters
    const filters: string[] = []
    
    if (searchTerm) {
      // Make search case-insensitive and handle spaces
      // Split by spaces and search for each word
      const searchWords = searchTerm.trim().toLowerCase().split(/\s+/)
      
      if (searchWords.length === 1) {
        // Single word search - case insensitive
        const word = searchWords[0]
        filters.push(`(name ~ "${word}" || productId ~ "${word}" || description ~ "${word}")`)
      } else {
        // Multiple words - search for each word (AND logic)
        const wordFilters = searchWords.map(word => 
          `(name ~ "${word}" || productId ~ "${word}" || description ~ "${word}")`
        )
        filters.push(`(${wordFilters.join(' && ')})`)
      }
    }
    
    if (brandFilter) {
      filters.push(`brand = "${brandFilter}"`)
    }
    
    if (categoryFilter) {
      filters.push(`category = "${categoryFilter}"`)
    }
    
    const filter = filters.length > 0 ? filters.join(' && ') : ''
    
    console.log('Generated filter:', filter)
    
    // Fetch products with expanded relations
    const result = await pb.collection(Collections.Products).getList<Product>(page, perPage, {
      sort: '-created',
      expand: 'brand,category',
      filter: filter,
      requestKey: null,
    })
    console.log('Products fetched:', result.items.length)
    
    products = result.items
    totalPages = result.totalPages
    totalItems = result.totalItems
    
    // Optimize: Get brands and categories from the brand and category collections directly
    // This is much faster than scanning all products
    try {
      const brandsResult = await pb.collection(Collections.Brand).getFullList<Brand>({
        sort: 'name',
        requestKey: null,
      })
      brands = brandsResult
      console.log('Brands fetched directly:', brands.length)
    } catch (e) {
      console.log('Brand collection not found, extracting from products')
      // Fallback: extract from current page products only
      const brandMap = new Map<string, Brand>()
      products.forEach(product => {
        if (product.expand?.brand) {
          brandMap.set(product.expand.brand.id, product.expand.brand)
        }
      })
      brands = Array.from(brandMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    }
    
    try {
      const categoriesResult = await pb.collection(Collections.Category).getFullList<Category>({
        sort: 'name',
        requestKey: null,
      })
      categories = categoriesResult
      console.log('Categories fetched directly:', categories.length)
    } catch (e) {
      console.log('Category collection not found, extracting from products')
      // Fallback: extract from current page products only
      const categoryMap = new Map<string, Category>()
      products.forEach(product => {
        if (product.expand?.category) {
          categoryMap.set(product.expand.category.id, product.expand.category)
        }
      })
      categories = Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    }
    console.log('Extracted brands:', brands.length)
    console.log('Extracted categories:', categories.length)
    console.log('All data loaded successfully!')
  } catch (err: any) {
    console.error('Failed to fetch data:', err)
    console.error('Error details:', {
      message: err?.message,
      status: err?.status,
      data: err?.data,
      url: err?.url,
      isAbort: err?.isAbort,
    })
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
          <ProductList initialData={products} brands={brands} categories={categories} />
            
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 sm:px-6 rounded-lg">
              <div className="flex flex-1 justify-between sm:hidden">
                <a
                  href={page > 1 ? `/admin?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` : '#'}
                  className={`relative inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${
                    page > 1
                      ? 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  }`}
                >
                  Previous
                </a>
                <a
                  href={page < totalPages ? `/admin?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` : '#'}
                  className={`relative ml-3 inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${
                    page < totalPages
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
                      href={page > 1 ? `/admin?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` : '#'}
                      className={`relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 ${
                        page > 1 ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <span className="sr-only">Previous</span>
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                      </svg>
                    </a>
                    
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((pageNum) => (
                      <a
                        key={pageNum}
                        href={`/admin?page=${pageNum}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}`}
                        className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold ${
                          pageNum === page
                            ? 'z-10 bg-blue-600 text-white'
                            : 'text-gray-900 dark:text-gray-300 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {pageNum}
                      </a>
                    ))}
                    
                    <a
                      href={page < totalPages ? `/admin?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}${brandFilter ? `&brand=${brandFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` : '#'}
                      className={`relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 dark:ring-gray-600 ${
                        page < totalPages ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'cursor-not-allowed opacity-50'
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

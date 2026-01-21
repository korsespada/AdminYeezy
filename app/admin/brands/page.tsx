import { createClient } from '@/lib/pocketbase'
import { Collections, type Brand, type Product } from '@/lib/types'
import BrandList from '@/components/BrandList'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string }
}) {
  const page = Number(searchParams.page) || 1
  const perPage = 40
  const searchTerm = searchParams.search || ''
  
  let brands: Brand[] = []
  let totalPages = 1
  let totalItems = 0
  let error: string | null = null

  try {
    const pb = createClient()
    
    // Fetch brands directly from the brands collection (much faster!)
    let filter = ''
    if (searchTerm) {
      filter = `name ~ "${searchTerm}" || description ~ "${searchTerm}"`
    }
    
    const result = await pb.collection(Collections.Brand).getList<Brand>(page, perPage, {
      sort: 'name',
      filter: filter,
      requestKey: null,
    })
    
    brands = result.items
    totalPages = result.totalPages
    totalItems = result.totalItems
  } catch (err: any) {
    console.error('Failed to fetch brands:', err)
    error = `Failed to load brands: ${err?.message || 'Unknown error'}`
  }

  return (
    <>
      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : (
        <>
          <BrandList initialData={brands} />
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 sm:px-6 rounded-lg">
              <div className="flex flex-1 justify-between sm:hidden">
                <a
                  href={page > 1 ? `/admin/brands?page=${page - 1}` : '#'}
                  className={`relative inline-flex items-center rounded-md px-4 py-2 text-sm font-medium ${
                    page > 1
                      ? 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  }`}
                >
                  Previous
                </a>
                <a
                  href={page < totalPages ? `/admin/brands?page=${page + 1}` : '#'}
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
                      href={page > 1 ? `/admin/brands?page=${page - 1}` : '#'}
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
                        href={`/admin/brands?page=${pageNum}`}
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
                      href={page < totalPages ? `/admin/brands?page=${page + 1}` : '#'}
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

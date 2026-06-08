import ProductTrashList from '@/components/products/ProductTrashList'
import PerPageSelector from '@/components/ui/PerPageSelector'
import { getRailsCatalogLookups, listRailsAdminProducts } from '@/lib/rails-admin'
import { connection } from 'next/server'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const PRODUCT_PAGE_SIZES = [40, 100, 500]

export default async function AdminTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string }>
}) {
  await connection()
  const params = await searchParams
  const rawPage = Number(params.page)
  const rawPerPage = Number(params.perPage)
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const perPage = PRODUCT_PAGE_SIZES.includes(rawPerPage) ? rawPerPage : 40
  const offset = (page - 1) * perPage

  const buildPaginationUrl = (p: number) => {
    const params = new URLSearchParams()
    if (p !== 1) params.set('page', p.toString())
    if (perPage !== 40) params.set('perPage', perPage.toString())
    return `/admin/trash?${params.toString()}`
  }

  try {
    const [{ categories, subcategories }, productPage] = await Promise.all([
      getRailsCatalogLookups(),
      listRailsAdminProducts({
        page,
        perPage,
        status: 'archived',
      }),
    ])

    const products = productPage.products
    const totalItems = productPage.totalItems
    const totalPages = productPage.totalPages
    const shownFrom = products.length > 0 ? offset + 1 : 0
    const shownTo = products.length > 0 ? offset + products.length : 0

    return (
      <main className="min-h-screen bg-slate-900 p-6 text-slate-200">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-100">Корзина</h1>
            <p className="mt-1 text-sm text-slate-400">Товары, удалённые из каталога. Их можно восстановить или удалить навсегда.</p>
          </div>

          <ProductTrashList initialData={products} categories={categories} subcategories={subcategories} />

          {totalItems > 0 && (
            <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-xl border-t border-slate-700 bg-slate-800/50 px-4 py-4 sm:px-6 md:flex-row">
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
          )}
        </div>
      </main>
    )
  } catch (err: any) {
    console.error('Admin trash page error:', err)
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

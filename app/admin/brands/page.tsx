import BrandList from '@/components/inventory/BrandList'
import { getRailsCatalogLookups } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>
}) {
  await connection()
  const params = await searchParams
  const page = Number(params.page) || 1
  const perPage = 40
  const offset = (page - 1) * perPage
  const searchTerm = params.search?.trim().toLowerCase() || ''
  
  try {
    const { brands: allBrands } = await getRailsCatalogLookups()
    const filteredBrands = searchTerm
      ? allBrands.filter((brand) =>
          [brand.name, brand.slug, brand.description].some((value) =>
            String(value || '').toLowerCase().includes(searchTerm)
          )
        )
      : allBrands
    const brands = filteredBrands.slice(offset, offset + perPage)
    const totalItems = filteredBrands.length
    const totalPages = Math.ceil(totalItems / perPage)

    return (
      <>
        <div className="p-8">
          <BrandList initialData={brands} totalItems={totalItems} />
        </div>
        
        {totalPages > 1 && (
          <div className="mx-8 mt-6 flex items-center justify-between rounded-lg border-t border-slate-700 bg-slate-800 px-4 py-3">
             <div className="text-sm text-slate-400">
                Показано <span className="text-slate-200">{offset + 1}</span> - <span className="text-slate-200">{Math.min(offset + perPage, totalItems)}</span> из <span className="text-slate-200">{totalItems}</span>
             </div>
             <div className="flex gap-2">
                {page > 1 && (
                  <a href={`/admin/brands?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}`} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 text-slate-200">Назад</a>
                )}
                {page < totalPages && (
                  <a href={`/admin/brands?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}`} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 text-slate-200">Вперед</a>
                )}
             </div>
          </div>
        )}
      </>
    )
  } catch (err: any) {
    return <div className="m-8 rounded-lg bg-red-900/20 p-4 text-red-400">Ошибка загрузки брендов из Rails API: {err.message}</div>
  }
}

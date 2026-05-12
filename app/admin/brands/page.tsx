import { query } from '@/lib/db'
import BrandList from '@/components/inventory/BrandList'

export const dynamic = 'force-dynamic'

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string }
}) {
  const page = Number(searchParams.page) || 1
  const perPage = 40
  const offset = (page - 1) * perPage
  const searchTerm = searchParams.search || ''
  
  try {
    const whereClause = searchTerm ? 'WHERE name ILIKE $1 OR description ILIKE $1' : ''
    const params = searchTerm ? [`%${searchTerm}%`] : []

    const [brandsRes, countRes] = await Promise.all([
      query(`SELECT * FROM brands ${whereClause} ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, perPage, offset]),
      query(`SELECT COUNT(*) FROM brands ${whereClause}`, params)
    ])

    const brands = brandsRes.rows
    const totalItems = parseInt(countRes.rows[0].count)
    const totalPages = Math.ceil(totalItems / perPage)

    return (
      <>
        <BrandList initialData={brands} />
        
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-slate-700 bg-slate-800 px-4 py-3 rounded-lg">
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
    return <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">Ошибка загрузки брендов: {err.message}</div>
  }
}

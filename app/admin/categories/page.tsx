import { query } from '@/lib/db'
import CategoryList from '@/components/CategoryList'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage({
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

    const [categoriesRes, countRes] = await Promise.all([
      query(`SELECT * FROM categories ${whereClause} ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, perPage, offset]),
      query(`SELECT COUNT(*) FROM categories ${whereClause}`, params)
    ])

    const categories = categoriesRes.rows
    const totalItems = parseInt(countRes.rows[0].count)
    const totalPages = Math.ceil(totalItems / perPage)

    return (
      <>
        <CategoryList initialData={categories} />
        
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-slate-700 bg-slate-800 px-4 py-3 rounded-lg">
             <div className="text-sm text-slate-400">
                Показано <span className="text-slate-200">{offset + 1}</span> - <span className="text-slate-200">{Math.min(offset + perPage, totalItems)}</span> из <span className="text-slate-200">{totalItems}</span>
             </div>
             <nav className="flex gap-1">
                {page > 1 && (
                  <a href={`/admin/categories?page=${page - 1}${searchTerm ? `&search=${searchTerm}` : ''}`} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 text-slate-200 text-sm">Назад</a>
                )}
                {page < totalPages && (
                  <a href={`/admin/categories?page=${page + 1}${searchTerm ? `&search=${searchTerm}` : ''}`} className="px-3 py-1 bg-slate-700 rounded hover:bg-slate-600 text-slate-200 text-sm">Вперед</a>
                )}
             </nav>
          </div>
        )}
      </>
    )
  } catch (err: any) {
    return <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">Ошибка загрузки категорий: {err.message}</div>
  }
}

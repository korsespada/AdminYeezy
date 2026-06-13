import CategoryList from '@/components/inventory/CategoryList'
import { getRailsCatalogLookups } from '@/lib/rails-admin'
import { type Category, type Subcategory } from '@/lib/types'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

type CategoryLookupRow = (Category | Subcategory) & {
  kind: 'category' | 'subcategory'
  parentName?: string
}

export default async function CategoriesPage({
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
    const { categories, subcategories } = await getRailsCatalogLookups()
    const parentById = new Map(categories.map((category) => [category.id, category.name]))
    const allItems: CategoryLookupRow[] = [
      ...categories.map((category) => ({ ...category, kind: 'category' as const })),
      ...subcategories.map((subcategory) => ({
        ...subcategory,
        kind: 'subcategory' as const,
        parentName: parentById.get(subcategory.category) || 'Без родительской категории',
      })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }))
    const filteredItems = searchTerm
      ? allItems.filter((category) =>
          [category.name, category.slug, category.description, category.parentName].some((value) =>
            String(value || '').toLowerCase().includes(searchTerm)
          )
        )
      : allItems
    const pageItems = filteredItems.slice(offset, offset + perPage)
    const totalItems = filteredItems.length
    const totalPages = Math.ceil(totalItems / perPage)

    return (
      <>
        <div className="p-8">
          <CategoryList initialData={pageItems} totalItems={totalItems} />
        </div>
        
        {totalPages > 1 && (
          <div className="mx-8 mt-6 flex items-center justify-between rounded-lg border-t border-slate-700 bg-slate-800 px-4 py-3">
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
    return <div className="m-8 rounded-lg bg-red-900/20 p-4 text-red-400">Ошибка загрузки категорий из Rails API: {err.message}</div>
  }
}

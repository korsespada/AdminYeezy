import { query } from '@/lib/db'
import { type Product, type Brand, type Category, type Subcategory } from '@/lib/types'
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
    // 1. Сбор условий и параметров для SQL
    const conditions: string[] = []
    const params: any[] = []
    let pIdx = 1

    if (searchTerm) {
      conditions.push(`(p.name ILIKE $${pIdx} OR p.id ILIKE $${pIdx} OR p.description ILIKE $${pIdx})`)
      params.push(`%${searchTerm}%`)
      pIdx++
    }

    if (brandFilter) {
      const brandIds = brandFilter.split(',')
      conditions.push(`p.brand && $${pIdx}::text[]`) // Используем оператор пересечения массивов
      params.push(brandIds)
      pIdx++
    }

    if (categoryFilter) {
      conditions.push(`p.category = $${pIdx}`)
      params.push(categoryFilter)
      pIdx++
    }

    if (subcategoryFilter) {
      if (subcategoryFilter === '__none__') {
        conditions.push(`(p.subcategory IS NULL OR p.subcategory = '')`)
      } else {
        conditions.push(`p.subcategory = $${pIdx}`)
        params.push(subcategoryFilter)
        pIdx++
      }
    }

    if (genderFilter) {
      if (genderFilter === '__none__') {
        conditions.push(`(p.gender IS NULL OR p.gender = '')`)
      } else {
        conditions.push(`p.gender = $${pIdx}`)
        params.push(genderFilter)
        pIdx++
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 2. Выполнение запросов параллельно
    const [
      categoriesRes,
      subcategoriesRes,
      brandsRes,
      productsRes,
      countRes
    ] = await Promise.all([
      query('SELECT * FROM categories ORDER BY name ASC'),
      query('SELECT * FROM subcategories ORDER BY name ASC'),
      query('SELECT * FROM brands ORDER BY name ASC'),
      query(`
        SELECT p.*, 
               c.name as category_name, 
               s.name as subcategory_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category
        LEFT JOIN subcategories s ON s.id = p.subcategory
        ${whereClause}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `, [...params, perPage, offset]),
      query(`SELECT COUNT(*) FROM products p ${whereClause}`, params)
    ])

    const totalItems = parseInt(countRes.rows[0].count)
    const totalPages = Math.ceil(totalItems / perPage)

    // Преобразуем данные из Postgres в формат, который понимает React-компонент
    const allBrands: Brand[] = brandsRes.rows
    
    const products: Product[] = productsRes.rows.map(row => {
      // Ищем названия брендов по их ID
      const brandIds: string[] = Array.isArray(row.brand) ? row.brand : [];
      const expandedBrands = brandIds.map((id: string) => {
        const found = allBrands.find(b => b.id === id);
        return found ? { id: found.id, name: found.name } : { id, name: 'Unknown Brand' };
      });

      return {
        ...row,
        // В Postgres фото лежат как JSON или массив, в JS это уже должен быть объект
        photos: typeof row.photos === 'string' ? JSON.parse(row.photos) : (row.photos || []),
        expand: {
          category: row.category_name ? { name: row.category_name, id: row.category } : undefined,
          subcategory: row.subcategory_name ? { name: row.subcategory_name, id: row.subcategory } : undefined,
          // Передаем массив расширенных брендов
          brand: expandedBrands.length > 0 ? expandedBrands : undefined
        }
      }
    })

    const categories: Category[] = categoriesRes.rows
    const subcategories: Subcategory[] = subcategoriesRes.rows
    
    // В админке бренды в сайдбаре обычно все, либо отфильтрованные
    const brands = allBrands 

    return (
      <ProductList
        initialData={products}
        brands={brands}
        allBrands={allBrands}
        categories={categories}
        subcategories={subcategories}
        activeSubcategoryIds={[]} // Можно вычислить при необходимости
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
                    const p = i + 1;
                    if (p < page - 2 || p > page + 2) return null; // Ограничиваем кол-во кнопок
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
        <h2 className="text-xl font-bold mb-2">Ошибка подключения к базе</h2>
        <p>{err.message}</p>
        <p className="mt-4 text-sm opacity-70">Проверьте настройки в Vercel и доступность IP 85.198.97.100</p>
      </div>
    )
  }
}

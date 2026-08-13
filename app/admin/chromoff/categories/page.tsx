import ChromoffCategoriesManager from '@/components/chromoff/ChromoffCategoriesManager'
import { getRailsCatalogLookups, listRailsChromoffCategories } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function ChromoffCategoriesPage() {
  await connection()

  try {
    const [categories, lookups] = await Promise.all([
      listRailsChromoffCategories(),
      getRailsCatalogLookups(),
    ])

    return (
      <ChromoffCategoriesManager
        categories={categories}
        catalogCategories={lookups.categories}
        catalogSubcategories={lookups.subcategories}
      />
    )
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось загрузить разделы Chromoff. {error instanceof Error ? error.message : 'Проверьте доступность Rails API.'}
        </div>
      </main>
    )
  }
}

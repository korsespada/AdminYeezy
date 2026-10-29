import ChromoffFiltersManager from '@/components/chromoff/ChromoffFiltersManager'
import { listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function ChromoffFiltersPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await connection()

  try {
    const categories = await listRailsChromoffCategories()
    const subcategories = categories.filter((category) => category.parent_id)
    const requested = (await searchParams).category
    const selected = subcategories.find((category) => category.id === requested)
      || subcategories.find((category) => category.filters?.length)
      || subcategories[0]
    // Предпросмотр показывает то же, что витрина: только опубликованные товары.
    const listings = selected
      ? (await listRailsChromoffListings({ categoryId: selected.id, published: true, perPage: 500 })).items
      : []

    return (
      <ChromoffFiltersManager
        key={selected?.id || 'empty'}
        categories={categories}
        selected={selected || null}
        listings={listings}
      />
    )
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось загрузить фильтры Chromoff. {error instanceof Error ? error.message : 'Проверьте доступность Rails API.'}
        </div>
      </main>
    )
  }
}

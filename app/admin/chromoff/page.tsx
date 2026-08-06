import ChromoffCatalog from '@/components/chromoff/ChromoffCatalog'
import { listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function ChromoffPage() {
  await connection()
  try {
    const [categories, listings] = await Promise.all([
      listRailsChromoffCategories(),
      listRailsChromoffListings({ page: 1, perPage: 50 }),
    ])
    return <ChromoffCatalog categories={categories} listings={listings.items} totalItems={listings.totalItems} />
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Раздел Chromoff ожидает миграцию Rails API. {error instanceof Error ? error.message : ''}
        </div>
      </main>
    )
  }
}

import ChromoffCatalog from '@/components/chromoff/ChromoffCatalog'
import { listRailsChromoffCandidates, listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 48

type ChromoffSearchParams = {
  page?: string
  q?: string
  category?: string
  subcategory?: string
  minPrice?: string
  maxPrice?: string
  published?: string
}

function positivePage(value?: string) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

export default async function ChromoffPage({
  searchParams,
}: {
  searchParams: Promise<ChromoffSearchParams>
}) {
  await connection()
  const params = await searchParams
  const page = positivePage(params.page)
  const filters = {
    q: params.q?.trim() || '',
    category: params.category || '',
    subcategory: params.subcategory || '',
    minPrice: params.minPrice || '',
    maxPrice: params.maxPrice || '',
    published: ['published', 'hidden'].includes(params.published || '') ? params.published as 'published' | 'hidden' : 'all' as const,
  }

  try {
    const [categories, listings, candidates] = await Promise.all([
      listRailsChromoffCategories(),
      listRailsChromoffListings({
        page,
        perPage: PAGE_SIZE,
        search: filters.q,
        categoryId: filters.subcategory || filters.category,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        published: filters.published === 'all' ? undefined : filters.published === 'published',
      }),
      listRailsChromoffCandidates(),
    ])
    return (
      <ChromoffCatalog
        categories={categories}
        listings={listings.items}
        candidates={candidates}
        totalItems={listings.totalItems}
        totalPages={listings.totalPages}
        page={page}
        filters={filters}
      />
    )
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

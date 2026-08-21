import { connection } from 'next/server'
import ChromoffAiSeoStudio from '@/components/chromoff/ChromoffAiSeoStudio'
import { getChromoffAiDashboardAction, getChromoffAiSettingsAction } from '@/actions/chromoff-ai'
import { listRailsChromoffAiListings, listRailsChromoffCategories } from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

type SearchParams = {
  q?: string
  category?: string
  subcategory?: string
  page?: string
  perPage?: string
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default async function ChromoffAiSeoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection()
  const params = await searchParams
  const page = positiveInt(params.page, 1)
  const perPage = [40, 100, 500].includes(positiveInt(params.perPage, 40)) ? positiveInt(params.perPage, 40) : 40

  try {
    const [categories, settingsResult] = await Promise.all([
      listRailsChromoffCategories(),
      getChromoffAiSettingsAction(),
    ])
    const listings = await listRailsChromoffAiListings({
      page,
      perPage,
      search: params.q?.trim(),
      categoryId: params.subcategory || params.category,
    })
    const dashboard = await getChromoffAiDashboardAction(listings.items.map((listing) => listing.id))

    return (
      <ChromoffAiSeoStudio
        categories={categories}
        listings={listings.items}
        totalItems={listings.totalItems}
        totalPages={listings.totalPages}
        page={page}
        perPage={perPage}
        settings={settingsResult.data}
        dashboard={dashboard.data}
      />
    )
  } catch (error) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось открыть AI SEO Chromoff. {error instanceof Error ? error.message : 'Проверьте Rails API и scraping DB.'}
        </div>
      </main>
    )
  }
}

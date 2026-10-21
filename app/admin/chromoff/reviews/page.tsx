import ChromoffReviewsManager from '@/components/chromoff/ChromoffReviewsManager'
import { listRailsChromoffReviews } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function ChromoffReviewsPage() {
  await connection()

  try {
    const reviews = await listRailsChromoffReviews()
    return <ChromoffReviewsManager initialReviews={reviews} />
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось загрузить отзывы. {error instanceof Error ? error.message : 'Проверьте доступность Rails API.'}
        </div>
      </main>
    )
  }
}

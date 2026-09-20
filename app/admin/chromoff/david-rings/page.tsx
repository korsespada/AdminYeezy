import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { connection } from 'next/server'
import DavidRingMatchPanel from '@/components/chromoff/DavidRingMatchPanel'
import { getRingMatchOverviewAction } from '@/actions/david-ring-match'
import type { RingMatchOverview } from '@/actions/david-ring-match'

export const dynamic = 'force-dynamic'

/**
 * Экран развязки дублей колец Chromoff и David Studio.
 *
 * Данные читаются экшеном, а не напрямую: он же отдаёт их клиентской панели при
 * каждом обновлении, поэтому логика остаётся в одном месте.
 */
export default async function DavidRingMatchPage() {
  await connection()
  const result = await getRingMatchOverviewAction()

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/admin/chromoff"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" /> К каталогу Chromoff
      </Link>

      {result.success ? (
        <DavidRingMatchPanel initial={result.data as RingMatchOverview} />
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось прочитать сопоставления: {result.error}
        </div>
      )}
    </div>
  )
}

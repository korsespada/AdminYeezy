import { getAiUsageAction } from '@/actions/ai-usage'
import AiUsageDashboard from '@/components/ai/AiUsageDashboard'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await searchParams
  const periodDays = days === 'all' ? null : Number(days) > 0 ? Number(days) : 30
  const result = await getAiUsageAction(periodDays)

  return (
    <div className="p-4 sm:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8">
        <ImportTabs />
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-white">Использование ИИ</h1>
          <p className="text-slate-400">Токены и стоимость запросов к моделям: по выгрузкам, поставщикам, моделям и дням</p>
        </div>
        {result.success
          ? <AiUsageDashboard report={result.data} />
          : <div className="rounded-xl border border-red-500/30 bg-red-950/50 p-4 text-sm text-red-200">{result.error}</div>}
      </div>
    </div>
  )
}

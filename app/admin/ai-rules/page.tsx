import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import AIRulesEditor from '@/components/ai/AIRulesEditor'
import ImportTabs from '@/components/ui/ImportTabs'
import { getRailsCatalogLookups } from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

export default async function AIRulesPage() {
  const [settingsResult, lookups] = await Promise.all([
    getBatchAiSettingsAction(),
    getRailsCatalogLookups(),
  ])

  return (
    <div className="p-4 sm:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8">
        <ImportTabs />
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки интеллекта</h1>
          <p className="text-slate-400">Глобальные настройки обработки китайских товаров в «Выгрузках»</p>
        </div>
        <AIRulesEditor initialSettings={settingsResult.data} initialCategories={lookups.categories} initialSubcategories={lookups.subcategories} />
      </div>
    </div>
  )
}

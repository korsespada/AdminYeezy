import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import AIRulesEditor from '@/components/ai/AIRulesEditor'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default async function AIRulesPage() {
  const settingsResult = await getBatchAiSettingsAction()

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки интеллекта</h1>
          <p className="text-slate-400">Глобальные настройки обработки китайских товаров в «Выгрузках»</p>
        </div>
        <ImportTabs />
        <AIRulesEditor initialSettings={settingsResult.data} />
      </div>
    </div>
  )
}

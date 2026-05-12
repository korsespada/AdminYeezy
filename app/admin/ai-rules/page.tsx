import { getSettingAction } from '@/actions/settings'
import AIRulesEditor from '@/components/ai/AIRulesEditor'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default async function AIRulesPage() {
  const rulesRes = await getSettingAction('general_ai_rules')
  const modelsRes = await getSettingAction('available_ai_models')
  const selectedModelRes = await getSettingAction('selected_ai_model')
  
  const initialModels = modelsRes.data ? JSON.parse(modelsRes.data) : []
  const initialSelectedModel = selectedModelRes.data || ''

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки интеллекта</h1>
          <p className="text-slate-400">Управление глобальными правилами и выбор ИИ моделей</p>
        </div>
        <ImportTabs />
        <AIRulesEditor 
            initialRules={rulesRes.data || ''} 
            initialModels={initialModels} 
            initialSelectedModel={initialSelectedModel}
        />
      </div>
    </div>
  )
}

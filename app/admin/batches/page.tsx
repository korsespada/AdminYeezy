import { getExportHistoryAction } from '@/actions/suppliers'
import ExportHistoryList from '@/components/import/ExportHistoryList'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default async function BatchesPage() {
  const res = await getExportHistoryAction()
  
  if (!res.success) {
    return <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">Ошибка загрузки истории выгрузок: {res.error}</div>
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <ImportTabs />
        <ExportHistoryList initialData={res.data} />
      </div>
    </div>
  )
}

import { getExportsV2DashboardAction } from '@/actions/exports-v2'
import ExportsV2Dashboard from '@/components/exports-v2/ExportsV2Dashboard'
import ImportTabs from '@/components/ui/ImportTabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

export default async function ExportsV2Page() {
  const result = await getExportsV2DashboardAction()

  return (
    <div className="p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <ImportTabs />
        {!result.success ? (
          <Alert className="border-red-500/30 bg-red-950/30 text-red-100">
            <AlertTitle>Выгрузка 2.0 недоступна</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        ) : (
          <ExportsV2Dashboard initialData={result.data} />
        )}
      </div>
    </div>
  )
}

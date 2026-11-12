import {
  getExportHistoryAction,
  getSupplierCatalogLookupsAction,
  getSupplierSiteCountsAction,
  getSuppliersAction,
} from '@/actions/suppliers'
import ExportFeed from '@/components/import/ExportFeed'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default async function BatchesPage() {
  // Единая лента: поставщики, их партии и счётчики сайта читаются
  // параллельно, справочники каталога нужны окну настроек поставщика.
  const [res, suppliersResult, lookupsResult, siteCountsResult] = await Promise.all([
    getExportHistoryAction(),
    getSuppliersAction(),
    getSupplierCatalogLookupsAction(),
    getSupplierSiteCountsAction(),
  ])

  if (!res.success || !suppliersResult.success) {
    const db = res.data?.kind === 'scraping_db_unreachable' ? res.data.db : null

    return (
      <div className="p-4 sm:p-8">
        <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8">
          <ImportTabs />
          <Alert className="border-red-500/30 bg-red-950/30 text-red-100">
            <AlertTitle className="text-base text-red-200">Выгрузка временно недоступна</AlertTitle>
            <AlertDescription className="space-y-4 text-red-100/90">
              <p>{res.error || suppliersResult.error}</p>
              {db && (
                <div className="rounded-lg border border-red-500/20 bg-slate-950/50 p-4 text-sm text-slate-200">
                  <div className="font-semibold text-white">Текущее подключение без секретов</div>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                    <span>Env: {db.source}</span>
                    <span>Host: {db.host}</span>
                    <span>Port: {db.port}</span>
                    <span>DB: {db.database}</span>
                  </div>
                </div>
              )}
              <ul className="list-disc space-y-1 pl-5 text-sm text-red-100/80">
                <li>Проверьте <code>SCRAPING_DATABASE_URL</code> в Coolify для AdminYeezy.</li>
                <li>Убедитесь, что контейнер видит Postgres по host/port и разрешен firewall или allowlist.</li>
                <li>Если Postgres в том же Coolify/VPS, используйте внутренний hostname сервиса вместо внешнего IP.</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 p-4 sm:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8">
        <ImportTabs />
        <ExportFeed
          initialSuppliers={suppliersResult.data}
          catalogLookups={lookupsResult.success ? lookupsResult.data : { brands: [], categories: [], subcategories: [] }}
          initialBatches={res.data}
          initialSiteCounts={siteCountsResult.success ? siteCountsResult.data : {}}
        />
      </div>
    </div>
  )
}

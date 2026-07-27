import SeoAiStudio from '@/components/seo-ai/SeoAiStudio'
import { getRailsCatalogLookups, getRailsSeoAiSettings, listRailsSeoAiBatches, listRailsSeoAiDrafts } from '@/lib/rails-admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

export default async function SeoAiPage() {
  try {
    const [settings, drafts, batches, lookups] = await Promise.all([
      getRailsSeoAiSettings(),
      listRailsSeoAiDrafts({ limit: 100 }),
      listRailsSeoAiBatches(),
      getRailsCatalogLookups(),
    ])

    return (
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">AI-каталог</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Названия, описания, SEO, гендер, характеристики и предложения подкатегорий для опубликованных товаров. Задания выполняет локальный Cockpit Tools worker, изменения сначала попадают в сравнение.
            </p>
          </div>
          <SeoAiStudio
            initialSettings={settings.filter((setting) => setting.task_key === 'catalog_product_enricher')}
            initialDrafts={drafts}
            initialBatches={batches}
            brands={lookups.brands}
            categories={lookups.categories}
            subcategories={lookups.subcategories}
          />
        </div>
      </div>
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-300">
        <AlertTitle>AI SEO Studio недоступен</AlertTitle>
        <AlertDescription>{error.message || 'Не удалось подключиться к Rails API.'}</AlertDescription>
      </Alert>
    )
  }
}

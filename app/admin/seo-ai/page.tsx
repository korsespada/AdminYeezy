import SeoAiStudio from '@/components/seo-ai/SeoAiStudio'
import { getRailsCatalogLookups, getRailsSeoAiSettings, listRailsSeoAiBatches, listRailsSeoAiDrafts } from '@/lib/rails-admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

export const dynamic = 'force-dynamic'

export default async function SeoAiPage() {
  try {
    const [settings, drafts, batches, lookups, attributeDefinitions] = await Promise.all([
      getRailsSeoAiSettings(),
      listRailsSeoAiDrafts({ limit: 100 }),
      listRailsSeoAiBatches(),
      getRailsCatalogLookups(),
      getCatalogAttributeDefinitions(),
    ])

    return (
      <div className="min-w-0 overflow-x-hidden p-3 sm:p-4 lg:p-6 2xl:p-8">
        <div className="mx-auto w-full min-w-0 max-w-[1800px] space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">AI-каталог</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Названия, описания, SEO, гендер, характеристики и распределение по существующим подкатегориям для опубликованных товаров. По умолчанию используется BYESU, изменения сначала попадают в сравнение.
            </p>
          </div>
          <SeoAiStudio
            initialSettings={settings.filter((setting) => setting.task_key === 'catalog_product_enricher')}
            initialDrafts={drafts}
            initialBatches={batches}
            brands={lookups.brands}
            categories={lookups.categories}
            subcategories={lookups.subcategories}
            attributeDefinitions={attributeDefinitions}
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

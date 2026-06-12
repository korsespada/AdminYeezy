import SeoAiStudio from '@/components/seo-ai/SeoAiStudio'
import { getRailsCatalogLookups, getRailsSeoAiSettings, listRailsSeoAiDrafts } from '@/lib/rails-admin'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

export default async function SeoAiPage() {
  try {
    const [settings, drafts, lookups] = await Promise.all([
      getRailsSeoAiSettings(),
      listRailsSeoAiDrafts({ limit: 100 }),
      getRailsCatalogLookups(),
    ])

    return (
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">AI SEO Studio</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Генерация SEO-черновиков для товаров, брендов, категорий и лендингов. OpenRouter вызывается только через Rails API, публикация происходит вручную через apply.
            </p>
          </div>
          <SeoAiStudio
            initialSettings={settings}
            initialDrafts={drafts}
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

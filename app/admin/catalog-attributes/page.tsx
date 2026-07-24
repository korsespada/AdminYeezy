import { connection } from 'next/server'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import CatalogAttributeReview from '@/components/catalog-attributes/CatalogAttributeReview'
import { getRailsCatalogLookups, listRailsCatalogAttributeSuggestions } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

export const dynamic = 'force-dynamic'

export default async function CatalogAttributesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    query?: string
    status?: string
    attribute?: string
    source?: string
    brand?: string
    category?: string
    subcategory?: string
    suggested_value?: string
    per_page?: string
  }>
}) {
  await connection()
  const params = await searchParams
  const filters = {
    query: params.query?.trim() || '',
    status: params.status?.trim() || 'suggested',
    attributeCode: params.attribute?.trim() || '',
    source: params.source?.trim() || '',
    brand: params.brand?.trim() || '',
    category: params.category?.trim() || '',
    subcategory: params.subcategory?.trim() || '',
    suggestedValue: params.suggested_value?.trim() || '',
    perPage: [20, 30, 50, 100].includes(Number(params.per_page)) ? Number(params.per_page) : 30,
  }

  try {
    const [result, lookups, attributeDefinitions] = await Promise.all([
      listRailsCatalogAttributeSuggestions({
        page: Math.max(1, Number(params.page) || 1),
        ...filters,
        status: filters.status === 'all' ? '' : filters.status,
      }),
      getRailsCatalogLookups(),
      getCatalogAttributeDefinitions(),
    ])

    return (
      <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header>
            <p className="text-sm font-medium text-indigo-300">Каталог · качество данных</p>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Атрибуты товаров</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Проверка автоматически выделенных брендов, моделей, размеров, цветов и характеристик. Подтверждение записывает только структурированный атрибут; исходное название и URL товара сохраняются.
            </p>
          </header>
          <CatalogAttributeReview
            initialResult={result}
            filters={filters}
            brands={lookups.brands}
            categories={lookups.categories}
            subcategories={lookups.subcategories}
            attributeDefinitions={attributeDefinitions}
          />
        </div>
      </main>
    )
  } catch (error: any) {
    return (
      <Alert variant="destructive" className="m-8 border-red-800 bg-red-900/20 text-red-300">
        <AlertTitle>Атрибуты товаров недоступны</AlertTitle>
        <AlertDescription>{error.message || 'Не удалось подключиться к Rails API.'}</AlertDescription>
      </Alert>
    )
  }
}

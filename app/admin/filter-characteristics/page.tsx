import CatalogAttributeRegistry from '@/components/catalog-attributes/CatalogAttributeRegistry'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

export const dynamic = 'force-dynamic'

export default async function FilterCharacteristicsPage() {
  const definitions = await getCatalogAttributeDefinitions()

  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <p className="text-sm font-medium text-indigo-300">Товары · структура каталога</p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Схема атрибутов</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Единый справочник Rails для товаров, поставщиков, AI и витрины. Изменения подписей,
            алиасов и активности сразу применяются к фильтрам сайта без отдельной синхронизации.
          </p>
        </header>
        <CatalogAttributeRegistry initialDefinitions={definitions} />
      </div>
    </main>
  )
}

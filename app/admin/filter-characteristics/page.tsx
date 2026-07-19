import Link from 'next/link'
import CatalogAttributeRegistry from '@/components/catalog-attributes/CatalogAttributeRegistry'
import { Button } from '@/components/ui/button'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

export const dynamic = 'force-dynamic'

export default async function FilterCharacteristicsPage() {
  const definitions = await getCatalogAttributeDefinitions()

  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-indigo-300">Товары · структура каталога</p>
            <h1 className="mt-2 text-3xl font-bold tracking-normal text-white">Фильтры и характеристики</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Единый список атрибутов по категориям. Здесь задаётся, что показывать в карточке,
              использовать в фильтрах и превращать в выбираемые варианты товара.
            </p>
          </div>
          <Button asChild variant="outline" className="border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white">
            <Link href="/admin/catalog-attributes">Проверить предложения AI</Link>
          </Button>
        </header>
        <CatalogAttributeRegistry initialDefinitions={definitions} />
      </div>
    </main>
  )
}

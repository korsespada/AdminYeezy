'use client'

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { importChromoffCatalogAction, previewChromoffImportAction, setChromoffListingPublishedAction } from '@/actions/chromoff'
import type { RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'

export default function ChromoffCatalog({
  listings,
  categories,
  totalItems,
}: {
  listings: RailsChromoffListing[]
  categories: RailsChromoffCategory[]
  totalItems: number
}) {
  const [, startTransition] = useTransition()
  const [importMessage, setImportMessage] = useState('')
  const [canImport, setCanImport] = useState(false)
  const mappedCategories = categories.filter((category) => category.catalog_category)

  return (
    <main className="min-h-full bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="bg-violet-500/15 text-violet-200 hover:bg-violet-500/15">Отдельная витрина</Badge>
              <h1 className="mt-3 text-3xl font-bold text-white">Chromoff</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Chrome Hearts: своя структура меню и ручная публикация на Chromoff. Категории YeezyUnique используются только как техническое сопоставление.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
              <div className="text-slate-500">Товаров в Rails</div>
              <div className="mt-1 text-2xl font-semibold text-white">{totalItems.toLocaleString('ru-RU')}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <span>Подкатегорий Chromoff: {categories.filter((category) => category.parent_id).length}</span>
            <span>Сопоставлено с Rails: {mappedCategories.length}</span>
            <span>Непривязанных: {categories.length - mappedCategories.length}</span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => startTransition(async () => {
                const response = await previewChromoffImportAction()
                if (!response.success) {
                  setCanImport(false)
                  setImportMessage(response.message || 'Dry-run завершился с ошибкой.')
                  return
                }
                const result = response.result
                if (!result) {
                  setCanImport(false)
                  setImportMessage('Dry-run не вернул результат.')
                  return
                }
                const ready = result.categories_missing_catalog_mapping === 0 && result.missing_category_sources.length === 0
                setCanImport(ready)
                setImportMessage(
                  `Проверено: ${result.products_received.toLocaleString('ru-RU')} товаров, ${result.categories_received} категорий. ` +
                  (ready ? 'Ошибок сопоставления нет — импорт можно запускать.' : `Непривязанных категорий: ${result.categories_missing_catalog_mapping}.`),
                )
              })}
            >
              Проверить импорт
            </Button>
            <Button
              type="button"
              disabled={!canImport}
              onClick={() => startTransition(async () => {
                const response = await importChromoffCatalogAction()
                setImportMessage(response.success
                  ? `Импортировано: ${Number(response.imported || 0).toLocaleString('ru-RU')} товаров. Все они скрыты в витрине до ручной публикации.`
                  : response.message || 'Импорт не выполнен.')
              })}
            >
              Импортировать каталог
            </Button>
            {importMessage && <span className="text-sm text-slate-300">{importMessage}</span>}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-5 py-4 text-sm text-slate-400">
            Импорт создаёт товары в общем каталоге, но сразу ставит им noindex и не публикует в Chromoff. Публикация — вручную у каждого товара.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-sm">
              <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Товар</th>
                  <th className="px-5 py-3">Категория Chromoff</th>
                  <th className="px-5 py-3">Статус Rails</th>
                  <th className="px-5 py-3">Публикация</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {listings.map((listing) => (
                  <tr key={listing.id}>
                    <td className="px-5 py-4">
                      <div className="font-medium text-white">{listing.name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{listing.legacy_slug}</div>
                    </td>
                    <td className="px-5 py-4 text-slate-300">{listing.chromoff_category?.name || 'Не назначена'}</td>
                    <td className="px-5 py-4"><Badge variant="outline" className="border-slate-700 text-slate-300">{listing.status}</Badge></td>
                    <td className="px-5 py-4">
                      <form action={(formData) => startTransition(async () => { await setChromoffListingPublishedAction(formData) })}>
                        <input type="hidden" name="id" value={listing.id} />
                        <input type="hidden" name="published" value={String(!listing.published)} />
                        <Button type="submit" size="sm" variant={listing.published ? 'outline' : 'default'}>
                          {listing.published ? 'Скрыть' : 'Опубликовать'}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {listings.length === 0 && (
            <div className="px-5 py-14 text-center text-sm text-slate-500">Пока нет импортированных товаров Chromoff.</div>
          )}
        </section>
      </div>
    </main>
  )
}

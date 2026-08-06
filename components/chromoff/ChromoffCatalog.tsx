'use client'

import Image from 'next/image'
import { useMemo, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createChromoffListingAction, importChromoffCatalogAction, previewChromoffImportAction, setChromoffListingPublishedAction } from '@/actions/chromoff'
import type { RailsChromoffCandidate, RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'

type ChromoffFilters = {
  q: string
  category: string
  subcategory: string
  minPrice: string
  maxPrice: string
  published: 'all' | 'published' | 'hidden'
}

function formatPrice(priceCents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(priceCents / 100)
}

export default function ChromoffCatalog({
  listings,
  categories,
  candidates,
  totalItems,
  totalPages,
  page,
  filters,
}: {
  listings: RailsChromoffListing[]
  categories: RailsChromoffCategory[]
  candidates: RailsChromoffCandidate[]
  totalItems: number
  totalPages: number
  page: number
  filters: ChromoffFilters
}) {
  const [isPending, startTransition] = useTransition()
  const [importMessage, setImportMessage] = useState('')
  const [canImport, setCanImport] = useState(false)
  const [listingMessage, setListingMessage] = useState('')
  const [categoryId, setCategoryId] = useState(filters.category)
  const mappedCategories = categories.filter((category) => category.catalog_category)
  const rootCategories = categories.filter((category) => !category.parent_id)
  const subcategories = categories.filter((category) => category.parent_id && (!categoryId || category.parent_id === categoryId))
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])

  const buildUrl = (nextPage = 1) => {
    const params = new URLSearchParams()
    if (nextPage > 1) params.set('page', String(nextPage))
    if (filters.q) params.set('q', filters.q)
    if (filters.category) params.set('category', filters.category)
    if (filters.subcategory) params.set('subcategory', filters.subcategory)
    if (filters.minPrice) params.set('minPrice', filters.minPrice)
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice)
    if (filters.published !== 'all') params.set('published', filters.published)
    const query = params.toString()
    return query ? `/admin/chromoff?${query}` : '/admin/chromoff'
  }

  const previewImport = () => {
    setImportMessage('Проверяем источник и сопоставление категорий…')
    startTransition(async () => {
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
      setImportMessage(`Проверено: ${result.products_received.toLocaleString('ru-RU')} товаров, ${result.categories_received} категорий. ${ready ? 'Ошибок сопоставления нет — импорт можно запускать.' : `Непривязанных категорий: ${result.categories_missing_catalog_mapping}.`}`)
    })
  }

  const importCatalog = () => {
    setImportMessage('Импорт запущен: переносим товары и фотографии в общий каталог. Это может занять несколько минут — не закрывай страницу.')
    startTransition(async () => {
      const response = await importChromoffCatalogAction()
      setImportMessage(response.success
        ? `Импортировано: ${Number(response.imported || 0).toLocaleString('ru-RU')} товаров. Текущие активные карточки сохранены опубликованными.`
        : response.message || 'Импорт не выполнен.')
    })
  }

  return (
    <main className="min-h-full bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge className="bg-violet-500/15 text-violet-200 hover:bg-violet-500/15">Отдельная витрина</Badge>
              <h1 className="mt-3 text-3xl font-bold text-white">Chromoff</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Chrome Hearts: свои разделы и подкатегории, но общий товар, цена и фотографии из YeezyUnique.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
              <div className="text-slate-500">По текущему фильтру</div>
              <div className="mt-1 text-2xl font-semibold text-white">{totalItems.toLocaleString('ru-RU')}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <span>Подкатегорий Chromoff: {categories.filter((category) => category.parent_id).length}</span>
            <span>Сопоставлено с Rails: {mappedCategories.length}</span>
            <span>Непривязанных: {categories.length - mappedCategories.length}</span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={isPending} onClick={previewImport}>
              {isPending ? 'Проверяем…' : 'Проверить импорт'}
            </Button>
            <Button type="button" disabled={!canImport || isPending} onClick={importCatalog}>
              {isPending ? 'Импортируем…' : 'Импортировать каталог'}
            </Button>
            {importMessage && <span className="text-sm text-slate-300" role="status" aria-live="polite">{importMessage}</span>}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <form action="/admin/chromoff" className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <input name="q" defaultValue={filters.q} placeholder="Поиск по названию" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 xl:col-span-2" />
            <select name="category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Все разделы</option>
              {rootCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select name="subcategory" defaultValue={filters.subcategory} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Все подкатегории</option>
              {subcategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <input type="number" name="minPrice" min="0" step="1" defaultValue={filters.minPrice} placeholder="Цена от, ₽" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
            <input type="number" name="maxPrice" min="0" step="1" defaultValue={filters.maxPrice} placeholder="Цена до, ₽" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
            <select name="published" defaultValue={filters.published} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="all">Все статусы</option>
              <option value="published">Опубликованные</option>
              <option value="hidden">Скрытые</option>
            </select>
            <div className="flex gap-2 xl:col-span-2">
              <Button type="submit">Применить</Button>
              <Button asChild type="button" variant="outline"><a href="/admin/chromoff">Сбросить</a></Button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold text-white">Добавить новый товар</h2>
          <p className="mt-1 text-sm text-slate-400">Только товары бренда Chrome Hearts, которых ещё нет в Chromoff.</p>
          <form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" action={(formData) => startTransition(async () => {
            const response = await createChromoffListingAction(formData)
            setListingMessage(response.message)
          })}>
            <select name="product_id" required className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Выбери товар</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
            <select name="chromoff_category_id" required className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Выбери подкатегорию</option>
              {categories.filter((category) => category.parent_id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <div className="flex items-center gap-3"><input type="hidden" name="published" value="true" /><Button type="submit">Добавить и опубликовать</Button></div>
          </form>
          {listingMessage && <p className="mt-3 text-sm text-slate-300">{listingMessage}</p>}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Товары Chromoff</h2>
              <p className="text-sm text-slate-400">Карточки используют те же фотографии и цену общего товара YeezyUnique.</p>
            </div>
            <span className="text-sm text-slate-400">Страница {page} из {Math.max(totalPages, 1)}</span>
          </div>
          {listings.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {listings.map((listing) => {
                const category = listing.chromoff_category
                const parent = category?.parent_id ? categoryById.get(category.parent_id) : null
                const image = listing.images?.[0] || listing.image_url
                return (
                  <Card key={listing.id} className="overflow-hidden border-slate-800 bg-slate-950 shadow-sm">
                    <div className="relative aspect-square bg-slate-800">
                      {image ? <Image src={image} alt={listing.name} fill sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">Нет фото</div>}
                      <Badge className={`absolute left-3 top-3 ${listing.published ? 'bg-emerald-500/90 text-white' : 'bg-slate-700/90 text-slate-200'}`}>{listing.published ? 'Опубликован' : 'Скрыт'}</Badge>
                    </div>
                    <CardContent className="space-y-3 p-4">
                      <div>
                        <p className="line-clamp-2 min-h-10 font-medium leading-5 text-white">{listing.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{parent ? `${parent.name} · ` : ''}{category?.name || 'Категория не назначена'}</p>
                      </div>
                      <div className="flex items-center justify-between gap-2"><span className="text-lg font-semibold text-white">{formatPrice(listing.price_cents)}</span><Badge variant="outline" className="border-slate-700 text-slate-300">{listing.status}</Badge></div>
                      <form action={(formData) => startTransition(async () => { await setChromoffListingPublishedAction(formData) })}>
                        <input type="hidden" name="id" value={listing.id} />
                        <input type="hidden" name="published" value={String(!listing.published)} />
                        <Button type="submit" size="sm" variant={listing.published ? 'outline' : 'default'} className="w-full">{listing.published ? 'Скрыть с Chromoff' : 'Опубликовать на Chromoff'}</Button>
                      </form>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ) : <div className="py-14 text-center text-sm text-slate-500">По этим фильтрам товаров нет.</div>}
          {totalPages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Страницы товаров Chromoff">
              <Button asChild variant="outline" size="sm" className={page === 1 ? 'pointer-events-none opacity-50' : ''}><a href={buildUrl(Math.max(1, page - 1))}>Назад</a></Button>
              {[...Array(totalPages)].map((_, index) => {
                const itemPage = index + 1
                if (itemPage < page - 2 || itemPage > page + 2) return null
                return <Button key={itemPage} asChild size="sm" variant={itemPage === page ? 'default' : 'outline'}><a href={buildUrl(itemPage)}>{itemPage}</a></Button>
              })}
              <Button asChild variant="outline" size="sm" className={page === totalPages ? 'pointer-events-none opacity-50' : ''}><a href={buildUrl(Math.min(totalPages, page + 1))}>Вперёд</a></Button>
            </nav>
          )}
        </section>
      </div>
    </main>
  )
}

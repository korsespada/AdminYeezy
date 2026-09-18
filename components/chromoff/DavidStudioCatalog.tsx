'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, ImageOff, Loader2, RotateCcw, Search, Upload, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DAVID_STUDIO_DEFAULT_PAGE_SIZE,
  DAVID_STUDIO_PAGE_SIZES,
  categoryLabel,
  formatPriceRange,
  formatUsd,
  hasActiveFilters,
} from '@/lib/david-studio-catalog'
import type {
  DavidStudioFacets,
  DavidStudioFilters,
  DavidStudioProduct,
  DavidStudioSummary,
} from '@/lib/david-studio-catalog'
import type { DavidProductStatus } from '@/lib/david-studio-status'
import { startDavidPhotoCleaningBatchAction } from '@/actions/david-studio'

const BASE_PATH = '/admin/chromoff/david-studio'

export interface DavidStudioCatalogProps {
  products: DavidStudioProduct[]
  facets: DavidStudioFacets
  filters: DavidStudioFilters
  summary: DavidStudioSummary
  source: string
  parsedAtLabel: string
  page: number
  perPage: number
  total: number
  totalPages: number
  /** Ключ источника (url без query) → очищенное от вотермарки фото в S3. */
  cleanUrls?: Record<string, string>
  /** Метки и прогресс по товарам страницы: метки берём из черновиков и очереди чистки. */
  statuses?: Record<string, DavidProductStatus>
}

export default function DavidStudioCatalog({
  products,
  facets,
  filters,
  summary,
  source,
  parsedAtLabel,
  page,
  perPage,
  total,
  totalPages,
  cleanUrls = {},
  statuses = {},
}: DavidStudioCatalogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState(filters.q)
  const [active, setActive] = useState<DavidStudioProduct | null>(null)
  const [activeImage, setActiveImage] = useState(0)
  const [showOriginal, setShowOriginal] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const statusOf = (handle: string): DavidProductStatus | undefined => statuses[handle]
  const cleaningAnywhere = Object.values(statuses).some((status) => status.cleaning)
  const selectedSet = new Set(selected)

  // Пока воркер чистит выбранные фото, показываем прогресс без ручного обновления.
  useEffect(() => {
    if (!cleaningAnywhere) return
    const timer = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(timer)
  }, [cleaningAnywhere, router])

  const toggleSelected = (handle: string, checked: boolean) => {
    setSelected((current) => (checked
      ? [...new Set([...current, handle])]
      : current.filter((item) => item !== handle)))
  }

  const startBatchCleaning = () => {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await startDavidPhotoCleaningBatchAction(selected)
        if (!result.success) {
          setMessage({ kind: 'error', text: result.error })
          return
        }
        setMessage({
          kind: 'ok',
          text: `В очередь: товаров ${result.data.products}, новых заданий ${result.data.created}, уже было ${result.data.existing}. Чистит локальный воркер.`,
        })
        setSelected([])
        router.refresh()
      } catch (error) {
        setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Сервер вернул ошибку без описания' })
      }
    })
  }

  /** По умолчанию показываем очищенное фото, переключателем можно вернуть оригинал поставщика. */
  const displaySrc = (src: string) => (showOriginal ? src : cleanUrls[src.split('?')[0]] || src)
  const cleanedCount = Object.keys(cleanUrls).length

  // Строка поиска живёт локально, поэтому синхронизируем её с URL
  // после перехода (например, при сбросе фильтров).
  useEffect(() => {
    setSearch(filters.q)
  }, [filters.q])

  const navigate = (overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams()
    const values: Record<string, string | number | undefined> = {
      q: filters.q || undefined,
      category: filters.category || undefined,
      subcategory: filters.subcategory || undefined,
      productType: filters.productType || undefined,
      availability: filters.availability !== 'all' ? filters.availability : undefined,
      sort: filters.sort !== 'default' ? filters.sort : undefined,
      perPage: perPage !== DAVID_STUDIO_DEFAULT_PAGE_SIZE ? perPage : undefined,
      ...overrides,
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || value === '') continue
      params.set(key, String(value))
    }
    const query = params.toString()
    startTransition(() => {
      router.push(query ? `${BASE_PATH}?${query}` : BASE_PATH)
    })
  }

  const changeFilter = (key: 'category' | 'subcategory' | 'productType' | 'availability' | 'sort', value: string) => {
    // Смена раздела сбрасывает подраздел: он относится к прежнему разделу.
    if (key === 'category') navigate({ category: value || undefined, subcategory: undefined })
    else navigate({ [key]: value === 'all' ? undefined : value || undefined })
  }

  const openProduct = (product: DavidStudioProduct) => {
    setActive(product)
    setActiveImage(0)
  }

  const activePrice = (product: DavidStudioProduct) => formatPriceRange(product)

  return (
    <div className="min-h-screen bg-slate-900 font-sans text-slate-200 lg:flex">
      <aside className="w-full shrink-0 border-b border-slate-700 bg-slate-800 p-4 lg:sticky lg:top-0 lg:h-[100dvh] lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <Search className="h-5 w-5 text-violet-300" />
            Фильтры
          </h2>
          <div className="mt-1 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">{total.toLocaleString('ru-RU')}</span> товаров в выдаче
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            navigate({ q: search.trim() || undefined })
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="ds-search" className="text-slate-300">Название, тег, описание</Label>
            <Input
              id="ds-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Например, cross buckle"
              className="h-9 bg-slate-700 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <Button type="submit" className="h-9 w-full" disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Найти
          </Button>

          <FilterSelect
            label="Раздел"
            value={filters.category}
            onChange={(value) => changeFilter('category', value)}
            options={facets.categories.map((option) => ({ value: option.value, label: `${option.label} · ${option.count}` }))}
          />
          <FilterSelect
            label="Подраздел"
            value={filters.subcategory}
            onChange={(value) => changeFilter('subcategory', value)}
            options={facets.subcategories.map((option) => ({ value: option.value, label: `${option.label} · ${option.count}` }))}
            disabled={facets.subcategories.length === 0}
          />
          <FilterSelect
            label="Тип товара"
            value={filters.productType}
            onChange={(value) => changeFilter('productType', value)}
            options={facets.productTypes.map((option) => ({ value: option.value, label: `${option.label} · ${option.count}` }))}
          />
          <FilterSelect
            label="Наличие"
            value={filters.availability === 'all' ? '' : filters.availability}
            onChange={(value) => changeFilter('availability', value)}
            options={[{ value: 'available', label: 'В наличии' }, { value: 'out', label: 'Нет в наличии' }]}
          />
          <FilterSelect
            label="Сортировка"
            value={filters.sort === 'default' ? '' : filters.sort}
            onChange={(value) => changeFilter('sort', value)}
            options={[
              { value: 'title', label: 'По названию' },
              { value: 'price-asc', label: 'Цена: сначала дешёвые' },
              { value: 'price-desc', label: 'Цена: сначала дорогие' },
            ]}
          />
        </form>

        <div className="mt-4 space-y-2 border-t border-slate-700 pt-4 text-xs text-slate-400">
          <div className="flex items-center justify-between gap-2">
            <span>Всего в выгрузке</span>
            <span className="font-semibold text-slate-200">{summary.products.toLocaleString('ru-RU')}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Вариантов</span>
            <span className="font-semibold text-slate-200">{summary.variants.toLocaleString('ru-RU')}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Изображений</span>
            <span className="font-semibold text-slate-200">{summary.images.toLocaleString('ru-RU')}</span>
          </div>
          {parsedAtLabel && (
            <div className="flex items-center justify-between gap-2">
              <span>Обновлено</span>
              <span className="font-semibold text-slate-200">{parsedAtLabel}</span>
            </div>
          )}
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
          >
            {source.replace(/^https?:\/\//, '')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:p-6">
        <div className="mx-auto max-w-[1600px]">
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-100">David Studio</h1>
                <Badge className="bg-violet-500/15 text-violet-200 hover:bg-violet-500/15">поставщик</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Выгрузка каталога david-studio.com: просмотр без импорта в каталог Chromoff
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasActiveFilters(filters) && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 border-slate-700 bg-slate-800 text-slate-200"
                  onClick={() => navigate({
                    q: undefined,
                    category: undefined,
                    subcategory: undefined,
                    productType: undefined,
                    availability: undefined,
                    sort: undefined,
                  })}
                >
                  <RotateCcw className="h-4 w-4" />
                  Сбросить фильтры
                </Button>
              )}
              {cleanedCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowOriginal((value) => !value)}
                  className="border-slate-600 bg-slate-700 text-slate-200"
                  title="Переключить между очищенными фото и оригиналами поставщика"
                >
                  {showOriginal ? 'Показывать очищенные' : `Показывать оригиналы (${cleanedCount})`}
                </Button>
              )}
              <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs text-slate-400">
                <span className="whitespace-nowrap">На странице</span>
                <select
                  value={perPage}
                  onChange={(event) => navigate({ perPage: Number(event.target.value) })}
                  className="bg-transparent text-slate-200 outline-none"
                >
                  {DAVID_STUDIO_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <div className="text-sm text-slate-400">
                {total.toLocaleString('ru-RU')} товаров · страница {page} из {totalPages}
              </div>
            </div>
          </header>

          {products.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={products.every((product) => selectedSet.has(product.handle))}
                  onChange={(event) => setSelected(event.target.checked ? products.map((product) => product.handle) : [])}
                />
                Выбрать все на странице
              </label>
              <Button
                type="button"
                onClick={startBatchCleaning}
                disabled={isPending || selected.length === 0}
                className="bg-violet-600 text-white hover:bg-violet-500"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Очистить фото выбранных ({selected.length})
              </Button>
              {cleaningAnywhere && (
                <span className="text-xs text-amber-300">чистка идёт в фоне, прогресс обновляется сам</span>
              )}
              {message && (
                <span className={`text-xs ${message.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</span>
              )}
            </div>
          )}

          {products.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => {
                const status = statusOf(product.handle)
                return (
                <div
                  key={product.product_id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-800/70 transition-colors hover:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-400"
                >
                  <label
                    className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-slate-900/85"
                    title="Выбрать товар для массовой чистки фото"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(product.handle)}
                      onChange={(event) => toggleSelected(product.handle, event.target.checked)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => openProduct(product)}
                    className="flex flex-1 flex-col text-left focus-visible:outline-none"
                  >
                  <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
                    {product.images[0] ? (
                      <Image
                        src={displaySrc(product.images[0].src)}
                        alt={product.title}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageOff className="h-8 w-8 text-slate-600" />
                      </div>
                    )}
                    <div className="absolute left-10 top-2 flex flex-wrap gap-1">
                      <Badge className={product.available ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20' : 'bg-slate-700 text-slate-300 hover:bg-slate-700'}>
                        {product.available ? 'В наличии' : 'Нет'}
                      </Badge>
                    </div>
                    <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                      <Badge variant="outline" className="border-slate-600 bg-slate-900/80 text-slate-300">
                        {product.images.length} фото
                      </Badge>
                      {status?.publishedInChromoff && (
                        <Badge className="bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          опубликован в Chromoff
                        </Badge>
                      )}
                      {status?.photosCleaned && (
                        <Badge className="bg-violet-500/20 text-violet-200 hover:bg-violet-500/20">
                          фото очищены
                        </Badge>
                      )}
                      {!status?.photosCleaned && status && status.photosExpected > 0 && (
                        <Badge variant="outline" className="border-amber-500/40 bg-slate-900/80 text-amber-200">
                          очищено {status.photosDone}/{status.photosExpected}
                          {status.photosFailed ? `, сбоев ${status.photosFailed}` : ''}
                        </Badge>
                      )}
                      {status?.draftStatus === 'ai_error' && (
                        <Badge className="bg-rose-500/20 text-rose-200 hover:bg-rose-500/20">ИИ: ошибка</Badge>
                      )}
                      {status?.draftStatus === 'ai_ready' && !status?.publishedInChromoff && (
                        <Badge variant="outline" className="border-violet-500/40 bg-slate-900/80 text-violet-200">черновик готов</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <h2 className="line-clamp-2 text-sm font-semibold text-slate-100">{product.title}</h2>
                    <div className="mt-auto space-y-2">
                      <div className="text-base font-bold text-violet-200">{activePrice(product)}</div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="border-violet-500/30 text-violet-300">
                          {categoryLabel(product.category || product.product_type || '—')}
                        </Badge>
                        {product.product_type && (
                          <Badge variant="outline" className="border-slate-600 text-slate-400">
                            {product.product_type}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {product.variants.length > 1
                          ? `${product.variants.length} вариантов`
                          : 'без вариантов'}
                      </div>
                    </div>
                  </div>
                  </button>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center">
              <Search className="mx-auto h-8 w-8 text-slate-600" />
              <h2 className="mt-3 text-lg font-medium text-slate-200">Ничего не найдено</h2>
              <p className="mt-1 text-sm text-slate-500">Измените фильтры в боковой панели.</p>
            </div>
          )}

          {totalPages > 1 && (
            <nav className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Страницы каталога David Studio">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                onClick={() => navigate({ page: Math.max(1, page - 1) })}
              >
                Назад
              </Button>
              {buildPageNumbers(page, totalPages).map((itemPage) => (
                <Button
                  key={itemPage}
                  type="button"
                  size="sm"
                  variant={itemPage === page ? 'default' : 'outline'}
                  onClick={() => navigate({ page: itemPage })}
                >
                  {itemPage}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                onClick={() => navigate({ page: Math.min(totalPages, page + 1) })}
              >
                Вперёд
              </Button>
            </nav>
          )}
        </div>
      </main>

      <Dialog open={Boolean(active)} onOpenChange={(open) => { if (!open) setActive(null) }}>
        <DialogContent className="max-h-[92dvh] max-w-5xl overflow-hidden border-slate-700 bg-slate-800 p-0 text-slate-100">
          {active && (
            <div className="flex max-h-[92dvh] flex-col">
              <DialogHeader className="border-b border-slate-700 p-4">
                <DialogTitle className="pr-8 text-lg text-slate-100">{active.title}</DialogTitle>
                <DialogDescription className="text-slate-400">
                  {categoryLabel(active.category || '—')}
                  {active.subcategory ? ` · ${categoryLabel(active.subcategory)}` : ''}
                  {active.product_type ? ` · ${active.product_type}` : ''}
                </DialogDescription>
              </DialogHeader>

              <ScrollArea className="flex-1">
                <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
                  <div className="space-y-3">
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
                      {active.images[activeImage] ? (
                        <Image
                          src={displaySrc(active.images[activeImage].src)}
                          alt={`${active.title} — фото ${activeImage + 1}`}
                          fill
                          sizes="(max-width: 1024px) 100vw, 50vw"
                          className="object-contain"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <ImageOff className="h-10 w-10 text-slate-600" />
                        </div>
                      )}
                    </div>
                    {active.images.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {active.images.map((image, index) => (
                          <button
                            key={image.src}
                            type="button"
                            onClick={() => setActiveImage(index)}
                            className={`relative h-16 w-16 overflow-hidden rounded-md border ${index === activeImage ? 'border-violet-400' : 'border-slate-700'} bg-slate-900`}
                            aria-label={`Фото ${index + 1}`}
                          >
                            <Image src={displaySrc(image.src)} alt="" fill sizes="64px" className="object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <div className="text-xl font-bold text-violet-200">{activePrice(active)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          {active.available
                            ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> в наличии</>
                            : <><XCircle className="h-3.5 w-3.5 text-slate-500" /> нет в наличии</>}
                        </span>
                        <span>·</span>
                        <span>{active.variants.length} вариантов</span>
                        <span>·</span>
                        <span>{active.currency}</span>
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-200">Варианты</h3>
                      <div className="overflow-hidden rounded-lg border border-slate-700">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-900/60 text-slate-400">
                            <tr>
                              <th className="px-3 py-2 font-medium">Размер / вариант</th>
                              <th className="px-3 py-2 font-medium">Цена</th>
                              <th className="px-3 py-2 font-medium">Наличие</th>
                            </tr>
                          </thead>
                          <tbody>
                            {active.variants.map((variant) => (
                              <tr key={variant.variant_id} className="border-t border-slate-700/60">
                                <td className="px-3 py-2 text-slate-200">{variant.size || variant.title}</td>
                                <td className="px-3 py-2 text-slate-200">
                                  {formatUsd(variant.price, active.currency)}
                                  {variant.compare_at_price !== null && variant.compare_at_price > (variant.price ?? 0) && (
                                    <span className="ml-2 text-[11px] text-slate-500 line-through">
                                      {formatUsd(variant.compare_at_price, active.currency)}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {variant.available
                                    ? <span className="text-emerald-400">есть</span>
                                    : <span className="text-slate-500">нет</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {active.description_text && (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-slate-200">Описание</h3>
                        <div className="whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
                          {active.description_text}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs">
                      {active.collections.map((handle) => (
                        <Badge key={handle} variant="outline" className="border-slate-600 text-slate-400">
                          {categoryLabel(handle)}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild className="bg-violet-600 text-white hover:bg-violet-500">
                        <Link href={`/admin/chromoff/david-studio/import/${active.handle}`}>
                          <Upload className="h-4 w-4" />
                          Импорт в Chromoff
                        </Link>
                      </Button>
                      <Button asChild variant="outline" className="border-slate-600 bg-slate-700 text-slate-200">
                        <a href={active.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" />
                          Открыть на david-studio.com
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function buildPageNumbers(page: number, totalPages: number): number[] {
  const from = Math.max(1, page - 2)
  const to = Math.min(totalPages, page + 2)
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-300">{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded-md border border-slate-600 bg-slate-700 px-2.5 text-xs text-slate-200 outline-none focus:border-violet-400 disabled:opacity-50"
      >
        <option value="">Все</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

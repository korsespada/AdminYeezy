'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, useTransition } from 'react'
import { Bot, Check, CheckCheck, ChevronLeft, ChevronRight, Loader2, Save, Search, ShieldCheck, X } from 'lucide-react'
import {
  aiRefineCatalogAttributeSuggestionsAction,
  approveCatalogAttributeSuggestionAction,
  bulkApproveCatalogAttributeSuggestionsAction,
  bulkApproveFilteredCatalogAttributeSuggestionsAction,
  bulkRejectCatalogAttributeSuggestionsAction,
  rejectCatalogAttributeSuggestionAction,
  updateCatalogAttributeSuggestionValueAction,
} from '@/actions/catalog-attributes'
import { getProductAction } from '@/actions/products'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ProductForm from '@/components/products/ProductForm'
import type {
  RailsCatalogAttributeSuggestion,
  RailsCatalogAttributeSuggestionList,
} from '@/lib/rails-admin'
import type { Brand, Category, Subcategory } from '@/lib/types'
import type { Product } from '@/lib/types'

const ATTRIBUTE_OPTIONS = [
  ['', 'Все атрибуты'],
  ['brand', 'Бренд'],
  ['subcategory', 'Подкатегория'],
  ['display_name', 'Название для показа'],
  ['model_name', 'Модель'],
  ['sizes', 'Размеры'],
  ['colors', 'Цвет'],
  ['materials', 'Материал'],
  ['dimensions', 'Габариты'],
  ['watch_reference', 'Референс часов'],
  ['watch_movement', 'Механизм часов'],
  ['watch_case_size', 'Размер часов'],
  ['watch_case_material', 'Материал корпуса часов'],
  ['water_resistance', 'Водозащита'],
  ['luggage_size', 'Размер чемодана'],
  ['jewelry_metal', 'Ювелирный металл'],
  ['stones', 'Камни'],
  ['weight', 'Вес'],
] as const

const ATTRIBUTE_LABELS = Object.fromEntries(
  ATTRIBUTE_OPTIONS.filter(([value]) => value)
) as Record<string, string>

const BAG_SUBCATEGORY_SLUGS = [
  'sumki-klatchi',
  'sumki-dlya-noutbukov',
  'sumki-tout',
  'sumki-na-plecho',
  'sumki-ryukzaki',
  'sumki-dorozhnye-sumki',
  'sumki-messendzhery',
  'sumki-breloki',
  'sumki-plyazhnye-sumki',
  'sumki-poyasnye-sumki',
] as const

const STATUS_LABELS: Record<string, string> = {
  suggested: 'На проверке',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
}

const SOURCE_LABELS: Record<string, string> = {
  name: 'Название',
  description: 'Описание',
  legacy_metadata: 'Старые размеры',
  derived: 'Рассчитано',
  vision: 'Фото',
  ai: 'AI',
  ai_text: 'AI по тексту',
  ai_vision: 'AI по тексту и фото',
  unknown: 'Нет предложения',
}

interface CatalogAttributeReviewProps {
  initialResult: RailsCatalogAttributeSuggestionList
  filters: {
    query: string
    status: string
    attributeCode: string
    source: string
    brand: string
    category: string
    subcategory: string
    suggestedValue?: string
    perPage: number
  }
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
}

export default function CatalogAttributeReview({
  initialResult,
  filters,
  brands,
  categories,
  subcategories,
}: CatalogAttributeReviewProps) {
  const [items, setItems] = useState(initialResult.items)
  const [totalItems, setTotalItems] = useState(initialResult.totalItems)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drawerProduct, setDrawerProduct] = useState<Product | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function review(id: string, decision: 'approve' | 'reject') {
    setBusyId(id)
    setMessage(null)
    startTransition(async () => {
      const result = decision === 'approve'
        ? await approveCatalogAttributeSuggestionAction(id)
        : await rejectCatalogAttributeSuggestionAction(id)

      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'Не удалось сохранить решение' })
        setBusyId(null)
        return
      }

      const updated = result.data as RailsCatalogAttributeSuggestion
      if (filters.status === 'suggested') {
        setItems((current) => current.filter((item) => item.id !== id))
        setTotalItems((current) => Math.max(0, current - 1))
      } else {
        setItems((current) => current.map((item) => item.id === id ? updated : item))
      }
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setMessage({
        kind: 'success',
        text: decision === 'approve' ? 'Значение подтверждено и записано в товар' : 'Предложение отклонено',
      })
      setBusyId(null)
    })
  }

  function updateValue(id: string, value: string) {
    setBusyId(id)
    setMessage(null)
    startTransition(async () => {
      const result = await updateCatalogAttributeSuggestionValueAction(id, value)

      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'Не удалось изменить значение' })
        setBusyId(null)
        return
      }

      const updated = result.data as RailsCatalogAttributeSuggestion
      setItems((current) => current.map((item) => item.id === id ? updated : item))
      setMessage({ kind: 'success', text: 'Предложенное значение изменено' })
      setBusyId(null)
    })
  }

  const highConfidence = items.filter((item) => item.confidence >= 0.9).length
  const reviewableIds = items
    .filter((item) => item.status === 'suggested' && item.source !== 'unknown')
    .map((item) => item.id)
  const allSelected = reviewableIds.length > 0 && reviewableIds.every((id) => selectedIds.has(id))
  const bagSubcategories = subcategories.filter((item) => BAG_SUBCATEGORY_SLUGS.includes(item.slug as typeof BAG_SUBCATEGORY_SLUGS[number]))

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allSelected) reviewableIds.forEach((id) => next.delete(id))
      else reviewableIds.forEach((id) => next.add(id))
      return next
    })
  }

  function bulkReview(decision: 'approve' | 'reject') {
    const ids = [...selectedIds].filter((id) => reviewableIds.includes(id))
    if (ids.length === 0) return

    setBusyId('bulk')
    setMessage(null)
    startTransition(async () => {
      const result = decision === 'approve'
        ? await bulkApproveCatalogAttributeSuggestionsAction(ids)
        : await bulkRejectCatalogAttributeSuggestionsAction(ids)

      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'Не удалось обработать выбранные значения' })
        setBusyId(null)
        return
      }

      if (filters.status === 'suggested') {
        setItems((current) => current.filter((item) => !ids.includes(item.id)))
        setTotalItems((current) => Math.max(0, current - ids.length))
      } else {
        const status = decision === 'approve' ? 'approved' : 'rejected'
        setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, status } : item))
      }
      setSelectedIds(new Set())
      setMessage({
        kind: 'success',
        text: decision === 'approve'
          ? `Подтверждено значений: ${ids.length}`
          : `Отклонено предложений: ${ids.length}`,
      })
      setBusyId(null)
    })
  }

  function approveAllFiltered() {
    if (totalItems === 0) return
    const confirmed = window.confirm(
      `Подтвердить все предложения по текущим фильтрам: ${totalItems.toLocaleString('ru-RU')}?\n\nДействие применится ко всем страницам.`
    )
    if (!confirmed) return

    setBusyId('filtered')
    setMessage(null)
    startTransition(async () => {
      const result = await bulkApproveFilteredCatalogAttributeSuggestionsAction({
        query: filters.query,
        attributeCode: filters.attributeCode,
        source: filters.source,
        brand: filters.brand,
        category: filters.category,
        subcategory: filters.subcategory,
        suggestedValue: filters.suggestedValue,
      })
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'Не удалось подтвердить предложения по фильтрам' })
        setBusyId(null)
        return
      }

      const approvedCount = Number(result.data?.approved_count || 0)
      setItems([])
      setTotalItems(0)
      setSelectedIds(new Set())
      setMessage({ kind: 'success', text: `Подтверждено по текущим фильтрам: ${approvedCount.toLocaleString('ru-RU')}` })
      setBusyId(null)
    })
  }

  function aiReview() {
    const ids = [...selectedIds].filter((id) => reviewableIds.includes(id))
    if (ids.length === 0) return
    if (ids.length > 10) {
      setMessage({ kind: 'error', text: 'Для одного AI-запуска выберите не более 10 предложений' })
      return
    }

    setBusyId('ai')
    setMessage(null)
    startTransition(async () => {
      const result = await aiRefineCatalogAttributeSuggestionsAction(ids)
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'AI-проверка не выполнена' })
        setBusyId(null)
        return
      }

      const aiItems = (result.data?.catalog_attribute_suggestions || []) as RailsCatalogAttributeSuggestion[]
      setItems(aiItems)
      setTotalItems(aiItems.length)
      setSelectedIds(new Set())
      setMessage({
        kind: 'success',
        text: `AI проверил товаров: ${result.data?.processed_products || 0}. Показаны новые AI-черновики.`,
      })
      setBusyId(null)
    })
  }

  async function openProduct(productId: string) {
    setBusyId(`product:${productId}`)
    setMessage(null)
    const result = await getProductAction(productId)
    setBusyId(null)

    if (!result.success) {
      setMessage({ kind: 'error', text: result.error || 'Не удалось загрузить товар' })
      return
    }

    setDrawerProduct(result.data as Product)
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Найдено" value={totalItems.toLocaleString('ru-RU')} hint="с учётом фильтров" />
        <Metric label="На странице" value={String(items.length)} hint={`${highConfidence} с уверенностью ≥ 90%`} />
        <Metric label="Режим" value="Ручная проверка" hint="названия и URL не меняются" accent />
      </section>

      <FilterPanel
        filters={filters}
        brands={brands}
        categories={categories}
        subcategories={subcategories}
        suggestionValues={initialResult.availableValues || []}
      />

      <BulkToolbar
        selectedCount={selectedIds.size}
        allSelected={allSelected}
        reviewableCount={reviewableIds.length}
        busy={isPending && busyId === 'bulk'}
        filteredBusy={isPending && busyId === 'filtered'}
        aiBusy={isPending && busyId === 'ai'}
        filteredCount={filters.status === 'suggested' && filters.suggestedValue !== '__unknown__' ? totalItems : 0}
        onToggleAll={togglePageSelection}
        onApprove={() => bulkReview('approve')}
        onReject={() => bulkReview('reject')}
        onApproveFiltered={approveAllFiltered}
        onAi={aiReview}
      />

      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${message.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </div>
      )}

      <section className="space-y-3">
        {items.map((item) => (
          <SuggestionCard
            key={item.id}
            item={item}
            busy={isPending && busyId === item.id}
            selected={selectedIds.has(item.id)}
            onToggle={() => toggleSelection(item.id)}
            onApprove={() => review(item.id, 'approve')}
            onReject={() => review(item.id, 'reject')}
            onUpdateValue={(value) => updateValue(item.id, value)}
            onOpenProduct={() => openProduct(item.product.id)}
            productLoading={busyId === `product:${item.product.id}`}
            subcategoryOptions={bagSubcategories}
          />
        ))}
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/60 px-6 py-16 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400" />
            <h2 className="mt-4 text-lg font-semibold text-white">Предложений не найдено</h2>
            <p className="mt-2 text-sm text-slate-500">Измените фильтры или перейдите на предыдущую страницу.</p>
          </div>
        )}
      </section>

      <Pagination result={{ ...initialResult, totalItems }} filters={filters} />

      {drawerProduct && (
        <ProductForm
          product={drawerProduct}
          brands={brands}
          categories={categories}
          subcategories={subcategories}
          isOpen={drawerOpen}
          onClose={() => {
            setDrawerOpen(false)
            setDrawerProduct(null)
          }}
          onSave={(updatedProduct) => setDrawerProduct(updatedProduct)}
        />
      )}
    </div>
  )
}

function Metric({ label, value, hint, accent = false }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-800 bg-slate-900'}`}>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${accent ? 'text-emerald-300' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  )
}

function FilterPanel({
  filters,
  brands,
  categories,
  subcategories,
  suggestionValues,
}: {
  filters: CatalogAttributeReviewProps['filters']
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
  suggestionValues: Array<{ value: string; label: string; count: number }>
}) {
  const [category, setCategory] = useState(filters.category)
  const visibleSubcategories = category
    ? subcategories.filter((item) => item.category === category)
    : subcategories

  return (
    <form action="/admin/catalog-attributes" method="get" className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="relative">
        <span className="sr-only">Поиск товара</span>
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <input
          name="query"
          defaultValue={filters.query}
          placeholder="Название или slug товара"
          className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
        />
      </label>
      <FilterSelect name="attribute" defaultValue={filters.attributeCode} options={ATTRIBUTE_OPTIONS} />
      <FilterSelect
        name="status"
        defaultValue={filters.status}
        options={[["all", "Все статусы"], ["suggested", "На проверке"], ["approved", "Подтверждено"], ["rejected", "Отклонено"]]}
      />
      <FilterSelect
        name="source"
        defaultValue={filters.source}
        options={[["", "Все источники"], ["name", "Название"], ["description", "Описание"], ["legacy_metadata", "Старые размеры"], ["derived", "Рассчитано"], ["ai_text", "AI по тексту"], ["ai_vision", "AI по тексту и фото"]]}
      />
      <FilterSelect
        name="brand"
        defaultValue={filters.brand}
        options={[["", "Все бренды"], ...brands.map((brand) => [brand.id, brand.name] as const)]}
      />
      <select
        name="category"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none transition focus:border-indigo-500"
      >
        <option value="">Все категории</option>
        {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <FilterSelect
        key={category || 'all-categories'}
        name="subcategory"
        defaultValue={visibleSubcategories.some((item) => item.id === filters.subcategory) ? filters.subcategory : ''}
        options={[["", "Все подкатегории"], ...visibleSubcategories.map((item) => [item.id, item.name] as const)]}
      />
      <FilterSelect
        name="suggested_value"
        defaultValue={filters.suggestedValue || ''}
        options={[
          ['', filters.attributeCode ? 'Все предложенные значения' : 'Сначала выберите атрибут'],
          ...suggestionValues.map((item) => [item.value, `${item.label} (${item.count})`] as const),
        ]}
      />
      <FilterSelect
        name="per_page"
        defaultValue={String(filters.perPage)}
        options={[["20", "20 на странице"], ["30", "30 на странице"], ["50", "50 на странице"], ["100", "100 на странице"]]}
      />
      <Button type="submit" className="bg-indigo-600 hover:bg-indigo-500 xl:col-start-4">Применить</Button>
    </form>
  )
}

function BulkToolbar({
  selectedCount,
  allSelected,
  reviewableCount,
  busy,
  filteredBusy,
  aiBusy,
  filteredCount,
  onToggleAll,
  onApprove,
  onReject,
  onApproveFiltered,
  onAi,
}: {
  selectedCount: number
  allSelected: boolean
  reviewableCount: number
  busy: boolean
  filteredBusy: boolean
  aiBusy: boolean
  filteredCount: number
  onToggleAll: () => void
  onApprove: () => void
  onReject: () => void
  onApproveFiltered: () => void
  onAi: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          disabled={reviewableCount === 0 || busy}
          className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500"
        />
        Выбрать все на странице
        <Badge variant="outline" className="border-slate-700 text-slate-400">{selectedCount}</Badge>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onAi} disabled={selectedCount === 0 || selectedCount > 10 || busy || aiBusy} size="sm" variant="outline" className="border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20">
          {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Проверить AI
        </Button>
        <Button type="button" onClick={onApprove} disabled={selectedCount === 0 || busy} size="sm" className="bg-emerald-600 hover:bg-emerald-500">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
          Принять выбранные
        </Button>
        <Button type="button" onClick={onApproveFiltered} disabled={filteredCount === 0 || busy || filteredBusy} size="sm" className="bg-sky-600 hover:bg-sky-500">
          {filteredBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Принять всё по фильтрам ({filteredCount.toLocaleString('ru-RU')})
        </Button>
        <Button type="button" onClick={onReject} disabled={selectedCount === 0 || busy} size="sm" variant="outline" className="border-slate-700 bg-slate-950 text-slate-300 hover:bg-red-500/10 hover:text-red-300">
          <X className="h-4 w-4" /> Отклонить
        </Button>
      </div>
    </div>
  )
}

function FilterSelect({ name, defaultValue, options }: { name: string; defaultValue: string; options: ReadonlyArray<readonly [string, string]> }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={name === 'suggested_value' ? 'Предложенное значение' : undefined}
      className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none transition focus:border-indigo-500"
    >
      {options.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
    </select>
  )
}

function SuggestionCard({
  item,
  busy,
  selected,
  onToggle,
  onApprove,
  onReject,
  onUpdateValue,
  onOpenProduct,
  productLoading,
  subcategoryOptions,
}: {
  item: RailsCatalogAttributeSuggestion
  busy: boolean
  selected: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
  onUpdateValue: (value: string) => void
  onOpenProduct: () => void
  productLoading: boolean
  subcategoryOptions: Subcategory[]
}) {
  const isUnknown = item.source === 'unknown'
  const isReviewable = item.status === 'suggested' && !isUnknown
  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm transition hover:border-slate-700">
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(240px,0.85fr)_minmax(0,1.3fr)_auto] lg:items-center">
        <div className="flex min-w-0 gap-3">
          {isReviewable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              aria-label={`Выбрать ${item.product.name}: ${ATTRIBUTE_LABELS[item.attribute_code] || item.attribute_code}`}
              className="mt-2 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950 accent-indigo-500"
            />
          )}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!productLoading) onOpenProduct()
            }}
            onKeyDown={(event) => {
              if (!productLoading && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                onOpenProduct()
              }
            }}
            aria-busy={productLoading}
            className="flex min-w-0 flex-1 gap-3 rounded-lg text-left outline-none transition hover:bg-slate-800/60 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
            aria-label={`Открыть товар ${item.product.name}`}
          >
          <ProductImage item={item} />
          <div className="min-w-0 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                {ATTRIBUTE_LABELS[item.attribute_code] || item.attribute_code}
              </Badge>
              <Badge
                variant="outline"
                className={item.public_filter
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'}
              >
                {item.attribute_code === 'subcategory'
                  ? 'Категория каталога'
                  : item.public_filter ? 'Фильтр каталога' : 'Характеристика'}
              </Badge>
              <Confidence value={item.confidence} />
            </div>
            <h2 className="mt-3 truncate font-semibold text-white" title={item.product.name}>{item.product.name}</h2>
            <p className="mt-1 truncate text-xs text-slate-500">
              {item.product.brand?.name || 'Без бренда'} · {item.product.category?.name || 'Без категории'}
            </p>
            <p className="mt-1 truncate font-mono text-[11px] text-slate-600">{item.product.slug}</p>
          </div>
          {productLoading && <Loader2 className="mt-2 h-4 w-4 shrink-0 animate-spin text-indigo-300" />}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ValueBox label="Сейчас / исходное" value={formatCurrentValue(item)} muted />
          {item.attribute_code === 'subcategory' && (isReviewable || isUnknown) ? (
            <SubcategoryValueSelect
              item={item}
              options={subcategoryOptions}
              busy={busy}
              onSave={onUpdateValue}
            />
          ) : isReviewable && editableSuggestionValue(item) ? (
            <EditableValueBox item={item} busy={busy} onSave={onUpdateValue} />
          ) : (
            <ValueBox label="Предлагается" value={formatNormalizedValue(item)} />
          )}
          <div className="sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Источник: <span className="text-slate-300">{SOURCE_LABELS[item.source] || item.source}</span></span>
            {item.raw_value && <span className="truncate">Фрагмент: <span className="text-slate-400">{item.raw_value}</span></span>}
          </div>
        </div>

        <div className="flex gap-2 lg:w-32 lg:flex-col">
          {isReviewable ? (
            <>
              <Button type="button" onClick={onApprove} disabled={busy} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Принять
              </Button>
              <Button type="button" onClick={onReject} disabled={busy} variant="outline" className="flex-1 border-slate-700 bg-slate-950 text-slate-300 hover:bg-red-500/10 hover:text-red-300">
                <X className="h-4 w-4" />
                Отклонить
              </Button>
            </>
          ) : (
            <Badge
              variant="outline"
              className={isUnknown
                ? 'justify-center border-amber-500/30 text-amber-300'
                : item.status === 'approved'
                  ? 'justify-center border-emerald-500/30 text-emerald-300'
                  : 'justify-center border-red-500/30 text-red-300'}
            >
              {isUnknown ? 'Неизвестно' : STATUS_LABELS[item.status] || item.status}
            </Badge>
          )}
        </div>
      </div>
    </article>
  )
}

function SubcategoryValueSelect({
  item,
  options,
  busy,
  onSave,
}: {
  item: RailsCatalogAttributeSuggestion
  options: Subcategory[]
  busy: boolean
  onSave: (value: string) => void
}) {
  const currentValue = String(item.normalized_value.category_id || '')

  return (
    <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Предлагается</div>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={currentValue}
          onChange={(event) => onSave(event.target.value)}
          disabled={busy}
          aria-label="Выбрать подкатегорию"
          className="h-9 min-w-0 flex-1 rounded-md border border-emerald-500/30 bg-slate-950 px-2 text-sm font-medium text-slate-100 outline-none focus:border-emerald-400 disabled:opacity-60"
        >
          <option value="" disabled>Выберите подкатегорию</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-300" />}
      </div>
    </div>
  )
}

function ProductImage({ item }: { item: RailsCatalogAttributeSuggestion }) {
  if (!item.product.image_url) {
    return <div className="h-24 w-20 shrink-0 rounded-lg border border-slate-800 bg-slate-950" />
  }
  return (
    <Image
      src={item.product.image_url}
      alt=""
      width={80}
      height={96}
      unoptimized
      className="h-24 w-20 shrink-0 rounded-lg border border-slate-800 bg-white object-cover"
    />
  )
}

function Confidence({ value }: { value: number }) {
  const percent = Math.round(value * 100)
  const color = percent >= 95 ? 'text-emerald-300 border-emerald-500/30' : percent >= 90 ? 'text-sky-300 border-sky-500/30' : 'text-amber-300 border-amber-500/30'
  return <Badge variant="outline" className={color}>{percent}%</Badge>
}

function ValueBox({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${muted ? 'border-slate-800 bg-slate-950/50' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-2 break-words text-sm ${muted ? 'text-slate-400' : 'font-medium text-slate-100'}`}>{value || '—'}</div>
    </div>
  )
}

function EditableValueBox({
  item,
  busy,
  onSave,
}: {
  item: RailsCatalogAttributeSuggestion
  busy: boolean
  onSave: (value: string) => void
}) {
  const value = String(item.normalized_value.value ?? '')
  const [draft, setDraft] = useState(value)
  const changed = draft.trim() !== value

  useEffect(() => setDraft(value), [value])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (changed && draft.trim()) onSave(draft.trim())
  }

  return (
    <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Предлагается</div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft(value)
          }}
          disabled={busy}
          aria-label={`Изменить значение: ${ATTRIBUTE_LABELS[item.attribute_code] || item.attribute_code}`}
          className="h-9 min-w-0 flex-1 rounded-md border border-emerald-500/30 bg-slate-950 px-2 text-sm font-medium text-slate-100 outline-none focus:border-emerald-400 disabled:opacity-60"
        />
        <Button type="submit" size="icon" disabled={busy || !changed || !draft.trim()} title="Сохранить значение">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span className="sr-only">Сохранить</span>
        </Button>
      </form>
      <div className="mt-1 text-[11px] text-slate-500">Enter — сохранить, Esc — отменить</div>
    </div>
  )
}

function editableSuggestionValue(item: RailsCatalogAttributeSuggestion) {
  return typeof item.normalized_value.value === 'string' || typeof item.normalized_value.value === 'number'
}

function formatCurrentValue(item: RailsCatalogAttributeSuggestion) {
  if (item.current_value && Object.keys(item.current_value).length > 0) return formatObject(item.current_value)
  if (item.attribute_code === 'brand') return item.product.brand?.name || 'Не указан'
  if (item.attribute_code === 'subcategory') return item.product.category?.name || 'Не указана'
  if (item.attribute_code === 'display_name') return item.product.name
  if (item.attribute_code === 'model_name') return 'Не заполнено'
  return item.raw_value || 'Не заполнено'
}

function formatNormalizedValue(item: RailsCatalogAttributeSuggestion) {
  return formatObject(item.normalized_value)
}

function formatObject(value: Record<string, any>) {
  if (value.brand_name) return String(value.brand_name)
  if (value.category_name) return String(value.category_name)
  if (value.width !== undefined && value.height !== undefined) {
    return [value.width, value.height, value.depth]
      .filter((part) => part !== undefined)
      .map(formatNumber)
      .join(' × ') + ` ${translateUnit(value.unit)}`
  }
  if (value.display_value) {
    const filter = value.filter_display
    return filter && filter !== value.display_value
      ? `${value.display_value} → ${filter}`
      : String(value.display_value)
  }
  if (value.value !== undefined) return `${value.value}${value.unit ? ` ${translateUnit(value.unit)}` : ''}`
  if (Array.isArray(value.values) && value.values.length > 0) return value.values.join(', ')
  if (Array.isArray(value.names) && value.names.length > 0) {
    const familyLabels: Record<string, string> = {
      leather: 'Кожа',
      crocodile: 'Крокодил',
      ostrich: 'Страус',
      snake: 'Змея',
      lizard: 'Ящерица',
      textile: 'Текстиль',
      raffia: 'Рафия',
      nylon: 'Нейлон',
      suede: 'Замша',
    }
    const exactNames = new Set<string>(value.names.map((name: string) => {
      if (name === 'Крокодил') return 'crocodile'
      if (name === 'Страус') return 'ostrich'
      if (name === 'Змея') return 'snake'
      if (name === 'Ящерица') return 'lizard'
      if (name === 'Канвас') return 'textile'
      if (name === 'Рафия') return 'raffia'
      if (name === 'Нейлон') return 'nylon'
      if (name === 'Замша') return 'suede'
      return 'leather'
    }))
    const families = Array.isArray(value.families)
      ? value.families
        .filter((family: string) => !exactNames.has(family))
        .map((family: string) => familyLabels[family] || family)
      : []
    return [...value.names, ...families].join(', ')
  }
  if (Array.isArray(value.groups) && value.groups.length > 0) {
    return value.groups.map((group: Record<string, any>) => {
      const sizes = Array.isArray(group.values) && group.values.length > 0
        ? group.values.join(', ')
        : group.min !== undefined && group.max !== undefined
          ? `${group.min}–${group.max}`
          : ''
      return [sizes, translateAudience(group.audience)].filter(Boolean).join(' · ')
    }).filter(Boolean).join('; ')
  }
  if (Array.isArray(value.raw_values) && value.raw_values.length > 0) return value.raw_values.join(', ')
  if (Array.isArray(value.families) && value.families.length > 0) return value.families.map(translateFamily).join(', ')
  if (value.family) {
    return [
      value.color && translateMetalColor(value.color),
      translateFamily(value.family),
      value.purity && `${value.purity} проба`,
      value.karat && `${value.karat}K`,
    ].filter(Boolean).join(' · ')
  }
  if (value.name) return String(value.name)
  return JSON.stringify(value, null, 2)
}

function translateAudience(value?: string) {
  return { male: 'мужские', female: 'женские', unisex: 'унисекс' }[value || ''] || ''
}

function translateUnit(value?: string) {
  return { mm: 'мм', cm: 'см', g: 'г' }[value || ''] || value || ''
}

function formatNumber(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function translateMetalColor(value?: string) {
  return { white: 'белое', yellow: 'жёлтое', rose: 'розовое' }[value || ''] || value || ''
}

function translateFamily(value: string) {
  const labels: Record<string, string> = {
    black: 'чёрный', white: 'белый', gray: 'серый', brown: 'коричневый', beige: 'бежевый',
    red: 'красный', pink: 'розовый', orange: 'оранжевый', yellow: 'жёлтый', green: 'зелёный',
    blue: 'синий', purple: 'фиолетовый', burgundy: 'бордовый', gold: 'золото', silver: 'серебро',
    platinum: 'платина', steel: 'сталь', leather: 'кожа', textile: 'текстиль', ceramic: 'керамика',
    crocodile: 'крокодил', suede: 'замша', shearling: 'овчина', fur: 'мех',
    patent_leather: 'лакированная кожа', nappa: 'кожа наппа', mesh: 'сетка', knit: 'трикотаж',
    cotton: 'хлопок',
    wool: 'шерсть', cashmere: 'кашемир', silk: 'шёлк', linen: 'лён', denim: 'деним',
    canvas: 'канвас', straw: 'солома', composite: 'композит',
    polyamide: 'полиамид / нейлон', polyester: 'полиэстер', viscose: 'вискоза', elastane: 'эластан',
    acetate: 'ацетат', cupro: 'купро', tencel: 'тенсель', mohair: 'мохер', modal: 'модал',
    acrylic: 'акрил', tweed: 'твид', satin: 'сатин', fleece: 'флис',
    velvet: 'вельвет / бархат', twill: 'твил', down: 'пух', technical: 'техническая ткань',
    rubber: 'резина', eva: 'EVA', tpu: 'TPU', pvc: 'ПВХ', cork: 'пробка',
    diamond: 'бриллиант', lab_diamond: 'выращенный бриллиант', pearl: 'жемчуг', sapphire: 'сапфир',
    emerald: 'изумруд', ruby: 'рубин',
  }
  return labels[value] || value
}

function Pagination({ result, filters }: { result: RailsCatalogAttributeSuggestionList; filters: CatalogAttributeReviewProps['filters'] }) {
  if (result.totalPages <= 1) return null
  const href = (page: number) => {
    const params = new URLSearchParams()
    if (page > 1) params.set('page', String(page))
    if (filters.query) params.set('query', filters.query)
    if (filters.status) params.set('status', filters.status)
    if (filters.attributeCode) params.set('attribute', filters.attributeCode)
    if (filters.source) params.set('source', filters.source)
    if (filters.brand) params.set('brand', filters.brand)
    if (filters.category) params.set('category', filters.category)
    if (filters.subcategory) params.set('subcategory', filters.subcategory)
    if (filters.suggestedValue) params.set('suggested_value', filters.suggestedValue)
    if (filters.perPage !== 30) params.set('per_page', String(filters.perPage))
    const query = params.toString()
    return query ? `/admin/catalog-attributes?${query}` : '/admin/catalog-attributes'
  }

  return (
    <nav className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
      <Button asChild variant="ghost" size="sm" className={result.page <= 1 ? 'pointer-events-none opacity-40' : 'text-slate-300'}>
        <Link href={href(Math.max(1, result.page - 1))}><ChevronLeft className="h-4 w-4" /> Назад</Link>
      </Button>
      <div className="text-sm text-slate-500">Страница <span className="text-white">{result.page}</span> из <span className="text-white">{result.totalPages}</span></div>
      <Button asChild variant="ghost" size="sm" className={result.page >= result.totalPages ? 'pointer-events-none opacity-40' : 'text-slate-300'}>
        <Link href={href(Math.min(result.totalPages, result.page + 1))}>Вперёд <ChevronRight className="h-4 w-4" /></Link>
      </Button>
    </nav>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewTranslationAction, translateEntityAction, translateProductAction, saveEntityTranslationAction } from '@/actions/products'
import { canReviewTranslation, englishTranslationState, TRANSLATION_STATE_LABELS } from '@/lib/translation-state'

type Item = {
  id: string
  name: string
  description?: string
  seo_title?: string
  seo_description?: string
  seo_text?: string
  seo_text_top?: string
  seo_text_bottom?: string
  parentId?: string
  translations?: Record<string, any>
}

function TranslateButton({ entityType, id }: { entityType: string; id: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const handleClick = () => {
    setMessage('')
    startTransition(async () => {
      let result
      if (entityType === 'Product') {
        result = await translateProductAction(id)
      } else {
        const data = new FormData()
        data.set('entityType', entityType)
        data.set('id', id)
        result = await translateEntityAction(data)
      }
      setMessage(result.success ? 'Готово' : result.error || 'Ошибка')
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-indigo-400/40 px-2.5 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50"
      >
        {pending ? 'Переводим…' : 'Перевести AI'}
      </button>
      {message && <span className="text-xs text-slate-400">{message}</span>}
    </div>
  )
}

const STATE_TONES: Record<string, string> = {
  missing: 'border-slate-600 text-slate-400',
  partial: 'border-amber-500/50 text-amber-300',
  machine: 'border-sky-500/50 text-sky-300',
  reviewed: 'border-emerald-500/50 text-emerald-300',
  stale: 'border-rose-500/50 text-rose-300',
}

function TranslationStatus({ entityType, item }: { entityType: string; item: Item }) {
  const [state, setState] = useState(englishTranslationState(item.translations))
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const handleReview = () => {
    setMessage('')
    startTransition(async () => {
      const result = await reviewTranslationAction(entityType, item.id)
      if (result.success) setState(englishTranslationState(result.data?.translations))
      else setMessage(result.error || 'Ошибка')
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE_TONES[state]}`}>
        {TRANSLATION_STATE_LABELS[state]}
      </span>
      {canReviewTranslation(state) && (
        <button
          type="button"
          onClick={handleReview}
          disabled={pending}
          className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
        >
          {pending ? 'Отмечаем…' : 'Проверено'}
        </button>
      )}
      {message && <span className="text-xs text-slate-400">{message}</span>}
    </div>
  )
}

function TranslationEditor({ entityType, item }: { entityType: 'Category' | 'Brand' | 'CatalogAttributeDefinition' | 'CatalogAttributeValue'; item: Item }) {
  const english = item.translations?.en || {}
  const isAttribute = entityType === 'CatalogAttributeDefinition' || entityType === 'CatalogAttributeValue'
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(english.name || '')
  const [attributeValue, setAttributeValue] = useState(
    String(english.label || english.canonical_value || ''),
  )
  const [description, setDescription] = useState(english.description || '')
  const [seoTitle, setSeoTitle] = useState(english.seo_title || '')
  const [seoDescription, setSeoDescription] = useState(english.seo_description || '')
  const [seoText, setSeoText] = useState(english.seo_text || '')
  const [seoTextTop, setSeoTextTop] = useState(english.seo_text_top || '')
  const [seoTextBottom, setSeoTextBottom] = useState(english.seo_text_bottom || '')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const handleSave = () => {
    const data = new FormData()
    data.set('entityType', entityType)
    data.set('id', item.id)
    // Пустая строка очищает поле; поля, которых нет в редакторе, Rails сохраняет как были.
    const translations = isAttribute
      ? { [entityType === 'CatalogAttributeDefinition' ? 'label' : 'canonical_value']: attributeValue.trim() }
      : entityType === 'Brand'
        ? { description: description.trim(), seo_title: seoTitle.trim(), seo_description: seoDescription.trim(), seo_text: seoText.trim() }
        : { name: name.trim(), description: description.trim(), seo_title: seoTitle.trim(), seo_description: seoDescription.trim(), seo_text_top: seoTextTop.trim(), seo_text_bottom: seoTextBottom.trim() }
    data.set('translations_en', JSON.stringify(translations))
    setMessage('')
    startTransition(async () => {
      const result = await saveEntityTranslationAction(data)
      setMessage(result.success ? 'Сохранено' : result.error || 'Ошибка')
      if (result.success) setOpen(false)
    })
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-xs font-semibold text-sky-300 hover:underline"
      >
        {open ? 'Скрыть EN' : 'Редактировать EN'}
      </button>
      {open && (
        <div className="mt-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
          {isAttribute ? (
            <input
              value={attributeValue}
              onChange={(event) => setAttributeValue(event.target.value)}
              placeholder={entityType === 'CatalogAttributeDefinition' ? 'Label (EN)' : 'Value (EN)'}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2"
            />
          ) : (
            <>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name (EN)" className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200" />
              <input value={seoTitle} onChange={(event) => setSeoTitle(event.target.value)} placeholder="SEO title (EN)" className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200" />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (EN)" rows={3} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2" />
              <textarea value={seoDescription} onChange={(event) => setSeoDescription(event.target.value)} placeholder="SEO description (EN)" rows={2} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2" />
              {entityType === 'Brand' && (
                <>
                  <textarea value={seoText} onChange={(event) => setSeoText(event.target.value)} placeholder="SEO text (EN)" rows={3} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2" />
                  <details className="rounded border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-400 sm:col-span-2">
                    <summary className="cursor-pointer text-slate-300">Русский оригинал</summary>
                    <div className="mt-2 space-y-2 whitespace-pre-wrap">
                      {item.description && <p><b>Description:</b> {item.description}</p>}
                      {item.seo_title && <p><b>SEO title:</b> {item.seo_title}</p>}
                      {item.seo_description && <p><b>SEO description:</b> {item.seo_description}</p>}
                      {item.seo_text && <p><b>SEO text:</b> {item.seo_text}</p>}
                    </div>
                  </details>
                </>
              )}
              {entityType === 'Category' && (
                <>
                  <textarea value={seoTextTop} onChange={(event) => setSeoTextTop(event.target.value)} placeholder="SEO text top (EN)" rows={3} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2" />
                  <textarea value={seoTextBottom} onChange={(event) => setSeoTextBottom(event.target.value)} placeholder="SEO text bottom (EN)" rows={3} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 sm:col-span-2" />
                  <details className="rounded border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-400 sm:col-span-2">
                    <summary className="cursor-pointer text-slate-300">Русский оригинал</summary>
                    <div className="mt-2 space-y-2 whitespace-pre-wrap">
                      <p><b>Name:</b> {item.name}</p>
                      {item.description && <p><b>Description:</b> {item.description}</p>}
                      {item.seo_title && <p><b>SEO title:</b> {item.seo_title}</p>}
                      {item.seo_description && <p><b>SEO description:</b> {item.seo_description}</p>}
                      {item.seo_text_top && <p><b>SEO text top:</b> {item.seo_text_top}</p>}
                      {item.seo_text_bottom && <p><b>SEO text bottom:</b> {item.seo_text_bottom}</p>}
                    </div>
                  </details>
                </>
              )}
            </>
          )}
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="button" onClick={handleSave} disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {pending ? 'Сохраняем…' : 'Сохранить EN'}
            </button>
            {message && <span className="text-xs text-slate-400">{message}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function CategorySection({ categories }: { categories: Item[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reviewedStates, setReviewedStates] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const decorated = categories.map((category) => ({
    ...category,
    state: reviewedStates[category.id] || englishTranslationState(category.translations),
  }))
  const reviewed = decorated.filter((category) => category.state === 'reviewed').length
  const counts = decorated.reduce<Record<string, number>>((result, category) => {
    result[category.state] = (result[category.state] || 0) + 1
    return result
  }, {})
  const filtered = filter === 'all' ? decorated : decorated.filter((category) => category.state === filter)
  const roots = filtered.filter((category) => !category.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const byParent = new Map<string, typeof filtered>()
  filtered.filter((category) => category.parentId).forEach((category) => {
    const list = byParent.get(category.parentId!) || []
    list.push(category)
    byParent.set(category.parentId!, list)
  })
  const ordered = [
    ...roots.flatMap((root) => [root, ...(byParent.get(root.id) || []).sort((a, b) => a.name.localeCompare(b.name, 'ru'))]),
    ...filtered.filter((category) => category.parentId && !roots.some((root) => root.id === category.parentId)),
  ]

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const reviewSelected = () => {
    if (!selected.size) return
    setMessage('')
    startTransition(async () => {
      let failed = 0
      const nextStates: Record<string, string> = {}
      for (const id of selected) {
        const result = await reviewTranslationAction('Category', id)
        if (!result.success) failed += 1
        else nextStates[id] = englishTranslationState(result.data?.translations)
      }
      setReviewedStates((current) => ({ ...current, ...nextStates }))
      setSelected(new Set())
      setMessage(failed ? `Не удалось: ${failed}` : 'Отмечено проверенными')
      router.refresh()
    })
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Категории</h2>
        <span className="text-xs text-slate-400">проверено {reviewed} из {categories.length}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {['all', 'missing', 'partial', 'machine', 'reviewed', 'stale'].map((state) => (
          <button
            key={state}
            type="button"
            onClick={() => {
              setFilter(state)
              setSelected(new Set())
            }}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${filter === state ? 'border-sky-400 text-sky-200' : 'border-slate-700 text-slate-400'}`}
          >
            {state === 'all' ? 'все' : TRANSLATION_STATE_LABELS[state]} {state === 'all' ? categories.length : (counts[state] || 0)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reviewSelected}
          disabled={pending || selected.size === 0}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {pending ? 'Отмечаем…' : `Отметить проверенными (${selected.size})`}
        </button>
        {message && <span className="text-xs text-slate-400">{message}</span>}
      </div>
      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
        {ordered.map((category) => (
          <li key={category.id} className={`px-4 py-3 ${category.parentId ? 'ml-5 border-l border-slate-800' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {['machine', 'partial', 'stale'].includes(category.state) && (
                  <input
                    type="checkbox"
                    checked={selected.has(category.id)}
                    onChange={() => toggle(category.id)}
                    aria-label={`Выбрать ${category.name}`}
                  />
                )}
                <span className="min-w-0 truncate text-sm text-slate-200">{category.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <TranslationStatus key={`${category.id}-${category.state}`} entityType="Category" item={category} />
                <TranslateButton entityType="Category" id={category.id} />
              </div>
            </div>
            <div className="mt-2">
              <TranslationEditor entityType="Category" item={category} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function TranslationsDashboard({
  products,
  categories,
  brands,
  attributeDefinitions,
  attributeValues,
}: {
  products: Item[]
  categories: Item[]
  brands: Item[]
  attributeDefinitions: Item[]
  attributeValues: Item[]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Товары: нет перевода, неполный, устарел</h2>
        {products.length === 0 ? <p className="text-sm text-slate-400">Очередь пуста.</p> : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate text-sm text-slate-200">{product.name}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <TranslationStatus entityType="Product" item={product} />
                  <TranslateButton entityType="Product" id={product.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CategorySection categories={categories} />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Бренды</h2>
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {brands.slice(0, 30).map((brand) => (
            <li key={brand.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-slate-200">{brand.name}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <TranslationStatus entityType="Brand" item={brand} />
                  <TranslateButton entityType="Brand" id={brand.id} />
                </div>
              </div>
              <div className="mt-2">
                <TranslationEditor entityType="Brand" item={brand} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Характеристики</h2>
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {attributeDefinitions.slice(0, 40).map((definition) => (
            <li key={definition.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-slate-200">{definition.name}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <TranslationStatus entityType="CatalogAttributeDefinition" item={definition} />
                  <TranslateButton entityType="CatalogAttributeDefinition" id={definition.id} />
                </div>
              </div>
              <div className="mt-2">
                <TranslationEditor entityType="CatalogAttributeDefinition" item={definition} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Значения характеристик</h2>
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {attributeValues.slice(0, 40).map((value) => (
            <li key={value.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-slate-200">{value.name}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <TranslationStatus entityType="CatalogAttributeValue" item={value} />
                  <TranslateButton entityType="CatalogAttributeValue" id={value.id} />
                </div>
              </div>
              <div className="mt-2">
                <TranslationEditor entityType="CatalogAttributeValue" item={value} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

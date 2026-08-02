'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Check, CheckCheck, Eye, RefreshCw, X } from 'lucide-react'
import {
  getBatchAiRunAction,
  getBatchAiSuggestionsAction,
  reviewBatchAiSuggestionAction,
  startBatchAiAction,
} from '@/actions/batch-ai'

export default function BatchAiReviewDialog({
  batchId,
  batchName,
  onClose,
  onReviewed,
}: {
  batchId: string
  batchName: string
  onClose: () => void
  onReviewed?: () => void | Promise<void>
}) {
  const [items, setItems] = useState<any[]>([])
  const [payloads, setPayloads] = useState<Record<string, string>>({})
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, number[]>>({})
  const [productColors, setProductColors] = useState<Record<string, Record<string, string>>>({})
  const [previewProduct, setPreviewProduct] = useState<any | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [acceptingAll, setAcceptingAll] = useState(false)
  const [pending, startTransition] = useTransition()

  const loadSuggestions = useCallback(async () => {
    const result = await getBatchAiSuggestionsAction(batchId)
    const suggestions = result.data || []
    setItems(suggestions)
    setPayloads(Object.fromEntries(suggestions.map((item: any) => [item.id, JSON.stringify(item.payload, null, 2)])))
    setSelectedProductIds(Object.fromEntries(suggestions.map((item: any) => [
      item.id,
      (item.affected_product_ids || []).map(Number),
    ])))
    setProductColors(Object.fromEntries(suggestions.map((item: any) => [
      item.id,
      Object.fromEntries((item.affected_products || []).map((product: any) => [
        String(product.id),
        String(item.payload?.suggested_colors?.[String(product.id)]?.color || valueList(product.attributes?.colors)[0] || ''),
      ])),
    ])))
  }, [batchId])

  useEffect(() => { void loadSuggestions() }, [loadSuggestions])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  const review = (item: any, decision: 'approved' | 'rejected') => startTransition(async () => {
    let payload = item.payload
    try { payload = JSON.parse(payloads[item.id]) } catch { return alert('Исправьте JSON предложения') }
    const result = await reviewBatchAiSuggestionAction(
      item.id,
      decision,
      payload,
      item.kind === 'color_family' ? selectedProductIds[item.id] : undefined,
      item.kind === 'color_family' ? productColors[item.id] : undefined,
    )
    if (result.success) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: decision, payload } : entry))
      await onReviewed?.()
    }
    else alert(result.error)
  })

  const rebuild = async () => {
    setRebuilding(true)
    try {
      const result = await startBatchAiAction(batchId, 'variants')
      if (!result.success) return alert(result.error)
      const runId = String((result.data as any)?.runId || '')
      if (runId && Number((result.data as any)?.queued || 0) > 0) {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          const run = await getBatchAiRunAction(runId)
          if (['completed', 'failed', 'cancelled'].includes(String((run.data as any)?.status || ''))) break
        }
      }
      await loadSuggestions()
      await onReviewed?.()
    } finally {
      setRebuilding(false)
    }
  }

  const acceptAll = async () => {
    const pendingItems = items.filter((item) => item.status === 'pending')
    if (!pendingItems.length) return
    if (!window.confirm(`Применить все ожидающие предложения (${pendingItems.length})? Конфликтные семьи останутся на ручную проверку.`)) return
    setAcceptingAll(true)
    let approved = 0
    const failures: string[] = []
    try {
      for (const item of pendingItems) {
        let payload = item.payload
        try {
          payload = JSON.parse(payloads[item.id])
        } catch {
          failures.push(`${suggestionTitle(item)}: некорректный JSON`)
          continue
        }
        const result = await reviewBatchAiSuggestionAction(
          item.id,
          'approved',
          payload,
          item.kind === 'color_family' ? selectedProductIds[item.id] : undefined,
          item.kind === 'color_family' ? productColors[item.id] : undefined,
        )
        if (result.success) approved += 1
        else failures.push(`${suggestionTitle(item)}: ${result.error}`)
      }
      await loadSuggestions()
      await onReviewed?.()
      if (failures.length) {
        alert(`Принято: ${approved}. Осталось проверить: ${failures.length}.\n\n${failures.slice(0, 8).join('\n')}${failures.length > 8 ? '\n…' : ''}`)
      }
    } finally {
      setAcceptingAll(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[125] overflow-y-auto overscroll-contain bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-700 bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-700 px-5 py-4"><div><h2 className="text-lg font-bold text-white">Предложения ИИ</h2><p className="text-xs text-slate-400">{batchName}</p></div><div className="flex items-center gap-2">{items.some((item) => item.status === 'pending') && <button onClick={acceptAll} disabled={acceptingAll || rebuilding || pending} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><CheckCheck className={`h-4 w-4 ${acceptingAll ? 'animate-pulse' : ''}`} />{acceptingAll ? 'Принимаем…' : 'Принять всё'}</button>}<button onClick={rebuild} disabled={rebuilding || acceptingAll || pending} className="inline-flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-sm font-semibold text-violet-200 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${rebuilding ? 'animate-spin' : ''}`} />{rebuilding ? 'Пересобираем…' : 'Пересобрать семьи'}</button><button onClick={onClose} disabled={acceptingAll} className="rounded p-2 text-slate-400 hover:bg-slate-800 disabled:opacity-50"><X className="h-5 w-5" /></button></div></header>
        <div className="space-y-4 p-5">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-700 bg-slate-950 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-indigo-500/10 px-2 py-1 text-xs font-semibold text-indigo-300">{kindLabel(item.kind)}</span>
                  <span className="text-sm font-semibold text-white">{suggestionTitle(item)}</span>
                  <span className="text-xs text-slate-500">{productCount(item.affected_product_ids?.length || 0)}</span>
                </div>
                <span className="text-xs text-slate-400">{statusLabel(item.status)}</span>
              </div>
              {item.kind === 'color_family' && <ColorFamilyPreview
                item={item}
                selectedIds={selectedProductIds[item.id] || []}
                disabled={item.status !== 'pending'}
                colorValues={productColors[item.id] || {}}
                onToggle={(productId) => setSelectedProductIds((current) => {
                  const selected = new Set(current[item.id] || [])
                  if (selected.has(productId)) selected.delete(productId)
                  else selected.add(productId)
                  return { ...current, [item.id]: [...selected] }
                })}
                onColorChange={(productId, color) => setProductColors((current) => ({
                  ...current,
                  [item.id]: { ...(current[item.id] || {}), [String(productId)]: color },
                }))}
                onOpenProduct={setPreviewProduct}
              />}
              <details className="mt-3">
                <summary className="cursor-pointer select-none text-xs text-slate-500 hover:text-slate-300">Технические данные</summary>
                <textarea value={payloads[item.id] || ''} onChange={(event) => setPayloads((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status !== 'pending'} className="mt-2 min-h-48 w-full rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-300 disabled:opacity-60" />
              </details>
              {item.status === 'pending' && <div className="mt-3 flex gap-2"><button onClick={() => review(item, 'approved')} disabled={pending || acceptingAll} className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" /> Одобрить и применить</button><button onClick={() => review(item, 'rejected')} disabled={pending || acceptingAll} className="inline-flex items-center gap-2 rounded border border-red-500/30 px-3 py-2 text-sm text-red-300 disabled:opacity-50"><X className="h-4 w-4" /> Отклонить</button></div>}
            </article>
          ))}
          {items.length === 0 && <p className="py-16 text-center text-slate-500">Новых подкатегорий, атрибутов или цветовых семейств нет.</p>}
        </div>
      </div>
      {previewProduct && <ProductPreview product={previewProduct} onClose={() => setPreviewProduct(null)} />}
    </div>
  )
}

function kindLabel(kind: string) {
  return kind === 'subcategory' ? 'Подкатегория' : kind === 'color_family' ? 'Цветовое семейство' : 'Атрибут'
}

function statusLabel(status: string) {
  return status === 'approved' ? 'Одобрено' : status === 'rejected' ? 'Отклонено' : 'Ожидает решения'
}

function suggestionTitle(item: any) {
  if (item.kind === 'color_family') {
    return item.payload?.model_name || item.affected_products?.[0]?.name || 'Цветовые варианты'
  }
  return item.payload?.name || item.payload?.label || item.canonical_key
}

function productCount(count: number) {
  const suffix = count % 10 === 1 && count % 100 !== 11
    ? 'товар'
    : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)
      ? 'товара'
      : 'товаров'
  return `${count} ${suffix}`
}

function valueList(value: unknown) {
  if (Array.isArray(value)) return value.map(String)
  return value ? [String(value)] : []
}

function ColorFamilyPreview({
  item,
  selectedIds,
  disabled,
  colorValues,
  onToggle,
  onColorChange,
  onOpenProduct,
}: {
  item: any
  selectedIds: number[]
  disabled: boolean
  colorValues: Record<string, string>
  onToggle: (productId: number) => void
  onColorChange: (productId: number, color: string) => void
  onOpenProduct: (product: any) => void
}) {
  const observedColors = valueList(item.payload?.observed_colors)
  const excludedCount = valueList(item.payload?.excluded_duplicate_product_ids).length
  const suggestedDuplicateIds = new Set(valueList(item.payload?.suggested_duplicate_product_ids).map(Number))
  const conflictCount = Array.isArray(item.payload?.color_conflicts) ? item.payload.color_conflicts.length : 0
  const source = item.payload?.source === 'internal_code'
    ? 'Совпадение по внутреннему артикулу'
    : item.payload?.source === 'visual_comparison'
      ? `Сверено по фотографиям · ${Math.round(Number(item.payload?.confidence || 0) * 100)}%`
      : ''
  return (
    <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-400">Объединить как варианты по цвету:</span>
        {observedColors.map((color) => <span key={color} className="rounded-full border border-indigo-400/25 bg-indigo-400/10 px-2 py-0.5 text-xs text-indigo-200">{color}</span>)}
      </div>
      {(source || excludedCount > 0 || suggestedDuplicateIds.size > 0 || conflictCount > 0) && <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="text-emerald-300">{source}</span>{excludedCount > 0 && <span className="text-slate-400">Ранее исключённых дублей: {excludedCount}</span>}{suggestedDuplicateIds.size > 0 && <span className="text-amber-300">ИИ предполагает дублей: {suggestedDuplicateIds.size} — проверьте вручную</span>}{conflictCount > 0 && <span className="text-amber-300">Уточните одинаково названные оттенки</span>}</div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(item.affected_products || []).map((product: any) => {
          const photo = Array.isArray(product.photos) ? product.photos[0] : null
          const productColors = valueList(product.attributes?.colors)
          const selected = selectedIds.includes(Number(product.id))
          const suggestedDuplicate = suggestedDuplicateIds.has(Number(product.id))
          return (
            <div
              role="button"
              tabIndex={disabled ? -1 : 0}
              key={product.id}
              onClick={() => { if (!disabled) onToggle(Number(product.id)) }}
              onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) onToggle(Number(product.id)) }}
              className={`relative flex min-w-0 gap-3 rounded-lg border p-2 text-left transition ${selected ? 'border-indigo-400/50 bg-slate-900' : 'border-slate-800 bg-slate-950 opacity-45'} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-600 bg-slate-900'}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
              <div
                role="button"
                tabIndex={0}
                title="Открыть товар"
                onClick={(event) => { event.stopPropagation(); onOpenProduct(product) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                    onOpenProduct(product)
                  }
                }}
                className="group/photo relative h-16 w-16 shrink-0 cursor-zoom-in rounded-md bg-slate-800 bg-cover bg-center"
                style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
              >
                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-950/55 opacity-0 transition group-hover/photo:opacity-100"><Eye className="h-5 w-5 text-white" /></span>
              </div>
              <div className="min-w-0 py-0.5">
                <button type="button" onClick={(event) => { event.stopPropagation(); onOpenProduct(product) }} className="block max-w-full truncate text-left text-sm font-medium text-white hover:text-indigo-300 hover:underline">{product.name || `Товар #${product.id}`}</button>
                {suggestedDuplicate && <p className="mt-1 text-[11px] font-medium text-amber-300">Возможный дубль по мнению ИИ</p>}
                <input
                  value={colorValues[String(product.id)] ?? productColors[0] ?? ''}
                  disabled={disabled || !selected}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => onColorChange(Number(product.id), event.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-indigo-200 outline-none focus:border-indigo-400 disabled:opacity-60"
                  placeholder="Название оттенка"
                />
                <p className="mt-1 truncate text-xs text-slate-500">{product.attributes?.dimensions || product.external_id}</p>
              </div>
            </div>
          )
        })}
      </div>
      {!disabled && <p className="mt-2 text-xs text-slate-500">Разным оттенкам задайте разные названия. Нажмите на карточку, чтобы исключить только настоящий дубль.</p>}
    </div>
  )
}

function ProductPreview({ product, onClose }: { product: any; onClose: () => void }) {
  const photos = Array.isArray(product.photos) ? product.photos.map(String).filter(Boolean) : []
  const [selectedPhoto, setSelectedPhoto] = useState(0)
  const attributes = product.attributes && typeof product.attributes === 'object' ? product.attributes : {}
  return (
    <div className="fixed inset-0 z-[140] flex justify-end bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto overscroll-contain border-l border-slate-700 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-700 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white">{product.name || `Товар #${product.id}`}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">#{product.source_position != null ? Number(product.source_position) + 1 : product.id} · {product.external_id}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-6 p-5">
          {photos.length > 0 ? <>
            <div className="aspect-square w-full rounded-xl border border-slate-700 bg-slate-950 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${photos[selectedPhoto]}")` }} />
            {photos.length > 1 && <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {photos.map((photo: string, index: number) => <button type="button" key={`${photo}-${index}`} onClick={() => setSelectedPhoto(index)} className={`aspect-square rounded-lg border bg-slate-950 bg-cover bg-center ${selectedPhoto === index ? 'border-indigo-400 ring-2 ring-indigo-400/20' : 'border-slate-700 hover:border-slate-500'}`} style={{ backgroundImage: `url("${photo}")` }} aria-label={`Фото ${index + 1}`} />)}
            </div>}
          </> : <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">Фотографий нет</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewField label="Цвет" value={valueList(attributes.colors).join(', ')} />
            <PreviewField label="Внутренний артикул" value={attributes.model_code || product.variant_group_key} />
            <PreviewField label="Размеры" value={valueList(attributes.sizes).join(', ')} />
            <PreviewField label="Материал" value={valueList(attributes.materials).join(', ')} />
          </div>
          {product.description && <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Описание</h4><p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{product.description}</p></section>}
        </div>
      </aside>
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: unknown }) {
  const text = String(value || '').trim()
  if (!text) return null
  return <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-sm text-slate-200">{text}</div></div>
}

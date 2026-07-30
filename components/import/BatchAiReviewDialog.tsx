'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import { getBatchAiSuggestionsAction, reviewBatchAiSuggestionAction } from '@/actions/batch-ai'

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
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    getBatchAiSuggestionsAction(batchId).then((result) => {
      const suggestions = result.data || []
      setItems(suggestions)
      setPayloads(Object.fromEntries(suggestions.map((item: any) => [item.id, JSON.stringify(item.payload, null, 2)])))
    })
  }, [batchId])

  const review = (item: any, decision: 'approved' | 'rejected') => startTransition(async () => {
    let payload = item.payload
    try { payload = JSON.parse(payloads[item.id]) } catch { return alert('Исправьте JSON предложения') }
    const result = await reviewBatchAiSuggestionAction(item.id, decision, payload)
    if (result.success) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: decision, payload } : entry))
      await onReviewed?.()
    }
    else alert(result.error)
  })

  return (
    <div className="fixed inset-0 z-[125] overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-700 bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4"><div><h2 className="text-lg font-bold text-white">Предложения ИИ</h2><p className="text-xs text-slate-400">{batchName}</p></div><button onClick={onClose} className="rounded p-2 text-slate-400 hover:bg-slate-800"><X className="h-5 w-5" /></button></header>
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
              {item.kind === 'color_family' && <ColorFamilyPreview item={item} />}
              <details className="mt-3">
                <summary className="cursor-pointer select-none text-xs text-slate-500 hover:text-slate-300">Технические данные</summary>
                <textarea value={payloads[item.id] || ''} onChange={(event) => setPayloads((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status !== 'pending'} className="mt-2 min-h-48 w-full rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-300 disabled:opacity-60" />
              </details>
              {item.status === 'pending' && <div className="mt-3 flex gap-2"><button onClick={() => review(item, 'approved')} disabled={pending} className="inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"><Check className="h-4 w-4" /> Одобрить и применить</button><button onClick={() => review(item, 'rejected')} disabled={pending} className="inline-flex items-center gap-2 rounded border border-red-500/30 px-3 py-2 text-sm text-red-300"><X className="h-4 w-4" /> Отклонить</button></div>}
            </article>
          ))}
          {items.length === 0 && <p className="py-16 text-center text-slate-500">Новых подкатегорий, атрибутов или цветовых семейств нет.</p>}
        </div>
      </div>
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

function ColorFamilyPreview({ item }: { item: any }) {
  const colors = valueList(item.payload?.observed_colors)
  return (
    <div className="mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-400">Объединить как варианты по цвету:</span>
        {colors.map((color) => <span key={color} className="rounded-full border border-indigo-400/25 bg-indigo-400/10 px-2 py-0.5 text-xs text-indigo-200">{color}</span>)}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(item.affected_products || []).map((product: any) => {
          const photo = Array.isArray(product.photos) ? product.photos[0] : null
          const productColors = valueList(product.attributes?.colors)
          return (
            <div key={product.id} className="flex min-w-0 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-2">
              <div
                className="h-16 w-16 shrink-0 rounded-md bg-slate-800 bg-cover bg-center"
                style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
              />
              <div className="min-w-0 py-0.5">
                <p className="truncate text-sm font-medium text-white">{product.name || `Товар #${product.id}`}</p>
                <p className="mt-1 truncate text-xs text-indigo-300">{productColors.join(', ') || 'Цвет не указан'}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{product.attributes?.dimensions || product.external_id}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
              <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="rounded bg-indigo-500/10 px-2 py-1 text-xs font-semibold text-indigo-300">{kindLabel(item.kind)}</span><span className="ml-2 text-sm font-semibold text-white">{item.canonical_key}</span><span className="ml-2 text-xs text-slate-500">{item.affected_product_ids?.length || 0} товаров</span></div><span className="text-xs text-slate-400">{statusLabel(item.status)}</span></div>
              <textarea value={payloads[item.id] || ''} onChange={(event) => setPayloads((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status !== 'pending'} className="mt-3 min-h-48 w-full rounded border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-300 disabled:opacity-60" />
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

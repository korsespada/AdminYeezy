'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, RefreshCw, Save, X } from 'lucide-react'
import {
  buildSupplierModelReferencesAction,
  getSupplierModelReferencesAction,
  saveSupplierModelReferencesAction,
} from '@/actions/batch-ai'
import { useModalDismiss } from '@/components/ui/use-modal-dismiss'

type ModelReference = {
  model_key: string
  model_name: string
  aliases: string[]
  visual_hint: string
  reference_images: string[]
  source_batch_id?: string | null
  source_product_id?: number | null
  enabled?: boolean
}

export default function SupplierModelReferencesDialog({
  supplierId,
  supplierName,
  batchId,
  onClose,
}: {
  supplierId: number
  supplierName: string
  batchId: string
  onClose: () => void
}) {
  const [references, setReferences] = useState<ModelReference[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const contentRef = useRef<HTMLDivElement>(null)

  useModalDismiss(true, onClose, contentRef)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getSupplierModelReferencesAction(supplierId)
    if (result.success) setReferences((result.data || []) as ModelReference[])
    else setMessage('Не удалось загрузить справочник')
    setLoading(false)
  }, [supplierId])

  useEffect(() => { void load() }, [load])

  const build = () => startTransition(async () => {
    setMessage('')
    const result = await buildSupplierModelReferencesAction(supplierId, batchId)
    if (result.success) {
      setReferences((result.data || []) as ModelReference[])
      setMessage(`Собрано эталонов: ${result.data?.length || 0}`)
    } else setMessage(result.error || 'Не удалось собрать справочник')
  })

  const update = (index: number, patch: Partial<ModelReference>) => {
    setReferences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const save = () => startTransition(async () => {
    setMessage('')
    const result = await saveSupplierModelReferencesAction(supplierId, references)
    if (result.success) {
      setMessage('Справочник сохранён')
      setTimeout(onClose, 350)
    } else setMessage(result.error || 'Не удалось сохранить справочник')
  })

  return (
    <div className="fixed inset-0 z-[125] bg-slate-950/90 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div ref={contentRef} role="dialog" aria-modal="true" aria-label={`Справочник моделей для ${supplierName}`} className="mx-auto flex max-h-[calc(100vh-1.5rem)] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-white">Справочник моделей · {supplierName}</h2>
            <p className="mt-1 text-xs text-slate-400">Один визуальный эталон на модель. Текст и aliases помогают, но решение принимает ИИ по фотографиям.</p>
          </div>
          <button onClick={onClose} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
          <button onClick={build} disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Собрать из этой выгрузки
          </button>
          <button onClick={save} disabled={pending || loading} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
            <Save className="h-4 w-4" /> Сохранить
          </button>
          {message && <span className="text-xs text-slate-400">{message}</span>}
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
          ) : references.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">Нажмите «Собрать из этой выгрузки» — система сама выберет по одной фотографии каждой найденной модели.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {references.map((reference, index) => (
                <article key={reference.model_key} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950/40">
                  {reference.reference_images[0] && <img src={reference.reference_images[0]} alt={reference.model_name} className="h-48 w-full object-cover" />}
                  <div className="space-y-2 p-3">
                    <input value={reference.model_name} onChange={(event) => update(index, { model_name: event.target.value })} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-semibold text-white" />
                    <input value={reference.model_key} onChange={(event) => update(index, { model_key: event.target.value })} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-400" />
                    <input value={reference.aliases.join(', ')} onChange={(event) => update(index, { aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Китайские aliases" className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300" />
                    <textarea value={reference.visual_hint} onChange={(event) => update(index, { visual_hint: event.target.value })} rows={2} className="w-full resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

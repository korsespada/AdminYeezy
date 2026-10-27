'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import { getSupplierPriceRulesAction, saveSupplierPriceInstructionAction } from '@/actions/batch-ai'
import { useModalDismiss } from '@/components/ui/use-modal-dismiss'

// Цены поставщика задаются одним свободным полем для ИИ. Структурные правила
// в этой модалке не редактируются и при сохранении не затрагиваются.
export default function SupplierPriceRulesDialog({ supplierId, supplierName, onClose }: { supplierId: number; supplierName: string; onClose: () => void }) {
  const [aiInstruction, setAiInstruction] = useState('')
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useModalDismiss(true, onClose, contentRef)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getSupplierPriceRulesAction(supplierId).then((stored) => {
      if (cancelled) return
      if (stored.success) {
        const legacyInstructions = (stored.data?.rules || [])
          .map((rule: any) => String(rule.conditions?.ai_instruction || '').trim())
          .filter(Boolean)
        setAiInstruction(String(stored.data?.aiInstruction || legacyInstructions.join('\n')).trim())
      } else setLoadError('Не удалось загрузить правила цен')
    }).catch((error: any) => {
      if (!cancelled) setLoadError(error?.message || 'Не удалось загрузить правила цен')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [supplierId])

  const save = () => startTransition(async () => {
    const result = await saveSupplierPriceInstructionAction(supplierId, aiInstruction)
    if (result.success) onClose()
    else alert(result.error)
  })

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div ref={contentRef} role="dialog" aria-modal="true" aria-label={`Правила цен для ${supplierName}`} className="mx-auto mt-[10vh] flex max-h-[calc(100vh-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-lg font-bold text-white">Правила цен · {supplierName}</h2>
          <button onClick={onClose} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</div>}
          {loadError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{loadError}</div>}
          {!loading && !loadError && <>
            <textarea
              value={aiInstruction}
              onChange={(event) => setAiInstruction(event.target.value)}
              placeholder="Например: футболки — 5 000 ₽, худи — 8 000 ₽, платья — 12 000 ₽"
              rows={10}
              autoFocus
              aria-label="Цены для ИИ"
              className="price-rule-field resize-y"
            />
            <p className="mt-2 text-xs text-slate-500">Свободный текст для ИИ: перечислите товары и цены так, как удобно. ИИ подставит цену, которая явно указана для товара.</p>
          </>}
        </div>
        <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-700 bg-slate-900 p-3">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Отмена</button>
          <button onClick={save} disabled={pending || loading || Boolean(loadError)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Сохранить
          </button>
        </footer>
      </div>
    </div>
  )
}

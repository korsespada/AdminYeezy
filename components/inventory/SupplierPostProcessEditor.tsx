'use client'

import React from 'react'
import {
  activateSupplierPostProcessVersionAction,
  getSupplierPostProcessBatchesAction,
  getSupplierPostProcessVersionsAction,
  previewSupplierPostProcessVersionAction,
  saveSupplierPostProcessVersionAction,
} from '@/actions/supplier-post-process'

type Version = {
  id: string
  version: number
  name: string
  source: string
  is_active: boolean
  created_at: string
}

type Batch = { id: string; name: string; items_count: number; created_at: string }

const STARTER = `def process_products(products):
    # Верните новый массив товаров. Не меняйте external_id.
    return products
`

export function SupplierPostProcessEditor({ supplierId, legacyScript }: { supplierId: number; legacyScript?: string | null }) {
  const [versions, setVersions] = React.useState<Version[]>([])
  const [batches, setBatches] = React.useState<Batch[]>([])
  const [name, setName] = React.useState('')
  const [source, setSource] = React.useState(STARTER)
  const [selectedId, setSelectedId] = React.useState('')
  const [batchId, setBatchId] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    const [versionsResult, batchesResult] = await Promise.all([
      getSupplierPostProcessVersionsAction(supplierId),
      getSupplierPostProcessBatchesAction(supplierId),
    ])
    if (versionsResult.success) {
      const items = versionsResult.data || []
      setVersions(items)
      const active = items.find((item) => item.is_active) || items[0]
      setSelectedId(active?.id || '')
    }
    if (batchesResult.success) {
      const items = batchesResult.data || []
      setBatches(items)
      setBatchId((current) => current || items[0]?.id || '')
    }
  }, [supplierId])

  React.useEffect(() => { void load() }, [load])

  const save = async () => {
    setBusy(true); setMessage('')
    const result = await saveSupplierPostProcessVersionAction(supplierId, name, source)
    setBusy(false)
    if (!result.success) { setMessage(`Ошибка: ${result.error}`); return }
    setMessage(`Сохранена версия ${result.data?.version}. Проверьте её на выгрузке и активируйте.`)
    setName('')
    await load()
    setSelectedId(result.data?.id || '')
  }

  const activate = async () => {
    if (!selectedId) return
    setBusy(true); setMessage('')
    const result = await activateSupplierPostProcessVersionAction(supplierId, selectedId)
    setBusy(false)
    if (!result.success) { setMessage(`Ошибка: ${result.error}`); return }
    setMessage('Версия активна. Для автоматического запуска оставьте включённым переключатель «Автоматически».')
    await load()
  }

  const preview = async () => {
    if (!selectedId || !batchId) { setMessage('Выберите сохранённую версию и выгрузку для проверки.'); return }
    setBusy(true); setMessage('')
    const result = await previewSupplierPostProcessVersionAction(supplierId, selectedId, batchId)
    setBusy(false)
    if (!result.success) { setMessage(`Ошибка preview: ${result.error}`); return }
    const data = result.data
    setMessage(`Preview: ${data?.inputCount} → ${data?.outputCount} товаров; удалено ${data?.removedCount}, изменено ${data?.changedCount}. Данные выгрузки не менялись.`)
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-amber-200">Постобработка без деплоя</h4>
          <p className="mt-1 text-[11px] text-slate-400">Код хранится в базе как версия. Вставьте функцию, сохраните, проверьте на прошлой выгрузке и активируйте.</p>
        </div>
        {legacyScript && <span className="text-[10px] text-slate-500">Legacy: {legacyScript}</span>}
      </div>

      <label className="mt-3 block text-[11px] text-slate-400">Название версии
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: склейка ленты и фильтр витрины" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-400" />
      </label>
      <label className="mt-3 block text-[11px] text-slate-400">Python-код
        <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} className="mt-1 min-h-44 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-amber-400" />
      </label>
      <button type="button" onClick={save} disabled={busy} className="mt-2 rounded-lg border border-amber-400/50 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/10 disabled:opacity-50">Сохранить новую версию</button>

      {versions.length > 0 && <div className="mt-4 border-t border-slate-700 pt-3">
        <label className="block text-[11px] text-slate-400">Сохранённая версия
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-400">
            {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.name}{version.is_active ? ' · активна' : ''}</option>)}
          </select>
        </label>
        <label className="mt-2 block text-[11px] text-slate-400">Выгрузка для preview
          <select value={batchId} onChange={(event) => setBatchId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-400">
            <option value="">Выберите выгрузку</option>
            {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name || 'Выгрузка'} · {batch.items_count} шт. · {new Date(batch.created_at).toLocaleDateString('ru-RU')}</option>)}
          </select>
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={preview} disabled={busy || !batchId} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">Preview без сохранения</button>
          <button type="button" onClick={activate} disabled={busy || !selectedId} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">Активировать версию</button>
        </div>
      </div>}
      {message && <p className="mt-3 text-xs text-slate-300">{message}</p>}
    </div>
  )
}

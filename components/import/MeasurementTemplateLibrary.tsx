'use client'

import { useEffect, useState, useTransition } from 'react'
import { ImagePlus, Loader2, Pencil, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import { MeasurementsField } from '@/components/catalog-attributes/CatalogAttributeFields'
import {
  deleteMeasurementTemplateAction,
  getMeasurementTemplateSuppliersAction,
  getMeasurementTemplatesAction,
  recognizeMeasurementTemplateAction,
  saveMeasurementTemplateAction,
  uploadMeasurementTemplateImageAction,
} from '@/actions/measurement-templates'
import {
  MEASUREMENT_TEMPLATE_GARMENTS,
  measurementTemplateGarmentLabel,
  type MeasurementTemplate,
  type MeasurementTemplateGarment,
} from '@/lib/measurement-templates'

type Draft = {
  id?: number
  supplierId: number | null
  name: string
  garmentType: MeasurementTemplateGarment
  measurements: unknown
  sourceImageUrl: string
  notes: string
}

function newDraft(): Draft {
  return { supplierId: null, name: '', garmentType: 'pants', measurements: undefined, sourceImageUrl: '', notes: '' }
}

function fromTemplate(template: MeasurementTemplate): Draft {
  return {
    id: template.id,
    supplierId: template.supplierId,
    name: template.name,
    garmentType: template.garmentType,
    measurements: template.measurements,
    sourceImageUrl: template.sourceImageUrl || '',
    notes: template.notes,
  }
}

export default function MeasurementTemplateLibrary() {
  const [templates, setTemplates] = useState<MeasurementTemplate[]>([])
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; albumId: string }[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = async (supplierId = selectedSupplierId) => {
    setLoading(true)
    const result = await getMeasurementTemplatesAction(supplierId)
    if (result.success) setTemplates(result.data || [])
    else setMessage(result.error || 'Не удалось загрузить шаблоны')
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    getMeasurementTemplateSuppliersAction().then((result) => {
      if (cancelled) return
      if (!result.success) {
        setMessage(result.error || 'Не удалось загрузить поставщиков')
        setLoading(false)
        return
      }
      setSuppliers(result.data || [])
      const firstSupplierId = result.data?.[0]?.id || null
      setSelectedSupplierId(firstSupplierId)
      getMeasurementTemplatesAction(firstSupplierId).then((templatesResult) => {
        if (cancelled) return
        if (templatesResult.success) setTemplates(templatesResult.data || [])
        else setMessage(templatesResult.error || 'Не удалось загрузить шаблоны')
        setLoading(false)
      })
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  const upload = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || !draft) return
    setUploading(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const result = await uploadMeasurementTemplateImageAction(formData)
      if (!result.success || !result.data?.url) throw new Error(result.error || 'Не удалось загрузить скриншот')
      setDraft((current) => current ? { ...current, sourceImageUrl: result.data!.url } : current)
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setUploading(false)
    }
  }

  const save = () => {
    if (!draft) return
    startTransition(async () => {
      setMessage(null)
      const result = await saveMeasurementTemplateAction(draft)
      if (!result.success || !result.data) {
        setMessage(result.error || 'Не удалось сохранить шаблон')
        return
      }
      setTemplates((current) => {
        const rest = current.filter((item) => item.id !== result.data!.id)
        if (result.data!.supplierId !== selectedSupplierId) return rest
        return [...rest, result.data!].sort((left, right) => left.garmentType.localeCompare(right.garmentType) || left.name.localeCompare(right.name))
      })
      setDraft(null)
      setMessage('Шаблон сохранён')
    })
  }

  const recognize = async () => {
    if (!draft?.sourceImageUrl) return
    setRecognizing(true)
    setMessage(null)
    try {
      const result = await recognizeMeasurementTemplateAction(draft.sourceImageUrl)
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось распознать таблицу')
      setDraft((current) => current ? { ...current, measurements: result.data } : current)
      setMessage('Таблица распознана. Проверьте значения на скриншоте перед сохранением.')
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setRecognizing(false)
    }
  }

  const remove = (template: MeasurementTemplate) => {
    if (!confirm(`Удалить шаблон «${template.name}»? Уже назначенные таблицы у товаров не изменятся.`)) return
    startTransition(async () => {
      setMessage(null)
      const result = await deleteMeasurementTemplateAction(template.id)
      if (!result.success) {
        setMessage(result.error || 'Не удалось удалить шаблон')
        return
      }
      setTemplates((current) => current.filter((item) => item.id !== template.id))
      if (draft?.id === template.id) setDraft(null)
    })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(430px,0.8fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Сохранённые шаблоны</h2>
            <p className="mt-1 text-sm text-slate-400">Шаблоны изолированы по поставщикам и переносят только таблицу замеров.</p>
          </div>
          <button disabled={!selectedSupplierId} onClick={() => { setDraft({ ...newDraft(), supplierId: selectedSupplierId }); setMessage(null) }} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Новый шаблон
          </button>
        </div>
        <label className="mt-4 block max-w-md text-xs text-slate-400">Поставщик<select value={selectedSupplierId || ''} onChange={(event) => { const supplierId = Number(event.target.value) || null; setSelectedSupplierId(supplierId); setDraft(null); void load(supplierId) }} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500"><option value="">Выберите поставщика…</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        {message && <div className="mt-4 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">{message}</div>}
        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загружаю шаблоны…</div>
        ) : templates.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-500">У выбранного поставщика пока нет шаблонов замеров.</div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <article key={template.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/45">
                {template.sourceImageUrl && <img src={template.sourceImageUrl} alt={`Скриншот таблицы ${template.name}`} className="h-36 w-full border-b border-slate-800 object-cover object-top" />}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><h3 className="truncate text-sm font-bold text-white">{template.name}</h3><p className="mt-1 text-xs text-indigo-300">{measurementTemplateGarmentLabel(template.garmentType)}</p></div>
                    <div className="flex gap-1">
                      <button onClick={() => { setDraft(fromTemplate(template)); setMessage(null) }} title="Редактировать" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><Pencil className="h-4 w-4" /></button>
                      <button disabled={pending} onClick={() => remove(template)} title="Удалить" className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">{template.measurements.rows.length} размеров · {template.measurements.columns.map((column) => column.label).join(', ')}</p>
                  {template.notes && <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{template.notes}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        {!draft ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-700 px-6 text-center text-sm text-slate-500">Выберите шаблон для правки или создайте новый.</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-white">{draft.id ? 'Редактирование шаблона' : 'Новый шаблон'}</h2><p className="mt-1 text-xs text-slate-500">Сначала загрузите скриншот, затем один раз перенесите замеры в таблицу.</p></div><button onClick={() => setDraft(null)} title="Закрыть" className="rounded p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-slate-400">Поставщик<select value={draft.supplierId || ''} onChange={(event) => setDraft({ ...draft, supplierId: Number(event.target.value) || null })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500"><option value="">Выберите…</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="space-y-1 text-xs text-slate-400">Название<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, CH штаны 420 г" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500" /></label>
              <label className="space-y-1 text-xs text-slate-400">Тип товара<select value={draft.garmentType} onChange={(event) => setDraft({ ...draft, garmentType: event.target.value as MeasurementTemplateGarment })} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-500">{MEASUREMENT_TEMPLATE_GARMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-slate-300">Скриншот таблицы</div><p className="mt-1 text-[11px] text-slate-500">PNG, JPG или WebP до 12 МБ. Он остаётся подсказкой при правке.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-500/40 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/10"><ImagePlus className="h-4 w-4" />{uploading ? 'Загрузка…' : 'Загрузить'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files)} className="hidden" disabled={uploading} /></label></div>
              {draft.sourceImageUrl && <div className="mt-3"><img src={draft.sourceImageUrl} alt="Скриншот таблицы" className="max-h-64 w-full rounded-lg border border-slate-800 object-contain object-top" /><div className="mt-2 flex flex-wrap gap-3"><button onClick={() => void recognize()} disabled={recognizing} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 disabled:opacity-50"><Sparkles className="h-3.5 w-3.5" />{recognizing ? 'Распознаю…' : 'Распознать ИИ'}</button><button onClick={() => setDraft({ ...draft, sourceImageUrl: '' })} className="text-xs text-slate-500 hover:text-red-300">Отвязать скриншот</button></div></div>}
            </div>
            <MeasurementsField value={draft.measurements} onChange={(measurements) => setDraft({ ...draft, measurements })} />
            <label className="block space-y-1 text-xs text-slate-400">Описание и заметка (необязательно)<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={2} placeholder="Например, замеры по изделию; допустима погрешность 1–3 см" className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" /></label>
            <button onClick={save} disabled={pending || uploading} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Save className="h-4 w-4" />{pending ? 'Сохраняю…' : 'Сохранить шаблон'}</button>
          </div>
        )}
      </section>
    </div>
  )
}

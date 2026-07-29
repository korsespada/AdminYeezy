'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import { ImagePlus, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import { fetchLookupsAction } from '@/actions/csv-import'
import { getSupplierPriceRulesAction, saveSupplierPriceRulesAction, uploadPriceRuleReferenceAction } from '@/actions/batch-ai'

type Rule = {
  id?: number
  name: string
  priority: number
  price: number
  enabled: boolean
  category?: string
  subcategory?: string
  brand?: string
  model?: string
  material?: string
  sizeClass?: string
  ruleKey: string
  matchByReference: boolean
  visualHint?: string
  referenceImages: string[]
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

function rangeValue(value: unknown, key: 'min' | 'max') {
  return value && typeof value === 'object' && Number.isFinite(Number((value as any)[key]))
    ? Number((value as any)[key])
    : undefined
}

function textCondition(value: unknown) {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value || '')
}

function storedTextCondition(value: unknown) {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  return values.length > 1 ? values : (values[0] || '')
}

function fromStored(rule: any): Rule {
  const conditions = rule.conditions || {}
  return {
    id: rule.id,
    name: rule.name,
    priority: Number(rule.priority || 0),
    price: Number(rule.price || 0),
    enabled: rule.enabled !== false,
    category: conditions.category || '',
    subcategory: conditions.subcategory || '',
    brand: conditions.brand || '',
    model: textCondition(conditions['attributes.model_name']),
    material: textCondition(conditions['attributes.materials']),
    sizeClass: conditions['attributes.size_class'] || '',
    ruleKey: String(rule.rule_key || `rule_${rule.id}`),
    matchByReference: conditions.price_rule_key === String(rule.rule_key || `rule_${rule.id}`),
    visualHint: rule.visual_hint || '',
    referenceImages: Array.isArray(rule.reference_images) ? rule.reference_images : [],
    minWidth: rangeValue(conditions['attributes.bag_width_cm'], 'min'),
    maxWidth: rangeValue(conditions['attributes.bag_width_cm'], 'max'),
    minHeight: rangeValue(conditions['attributes.bag_height_cm'], 'min'),
    maxHeight: rangeValue(conditions['attributes.bag_height_cm'], 'max'),
  }
}

export default function SupplierPriceRulesDialog({ supplierId, supplierName, onClose }: { supplierId: number; supplierName: string; onClose: () => void }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [lookups, setLookups] = useState<any>({ brands: [], categories: [], subcategories: [] })
  const [pending, startTransition] = useTransition()
  const [uploadingRule, setUploadingRule] = useState<number | null>(null)
  const [loadingRules, setLoadingRules] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingRules(true)
    setLoadError(null)
    Promise.allSettled([getSupplierPriceRulesAction(supplierId), fetchLookupsAction()]).then(([stored, dictionaries]) => {
      if (cancelled) return
      if (stored.status === 'fulfilled' && stored.value.success) setRules((stored.value.data || []).map(fromStored))
      else setLoadError(stored.status === 'rejected' ? stored.reason?.message || 'Не удалось загрузить правила' : 'Не удалось загрузить правила')
      if (dictionaries.status === 'fulfilled') setLookups(dictionaries.value)
      setLoadingRules(false)
    })
    return () => { cancelled = true }
  }, [supplierId])

  const update = (index: number, patch: Partial<Rule>) => setRules((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const add = () => setRules((items) => [...items, {
    name: `Правило ${items.length + 1}`, priority: 0, price: 0, enabled: true,
    ruleKey: `rule_${Date.now()}_${items.length + 1}`, matchByReference: false, referenceImages: [],
  }])
  const range = (min?: number, max?: number) => {
    const result: Record<string, number> = {}
    if (Number.isFinite(min)) result.min = Number(min)
    if (Number.isFinite(max)) result.max = Number(max)
    return Object.keys(result).length ? result : ''
  }
  const uploadReferences = async (index: number, files: FileList | null) => {
    if (!files?.length) return
    setUploadingRule(index)
    try {
      const urls: string[] = []
      for (const file of Array.from(files).slice(0, 9 - rules[index].referenceImages.length)) {
        const formData = new FormData()
        formData.set('file', file)
        const result = await uploadPriceRuleReferenceAction(supplierId, formData)
        if (!result.success || !result.data?.url) throw new Error(result.error || 'Не удалось загрузить фотографию')
        urls.push(result.data.url)
      }
      update(index, { referenceImages: [...rules[index].referenceImages, ...urls] })
    } catch (error: any) {
      alert(error.message)
    } finally {
      setUploadingRule(null)
    }
  }
  const save = () => startTransition(async () => {
    const payload = rules.map((rule) => ({
      name: rule.name,
      priority: rule.priority,
      price: rule.price,
      enabled: rule.enabled,
      conditions: Object.fromEntries(Object.entries({
        category: rule.category,
        subcategory: rule.subcategory,
        brand: rule.brand,
        'attributes.model_name': storedTextCondition(rule.model),
        'attributes.materials': storedTextCondition(rule.material),
        'attributes.size_class': rule.sizeClass,
        'attributes.bag_width_cm': range(rule.minWidth, rule.maxWidth),
        'attributes.bag_height_cm': range(rule.minHeight, rule.maxHeight),
        price_rule_key: rule.matchByReference ? rule.ruleKey : '',
      }).filter(([, value]) => String(value || '').trim())),
      rule_key: rule.ruleKey,
      visual_hint: rule.visualHint,
      reference_images: rule.referenceImages,
    }))
    const result = await saveSupplierPriceRulesAction(supplierId, payload)
    if (result.success) onClose()
    else alert(result.error)
  })

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 p-3 backdrop-blur-sm">
      <div className="mx-auto flex max-h-[calc(100vh-1.5rem)] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
          <div><h2 className="text-lg font-bold text-white">Правила цен · {supplierName}</h2><p className="mt-1 text-xs text-slate-400">Побеждает самое конкретное условие, затем больший приоритет.</p></div>
          <button onClick={onClose} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loadingRules && <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Загрузка правил…</div>}
          {loadError && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{loadError}</div>}
          {!loadingRules && <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {rules.map((rule, index) => (
              <article key={rule.id || rule.ruleKey || index} className={`rounded-lg border p-3 ${rule.enabled ? 'border-slate-700 bg-slate-800/55' : 'border-slate-800 bg-slate-900/60 opacity-60'}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} title="Включить правило" />
                  <input value={rule.name} onChange={(event) => update(index, { name: event.target.value })} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm font-medium text-white" />
                  <input type="number" min="0" value={rule.price} onChange={(event) => update(index, { price: Number(event.target.value) })} className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-right text-sm font-semibold text-emerald-300" title="Цена" />
                  <span className="text-xs text-slate-500">₽</span>
                  <button type="button" onClick={() => setRules((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-1.5 text-red-400 hover:bg-red-500/10" title="Удалить правило"><Trash2 className="h-4 w-4" /></button>
                </div>

                <div className="mt-2 flex min-h-10 flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                  <span className="rounded bg-slate-950 px-2 py-1">приоритет {rule.priority}</span>
                  {rule.model && <span className="max-w-48 truncate rounded bg-indigo-500/10 px-2 py-1 text-indigo-200">{rule.model}</span>}
                  {rule.sizeClass && <span className="rounded bg-cyan-500/10 px-2 py-1 text-cyan-200">{rule.sizeClass}</span>}
                  {(rule.minWidth !== undefined || rule.maxWidth !== undefined) && <span className="rounded bg-slate-950 px-2 py-1">Ш {rule.minWidth ?? '…'}–{rule.maxWidth ?? '…'} см</span>}
                  {(rule.minHeight !== undefined || rule.maxHeight !== undefined) && <span className="rounded bg-slate-950 px-2 py-1">В {rule.minHeight ?? '…'}–{rule.maxHeight ?? '…'} см</span>}
                  {rule.matchByReference && <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-200">точный эталон</span>}
                  {rule.referenceImages.slice(0, 4).map((url) => <Image key={url} src={url} alt="Эталон" width={30} height={30} unoptimized className="h-7 w-7 rounded object-cover" />)}
                  {rule.referenceImages.length > 4 && <span>+{rule.referenceImages.length - 4}</span>}
                </div>

                <details className="mt-2 border-t border-slate-700/70 pt-2">
                  <summary className="cursor-pointer select-none text-xs font-medium text-slate-400 hover:text-white">Условия и фото</summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Бренд"><Select value={rule.brand} onChange={(value) => update(index, { brand: value })} items={lookups.brands} /></Field>
                      <Field label="Категория"><Select value={rule.category} onChange={(value) => update(index, { category: value, subcategory: '' })} items={lookups.categories} /></Field>
                      <Field label="Подкатегория"><Select value={rule.subcategory} onChange={(value) => update(index, { subcategory: value })} items={lookups.subcategories.filter((item: any) => !rule.category || String(item.category_id || item.category) === rule.category)} /></Field>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <Field label="Модель / алиасы"><input value={rule.model || ''} onChange={(event) => update(index, { model: event.target.value })} placeholder="Classic Flap, CF" className="price-rule-field" /></Field>
                      <Field label="Материал"><input value={rule.material || ''} onChange={(event) => update(index, { material: event.target.value })} placeholder="кожа" className="price-rule-field" /></Field>
                      <Field label="Класс"><select value={rule.sizeClass || ''} onChange={(event) => update(index, { sizeClass: event.target.value })} className="price-rule-field"><option value="">Любой</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></Field>
                      <Field label="Приоритет"><input type="number" value={rule.priority} onChange={(event) => update(index, { priority: Number(event.target.value) })} className="price-rule-field" /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2"><Field label="Ширина, см"><RangeInputs min={rule.minWidth} max={rule.maxWidth} onChange={(min, max) => update(index, { minWidth: min, maxWidth: max })} /></Field><Field label="Высота, см"><RangeInputs min={rule.minHeight} max={rule.maxHeight} onChange={(min, max) => update(index, { minHeight: min, maxHeight: max })} /></Field></div>
                    <textarea value={rule.visualHint || ''} onChange={(event) => update(index, { visualHint: event.target.value })} placeholder="Как AI отличить эту модель по фото" rows={2} className="price-rule-field resize-none" />
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={rule.matchByReference} onChange={(event) => update(index, { matchByReference: event.target.checked })} />Точное совпадение с эталоном</label>
                      {rule.referenceImages.map((url, photoIndex) => <span key={url} className="relative"><Image src={url} alt="Эталон" width={42} height={42} unoptimized className="h-10 w-10 rounded object-cover" /><button type="button" onClick={() => update(index, { referenceImages: rule.referenceImages.filter((_, itemIndex) => itemIndex !== photoIndex) })} className="absolute -right-1 -top-1 rounded-full bg-red-600 p-0.5 text-white"><X className="h-3 w-3" /></button></span>)}
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">{uploadingRule === index ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}Фото<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={uploadingRule !== null} onChange={(event) => { void uploadReferences(index, event.target.files); event.currentTarget.value = '' }} /></label>
                    </div>
                  </div>
                </details>
              </article>
            ))}
          </div>}
          {!loadingRules && !loadError && rules.length === 0 && <p className="py-10 text-center text-slate-500">Правил пока нет. При отсутствии совпадения используется стандартная цена поставщика, затем 0.</p>}
        </div>
        <footer className="flex shrink-0 gap-3 border-t border-slate-700 bg-slate-900 p-3"><button onClick={add} disabled={loadingRules || Boolean(loadError)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"><Plus className="h-4 w-4" /> Добавить</button><button onClick={save} disabled={pending || loadingRules || Boolean(loadError)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> Сохранить правила</button><span className="ml-auto self-center text-xs text-slate-500">{loadingRules ? 'Загрузка…' : `${rules.length} правил`}</span></footer>
      </div>
    </div>
  )
}

function Select({ value, onChange, items }: { value?: string; onChange: (value: string) => void; items: any[] }) {
  return <select value={value || ''} onChange={(event) => onChange(event.target.value)} className="price-rule-field"><option value="">Любой</option>{items.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select>
}

function RangeInputs({ min, max, onChange }: { min?: number; max?: number; onChange: (min?: number, max?: number) => void }) {
  return <div className="flex gap-1"><input type="number" min="0" step="0.5" value={min ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value), max)} placeholder="от" className="price-rule-field" /><input type="number" min="0" step="0.5" value={max ?? ''} onChange={(event) => onChange(min, event.target.value === '' ? undefined : Number(event.target.value))} placeholder="до" className="price-rule-field" /></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-0 text-[10px] uppercase tracking-wide text-slate-500"><span className="mb-1 block">{label}</span>{children}</label>
}

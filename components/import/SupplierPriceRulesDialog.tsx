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

  useEffect(() => {
    Promise.all([getSupplierPriceRulesAction(supplierId), fetchLookupsAction()]).then(([stored, dictionaries]) => {
      setRules((stored.data || []).map(fromStored))
      setLookups(dictionaries)
    })
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
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div><h2 className="text-lg font-bold text-white">Правила цен · {supplierName}</h2><p className="mt-1 text-xs text-slate-400">Побеждает самое конкретное условие, затем больший приоритет.</p></div>
          <button onClick={onClose} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[1850px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-2">Вкл.</th><th className="p-2">Название</th><th className="p-2">Приоритет</th><th className="p-2">Бренд</th><th className="p-2">Категория</th><th className="p-2">Подкатегория</th><th className="p-2">Модель</th><th className="p-2">Материал</th><th className="p-2">Класс</th><th className="p-2">Ширина, см</th><th className="p-2">Высота, см</th><th className="p-2">Эталоны и подсказка AI</th><th className="p-2">Цена</th><th /></tr></thead>
            <tbody>{rules.map((rule, index) => (
              <tr key={rule.id || index} className="border-t border-slate-800">
                <td className="p-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} /></td>
                <td className="p-2"><input value={rule.name} onChange={(event) => update(index, { name: event.target.value })} className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></td>
                <td className="p-2"><input type="number" value={rule.priority} onChange={(event) => update(index, { priority: Number(event.target.value) })} className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></td>
                <td className="p-2"><Select value={rule.brand} onChange={(value) => update(index, { brand: value })} items={lookups.brands} /></td>
                <td className="p-2"><Select value={rule.category} onChange={(value) => update(index, { category: value, subcategory: '' })} items={lookups.categories} /></td>
                <td className="p-2"><Select value={rule.subcategory} onChange={(value) => update(index, { subcategory: value })} items={lookups.subcategories.filter((item: any) => !rule.category || String(item.category_id || item.category) === rule.category)} /></td>
                <td className="p-2"><input value={rule.model || ''} onChange={(event) => update(index, { model: event.target.value })} placeholder="Chanel 22" className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></td>
                <td className="p-2"><input value={rule.material || ''} onChange={(event) => update(index, { material: event.target.value })} placeholder="кожа" className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></td>
                <td className="p-2"><select value={rule.sizeClass || ''} onChange={(event) => update(index, { sizeClass: event.target.value })} className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5"><option value="">Любая</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></td>
                <td className="p-2"><RangeInputs min={rule.minWidth} max={rule.maxWidth} onChange={(min, max) => update(index, { minWidth: min, maxWidth: max })} /></td>
                <td className="p-2"><RangeInputs min={rule.minHeight} max={rule.maxHeight} onChange={(min, max) => update(index, { minHeight: min, maxHeight: max })} /></td>
                <td className="p-2"><div className="w-72 space-y-2"><textarea value={rule.visualHint || ''} onChange={(event) => update(index, { visualHint: event.target.value })} placeholder="Как отличить эту модель по фото" rows={2} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /><label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={rule.matchByReference} onChange={(event) => update(index, { matchByReference: event.target.checked })} />Точное совпадение с эталоном</label><div className="flex flex-wrap gap-1">{rule.referenceImages.map((url, photoIndex) => <span key={url} className="group/photo relative"><Image src={url} alt="Эталон" width={42} height={42} unoptimized className="h-10 w-10 rounded object-cover" /><button type="button" onClick={() => update(index, { referenceImages: rule.referenceImages.filter((_, itemIndex) => itemIndex !== photoIndex) })} className="absolute -right-1 -top-1 rounded-full bg-red-600 p-0.5 text-white"><X className="h-3 w-3" /></button></span>)}</div><label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">{uploadingRule === index ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}Добавить фото<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={uploadingRule !== null} onChange={(event) => { void uploadReferences(index, event.target.files); event.currentTarget.value = '' }} /></label></div></td>
                <td className="p-2"><input type="number" min="0" value={rule.price} onChange={(event) => update(index, { price: Number(event.target.value) })} className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></td>
                <td className="p-2"><button onClick={() => setRules((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="text-red-400"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}</tbody>
          </table>
          {rules.length === 0 && <p className="py-10 text-center text-slate-500">Правил пока нет. При отсутствии совпадения используется стандартная цена поставщика, затем 0.</p>}
        </div>
        <footer className="flex gap-3 border-t border-slate-700 p-5"><button onClick={add} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"><Plus className="h-4 w-4" /> Добавить правило</button><button onClick={save} disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> Сохранить</button></footer>
      </div>
    </div>
  )
}

function Select({ value, onChange, items }: { value?: string; onChange: (value: string) => void; items: any[] }) {
  return <select value={value || ''} onChange={(event) => onChange(event.target.value)} className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5"><option value="">Любой</option>{items.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select>
}

function RangeInputs({ min, max, onChange }: { min?: number; max?: number; onChange: (min?: number, max?: number) => void }) {
  return <div className="flex w-32 gap-1"><input type="number" min="0" step="0.5" value={min ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value), max)} placeholder="от" className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /><input type="number" min="0" step="0.5" value={max ?? ''} onChange={(event) => onChange(min, event.target.value === '' ? undefined : Number(event.target.value))} placeholder="до" className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1.5" /></div>
}

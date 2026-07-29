'use client'

import { useEffect, useState, useTransition } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { fetchLookupsAction } from '@/actions/csv-import'
import { getSupplierPriceRulesAction, saveSupplierPriceRulesAction } from '@/actions/batch-ai'

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
    model: conditions['attributes.model_name'] || '',
    material: conditions['attributes.materials'] || '',
    sizeClass: conditions['attributes.size_class'] || '',
  }
}

export default function SupplierPriceRulesDialog({ supplierId, supplierName, onClose }: { supplierId: number; supplierName: string; onClose: () => void }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [lookups, setLookups] = useState<any>({ brands: [], categories: [], subcategories: [] })
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    Promise.all([getSupplierPriceRulesAction(supplierId), fetchLookupsAction()]).then(([stored, dictionaries]) => {
      setRules((stored.data || []).map(fromStored))
      setLookups(dictionaries)
    })
  }, [supplierId])

  const update = (index: number, patch: Partial<Rule>) => setRules((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const add = () => setRules((items) => [...items, { name: `Правило ${items.length + 1}`, priority: 0, price: 0, enabled: true }])
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
        'attributes.model_name': rule.model,
        'attributes.materials': rule.material,
        'attributes.size_class': rule.sizeClass,
      }).filter(([, value]) => String(value || '').trim())),
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
          <table className="w-full min-w-[1200px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-2">Вкл.</th><th className="p-2">Название</th><th className="p-2">Приоритет</th><th className="p-2">Бренд</th><th className="p-2">Категория</th><th className="p-2">Подкатегория</th><th className="p-2">Модель</th><th className="p-2">Материал</th><th className="p-2">Размерность</th><th className="p-2">Цена</th><th /></tr></thead>
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

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter, RotateCcw, Search, X } from 'lucide-react'
import type { Category, Subcategory } from '@/lib/types'
import type { RailsChromoffCategory } from '@/lib/rails-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ChromoffSupplierOption {
  id: string
  name: string
}

interface ChromoffSidebarProps {
  categories: Category[]
  subcategories: Subcategory[]
  chromoffCategories: RailsChromoffCategory[]
  suppliers: ChromoffSupplierOption[]
  count: number
  isOpen: boolean
  onClose: () => void
  isNavigationPending?: boolean
}

export default function ChromoffSidebar({
  categories,
  subcategories,
  chromoffCategories,
  suppliers,
  count,
  isOpen,
  onClose,
  isNavigationPending = false,
}: ChromoffSidebarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsKey = searchParams.toString()
  const params = new URLSearchParams(searchParamsKey)
  const [name, setName] = useState(params.get('q') || '')
  const [description, setDescription] = useState(params.get('description') || '')
  const [priceMin, setPriceMin] = useState(params.get('priceMin') || '')
  const [priceMax, setPriceMax] = useState(params.get('priceMax') || '')
  const current = params

  useEffect(() => {
    const next = new URLSearchParams(searchParamsKey)
    setName(next.get('q') || '')
    setDescription(next.get('description') || '')
    setPriceMin(next.get('priceMin') || '')
    setPriceMax(next.get('priceMax') || '')
  }, [searchParamsKey])
  const rootChromoffCategories = chromoffCategories.filter((item) => !item.parent_id)
  const selectedChromoffRoot = current.get('chromoffCategory') || ''
  const chromoffSubcategories = chromoffCategories.filter((item) => item.parent_id === selectedChromoffRoot)
  const active = Boolean([...current.entries()].some(([key]) => key !== 'page'))

  const navigate = (next: URLSearchParams) => {
    next.delete('page')
    router.push(next.toString() ? `/admin/chromoff?${next}` : '/admin/chromoff')
  }

  const setFilter = (key: string, value: string, resetKey?: string) => {
    const next = new URLSearchParams(current)
    if (value) next.set(key, value)
    else next.delete(key)
    if (resetKey) next.delete(resetKey)
    navigate(next)
  }

  const submitTextAndPrice = (event: React.FormEvent) => {
    event.preventDefault()
    const next = new URLSearchParams(current)
    const values: Record<string, string> = { q: name.trim(), description: description.trim(), priceMin: priceMin.trim(), priceMax: priceMax.trim() }
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    navigate(next)
  }

  const reset = () => navigate(new URLSearchParams())

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/70 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onClose} />
      <aside
        role={isOpen ? 'dialog' : 'complementary'}
        aria-modal={isOpen ? true : undefined}
        aria-labelledby="chromoff-filters-title"
        className={`fixed left-0 top-0 z-50 h-[100dvh] w-full max-w-sm overflow-hidden overscroll-contain border-r border-slate-700 bg-slate-800 transition-transform duration-300 lg:sticky lg:h-[100dvh] lg:w-72 ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-full overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="chromoff-filters-title" className="flex items-center gap-2 text-xl font-bold text-slate-100"><Filter className="h-5 w-5 text-violet-300" />Фильтры</h2>
              <div className="mt-1 text-xs text-slate-400"><span className="font-semibold text-slate-200">{count}</span> товаров Chromoff</div>
            </div>
            <div className="flex gap-1">
              {active && <Button type="button" variant="outline" size="icon" onClick={reset} aria-label="Сбросить фильтры" className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600"><RotateCcw className="h-4 w-4" /></Button>}
              <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-11 w-11 text-slate-400 hover:text-slate-200 lg:hidden" aria-label="Закрыть фильтры"><X className="h-6 w-6" /></Button>
            </div>
          </div>

          <form onSubmit={submitTextAndPrice} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="chromoff-name" className="text-slate-300">Название</Label>
              <div className="relative"><Input id="chromoff-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Название или артикул..." className="h-9 bg-slate-700 pl-9 text-sm text-slate-200 placeholder:text-slate-500" /><Search className="absolute left-3 top-2 h-4 w-4 text-slate-500" /></div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="chromoff-description" className="text-slate-300">Описание</Label>
              <Input id="chromoff-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Поиск по описанию..." className="h-9 bg-slate-700 text-sm text-slate-200 placeholder:text-slate-500" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="chromoff-price-min" className="text-xs text-slate-300">Цена от</Label><Input id="chromoff-price-min" type="number" min="0" value={priceMin} onChange={(event) => setPriceMin(event.target.value)} className="h-9 bg-slate-700 text-sm text-slate-200" /></div>
              <div className="space-y-1"><Label htmlFor="chromoff-price-max" className="text-xs text-slate-300">Цена до</Label><Input id="chromoff-price-max" type="number" min="0" value={priceMax} onChange={(event) => setPriceMax(event.target.value)} className="h-9 bg-slate-700 text-sm text-slate-200" /></div>
            </div>
            <Button type="submit" className="h-9 w-full" disabled={isNavigationPending}><Search className="h-4 w-4" />Найти</Button>

            <FilterSelect label="Поставщик" value={current.get('supplier') || ''} onChange={(value) => setFilter('supplier', value)} options={suppliers.map((item) => ({ value: item.id, label: item.name }))} />
            <FilterSelect label="Категория товара" value={current.get('category') || ''} onChange={(value) => setFilter('category', value, 'subcategory')} options={categories.map((item) => ({ value: item.id, label: item.name }))} />
            <FilterSelect label="Подкатегория товара" value={current.get('subcategory') || ''} onChange={(value) => setFilter('subcategory', value)} options={subcategories.filter((item) => !current.get('category') || item.category === current.get('category')).map((item) => ({ value: item.id, label: item.name }))} />
            <FilterSelect label="Пол" value={current.get('gender') || ''} onChange={(value) => setFilter('gender', value)} options={[{ value: 'male', label: 'Для мужчин' }, { value: 'female', label: 'Для женщин' }, { value: 'unisex', label: 'Унисекс' }]} />
            <FilterSelect label="Источник" value={current.get('source') || ''} onChange={(value) => setFilter('source', value)} options={[{ value: 'auto', label: 'Автосинхронизация' }, { value: 'manual', label: 'Ручной товар' }]} />
            <FilterSelect label="AI статус" value={current.get('aiStatus') || ''} onChange={(value) => setFilter('aiStatus', value)} options={[{ value: 'ai_assigned', label: 'AI назначил' }, { value: 'mapped', label: 'Сопоставлено' }, { value: 'needs_review', label: 'Нужна проверка' }, { value: 'manual', label: 'Назначено вручную' }]} />
            <FilterSelect label="Публикация Chromoff" value={current.get('published') || ''} onChange={(value) => setFilter('published', value)} options={[{ value: 'published', label: 'Опубликованные' }, { value: 'hidden', label: 'Скрытые' }]} />
            <FilterSelect label="Раздел Chromoff" value={selectedChromoffRoot} onChange={(value) => setFilter('chromoffCategory', value, 'chromoffSubcategory')} options={rootChromoffCategories.map((item) => ({ value: item.id, label: item.name }))} />
            <FilterSelect label="Подраздел Chromoff" value={current.get('chromoffSubcategory') || ''} onChange={(value) => setFilter('chromoffSubcategory', value)} options={chromoffSubcategories.map((item) => ({ value: item.id, label: item.name }))} />
          </form>
        </div>
      </aside>
    </>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-300">{label}</Label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-slate-600 bg-slate-700 px-2.5 text-xs text-slate-200 outline-none focus:border-violet-400">
        <option value="">Все</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

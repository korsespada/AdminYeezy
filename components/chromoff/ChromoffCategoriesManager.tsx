'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowLeft, Check, FolderTree, Save } from 'lucide-react'
import { updateChromoffCategoryAction } from '@/actions/chromoff'
import type { RailsChromoffCategory } from '@/lib/rails-admin'
import type { Category, Subcategory } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ChromoffCategoriesManagerProps = {
  categories: RailsChromoffCategory[]
  catalogCategories: Category[]
  catalogSubcategories: Subcategory[]
}

export default function ChromoffCategoriesManager({
  categories,
  catalogCategories,
  catalogSubcategories,
}: ChromoffCategoriesManagerProps) {
  const [isPending, startTransition] = useTransition()
  const [messages, setMessages] = useState<Record<string, string>>({})
  const roots = categories.filter((category) => !category.parent_id)

  const save = (formData: FormData) => {
    const id = String(formData.get('id') || '')
    startTransition(async () => {
      const result = await updateChromoffCategoryAction(formData)
      setMessages((current) => ({ ...current, [id]: result.message }))
    })
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-5 text-slate-200 sm:p-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><FolderTree className="h-6 w-6 text-violet-300" /><h1 className="text-2xl font-bold text-slate-100">Разделы Chromoff</h1></div>
            <p className="mt-1 text-sm text-slate-400">Подразделы здесь определяют, где товар появится на витрине после публикации.</p>
          </div>
          <Button asChild variant="outline" className="border-slate-700 bg-slate-800 text-slate-200"><Link href="/admin/chromoff"><ArrowLeft className="h-4 w-4" />К каталогу</Link></Button>
        </header>

        {roots.length ? <div className="space-y-5">
          {roots.map((root) => (
            <section key={root.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/70">
              <div className="border-b border-slate-700 bg-slate-800 px-4 py-3 sm:px-5"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-100">{root.name}</h2><Badge variant="outline" className={root.active ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-600 text-slate-400'}>{root.active ? 'Активен' : 'Скрыт'}</Badge><span className="text-xs text-slate-500">{categories.filter((category) => category.parent_id === root.id).length} подразделов</span></div></div>
              <div className="divide-y divide-slate-700">
                <CategoryEditor category={root} catalogCategories={catalogCategories} catalogSubcategories={catalogSubcategories} message={messages[root.id]} isPending={isPending} onSave={save} />
                {categories.filter((category) => category.parent_id === root.id).map((child) => <CategoryEditor key={child.id} category={child} catalogCategories={catalogCategories} catalogSubcategories={catalogSubcategories} message={messages[child.id]} isPending={isPending} onSave={save} nested />)}
              </div>
            </section>
          ))}
        </div> : <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center text-slate-400">Разделов Chromoff пока нет.</div>}
      </div>
    </main>
  )
}

function CategoryEditor({
  category,
  catalogCategories,
  catalogSubcategories,
  message,
  isPending,
  onSave,
  nested = false,
}: {
  category: RailsChromoffCategory
  catalogCategories: Category[]
  catalogSubcategories: Subcategory[]
  message?: string
  isPending: boolean
  onSave: (formData: FormData) => void
  nested?: boolean
}) {
  return (
    <form action={onSave} className={`grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(11rem,1.25fr)_minmax(10rem,1fr)_minmax(14rem,1.25fr)_6rem_auto] lg:items-end ${nested ? 'bg-slate-900/20' : ''}`}>
      <input type="hidden" name="id" value={category.id} />
      <div className="space-y-1"><Label htmlFor={`name-${category.id}`} className="text-xs text-slate-400">{nested ? 'Подраздел' : 'Раздел'}</Label><Input id={`name-${category.id}`} name="name" defaultValue={category.name} required className="h-10 bg-slate-700 text-slate-100" /></div>
      <div className="space-y-1"><Label htmlFor={`slug-${category.id}`} className="text-xs text-slate-400">Slug</Label><Input id={`slug-${category.id}`} name="slug" defaultValue={category.slug} required className="h-10 bg-slate-700 text-slate-100" /></div>
      <div className="space-y-1"><Label htmlFor={`catalog-category-${category.id}`} className="text-xs text-slate-400">Категория общего каталога</Label><select id={`catalog-category-${category.id}`} name="catalog_category_id" defaultValue={category.catalog_category?.id || ''} className="h-10 w-full rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-slate-100 outline-none focus:border-violet-400"><option value="">Не сопоставлена</option><optgroup label="Категории">{catalogCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup><optgroup label="Подкатегории">{catalogSubcategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup></select></div>
      <div className="space-y-1"><Label htmlFor={`order-${category.id}`} className="text-xs text-slate-400">Порядок</Label><Input id={`order-${category.id}`} name="sort_order" type="number" step="1" defaultValue={category.sort_order} required className="h-10 bg-slate-700 text-slate-100" /></div>
      <div className="flex flex-wrap items-center gap-3"><label className="flex h-10 items-center gap-2 text-sm text-slate-300"><input name="active" type="checkbox" value="true" defaultChecked={category.active} className="h-4 w-4 accent-violet-500" />Активен</label><input type="hidden" name="active" value="false" /><Button type="submit" disabled={isPending} className="h-10">{isPending ? 'Сохраняю…' : <><Save className="h-4 w-4" />Сохранить</>}</Button></div>
      <div className="sm:col-span-2 lg:col-span-5 flex flex-wrap items-center gap-2 text-xs"><code className="rounded bg-slate-900 px-2 py-1 text-slate-400">source: {category.source_id}</code>{message && <span className={message.includes('сохран') ? 'text-emerald-300' : 'text-amber-300'}><Check className="mr-1 inline h-3.5 w-3.5" />{message}</span>}</div>
    </form>
  )
}

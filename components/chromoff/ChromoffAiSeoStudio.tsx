'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckSquare, Images, ListChecks, Play, RotateCcw, Settings2, Square, WandSparkles } from 'lucide-react'
import {
  getChromoffAiDashboardAction,
  retryChromoffAiRunAction,
  startChromoffAiRunAction,
  updateChromoffAiSettingsAction,
} from '@/actions/chromoff-ai'
import type { ChromoffAiCategoryRule, ChromoffAiSettings } from '@/lib/chromoff-ai'
import type { AiProviderRecord } from '@/lib/ai-providers'
import type { RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Run = {
  id: string
  status: 'running' | 'completed' | 'failed'
  total_count: number
  completed_count: number
  failed_count: number
  error_message?: string | null
  created_at: string
  completed_at?: string | null
}

type RunItem = {
  listing_id: string
  run_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  error_message?: string | null
  updated_at: string
}

type SettingsData = ChromoffAiSettings & {
  providers: AiProviderRecord[]
  byesuModels: Array<{ value: string; label: string; group?: string }>
}

interface Props {
  categories: RailsChromoffCategory[]
  listings: RailsChromoffListing[]
  totalItems: number
  totalPages: number
  page: number
  perPage: number
  settings: SettingsData
  dashboard: { runs: Run[]; items: RunItem[] }
}

const statusLabels: Record<string, string> = {
  pending: 'В очереди',
  running: 'Обрабатывается',
  completed: 'Готово',
  failed: 'Ошибка',
}

function categoryLabel(category: RailsChromoffCategory, categories: RailsChromoffCategory[]) {
  const parent = categories.find((item) => item.id === category.parent_id)
  return parent ? `${parent.name} / ${category.name}` : category.name
}

function formatPrice(value: number) {
  if (!value) return 'Цена по запросу'
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value / 100))} ₽`
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function pageUrl(searchParams: URLSearchParams, page: number) {
  const next = new URLSearchParams(searchParams)
  if (page > 1) next.set('page', String(page))
  else next.delete('page')
  return `/admin/chromoff/ai-seo${next.size ? `?${next}` : ''}`
}

export default function ChromoffAiSeoStudio({ categories, listings, totalItems, totalPages, page, perPage, settings: initialSettings, dashboard }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'products' | 'queue' | 'settings'>('products')
  const [selected, setSelected] = useState<string[]>([])
  const { providers, byesuModels, ...editableSettings } = initialSettings
  const [settings, setSettings] = useState<ChromoffAiSettings>(editableSettings)
  const [dashboardState, setDashboardState] = useState(dashboard)
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const roots = useMemo(() => categories.filter((item) => !item.parent_id && item.active), [categories])
  const selectedRoot = searchParams.get('category') || ''
  const children = useMemo(() => categories.filter((item) => item.parent_id === selectedRoot && item.active), [categories, selectedRoot])
  const itemByListing = useMemo(() => new Map(dashboardState.items.map((item) => [item.listing_id, item])), [dashboardState.items])
  const hasActiveRuns = dashboardState.runs.some((run) => run.status === 'running')

  useEffect(() => {
    if (!hasActiveRuns) return
    const timer = window.setInterval(async () => {
      const result = await getChromoffAiDashboardAction(listings.map((listing) => listing.id))
      if (result.success) setDashboardState(result.data)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [hasActiveRuns, listings])

  useEffect(() => setSelected([]), [listings])
  useEffect(() => setDashboardState(dashboard), [dashboard])

  const startRun = () => {
    if (!selected.length || !window.confirm(`Обработать ${selected.length} товаров через AI?`)) return
    startTransition(async () => {
      const result = await startChromoffAiRunAction(selected)
      setMessage(result.success ? 'Запуск создан. Статусы обновляются автоматически.' : result.error || 'Не удалось создать запуск')
      if (result.success) {
        setSelected([])
        setTab('queue')
        router.refresh()
      }
    })
  }

  const saveSettings = () => startTransition(async () => {
    const result = await updateChromoffAiSettingsAction(settings)
    setMessage(result.success ? 'Настройки сохранены.' : result.error || 'Не удалось сохранить настройки')
    if (result.success) router.refresh()
  })

  const addRule = () => {
    const category = categories.find((item) => item.active)
    if (!category) return
    const rule: ChromoffAiCategoryRule = {
      id: crypto.randomUUID(),
      categoryId: category.id,
      title: categoryLabel(category, categories),
      prompt: '',
    }
    setSettings((current) => ({ ...current, categoryRules: [...current.categoryRules, rule] }))
  }

  const updateRule = (id: string, updates: Partial<ChromoffAiCategoryRule>) => {
    setSettings((current) => ({
      ...current,
      categoryRules: current.categoryRules.map((rule) => rule.id === id ? { ...rule, ...updates } : rule),
    }))
  }

  const providerValue = settings.providerId ? `saved:${settings.providerId}` : `builtin:${settings.provider}`

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:p-7">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <Link href="/admin/chromoff" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Каталог Chromoff</Link>
            <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-400/10 p-2.5 text-emerald-300"><WandSparkles className="h-6 w-6" /></div><div><h1 className="text-2xl font-bold">AI SEO Chromoff</h1><p className="mt-1 text-sm text-slate-400">Готовые товары, vision 3×3, отдельные H1 и SEO-описания</p></div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {([['products', 'Товары', Images], ['queue', 'Очередь', ListChecks], ['settings', 'Настройки', Settings2]] as const).map(([value, label, Icon]) => (
              <Button key={value} type="button" variant={tab === value ? 'default' : 'outline'} onClick={() => setTab(value)} className={tab === value ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-slate-700 bg-slate-900'}><Icon className="h-4 w-4" />{label}</Button>
            ))}
          </div>
        </header>

        {message && <div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" role="status">{message}</div>}

        {tab === 'products' && <section>
          <form className="mb-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-5">
            <Input name="q" defaultValue={searchParams.get('q') || ''} placeholder="Название, артикул…" className="border-slate-700 bg-slate-950" />
            <select name="category" defaultValue={selectedRoot} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm" onChange={(event) => { const form = event.currentTarget.form; const subcategory = form?.elements.namedItem('subcategory') as HTMLSelectElement | null; if (subcategory) subcategory.value = ''; if (form) form.requestSubmit() }}><option value="">Все категории</option>{roots.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select name="subcategory" defaultValue={searchParams.get('subcategory') || ''} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm" disabled={!selectedRoot}><option value="">Все подкатегории</option>{children.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select name="perPage" defaultValue={String(perPage)} className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"><option value="40">40 товаров</option><option value="100">100 товаров</option><option value="500">500 товаров</option></select>
            <Button type="submit" variant="outline" className="border-slate-700">Применить фильтры</Button>
          </form>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <button type="button" onClick={() => setSelected(selected.length === listings.length ? [] : listings.map((item) => item.id))} className="flex items-center gap-2 text-sm text-slate-300">{selected.length === listings.length && listings.length ? <CheckSquare className="h-5 w-5 text-emerald-400" /> : <Square className="h-5 w-5" />}Выбрать все на странице</button>
            <div className="text-sm text-slate-400">{totalItems.toLocaleString('ru-RU')} товаров · страница {page} из {Math.max(1, totalPages)}</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {listings.map((listing) => {
              const checked = selected.includes(listing.id)
              const runItem = itemByListing.get(listing.id)
              return <button key={listing.id} type="button" onClick={() => setSelected((current) => checked ? current.filter((id) => id !== listing.id) : [...current, listing.id])} className={`flex min-h-32 gap-3 rounded-xl border p-3 text-left transition ${checked ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
                <div className="h-28 w-24 shrink-0 rounded-lg bg-slate-800 bg-cover bg-center" style={listing.image_url ? { backgroundImage: `url(${JSON.stringify(listing.image_url).slice(1, -1)})` } : undefined} />
                <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="line-clamp-2 font-medium">{listing.brand?.name ? `${listing.brand.name} ` : ''}{listing.name}</h2>{checked ? <CheckSquare className="h-5 w-5 shrink-0 text-emerald-400" /> : <Square className="h-5 w-5 shrink-0 text-slate-600" />}</div><p className="mt-2 text-xs text-slate-400">{listing.chromoff_category?.name || 'Без категории'} · {formatPrice(listing.price_cents)}</p><div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="outline" className={listing.h1 && listing.seo_description ? 'border-emerald-600/40 text-emerald-300' : 'border-amber-600/40 text-amber-300'}>{listing.h1 && listing.seo_description ? 'SEO заполнено' : 'Нужно SEO'}</Badge>{runItem && <Badge variant="outline" title={runItem.error_message || ''}>{statusLabels[runItem.status]}</Badge>}</div></div>
              </button>
            })}
          </div>

          {!listings.length && <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center text-slate-400"><RotateCcw className="mx-auto mb-3 h-7 w-7" />Товары не найдены</div>}

          {totalPages > 1 && <nav className="mt-6 flex justify-center gap-2"><Button asChild variant="outline" className={page <= 1 ? 'pointer-events-none opacity-50' : ''}><a href={pageUrl(searchParams, Math.max(1, page - 1))}>Назад</a></Button><Button asChild variant="outline" className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}><a href={pageUrl(searchParams, Math.min(totalPages, page + 1))}>Вперёд</a></Button></nav>}

          <div className={`fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 p-4 backdrop-blur transition-transform ${selected.length ? 'translate-y-0' : 'translate-y-full'}`}><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4"><span className="text-sm"><strong className="text-emerald-300">{selected.length}</strong> выбрано</span><Button type="button" onClick={startRun} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500"><Play className="h-4 w-4" />{isPending ? 'Запускаем…' : 'Обработать AI'}</Button></div></div>
        </section>}

        {tab === 'queue' && <section className="space-y-3">
          {!dashboardState.runs.length && <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center text-slate-400">Запусков пока нет.</div>}
          {dashboardState.runs.map((run) => {
            const finished = Number(run.completed_count) + Number(run.failed_count)
            const percent = run.total_count ? Math.round(finished / run.total_count * 100) : 0
            return <article key={run.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Badge className={run.status === 'completed' ? 'bg-emerald-600/20 text-emerald-300' : run.status === 'failed' ? 'bg-red-600/20 text-red-300' : 'bg-blue-600/20 text-blue-300'}>{statusLabels[run.status] || run.status}</Badge><span className="font-mono text-xs text-slate-500">{run.id.slice(0, 8)}</span></div><p className="mt-2 text-sm text-slate-400">Создан {formatDate(run.created_at)} · {run.completed_count} готово · {run.failed_count} ошибок из {run.total_count}</p></div>{run.status !== 'completed' && <Button type="button" variant="outline" disabled={isPending} onClick={() => startTransition(async () => { const result = await retryChromoffAiRunAction(run.id); setMessage(result.success ? 'Незавершённые товары возвращены в работу.' : result.error || 'Не удалось возобновить'); router.refresh() })}>Возобновить</Button>}</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} /></div>{run.error_message && <p className="mt-3 text-sm text-red-300">{run.error_message}</p>}</article>
          })}
        </section>}

        {tab === 'settings' && <section className="space-y-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Модель и выполнение</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-sm text-slate-400">Провайдер<select value={providerValue} onChange={(event) => { const [kind, value] = event.target.value.split(':'); const saved = kind === 'saved' ? providers.find((provider) => provider.id === value) : null; setSettings((current) => ({ ...current, provider: saved?.kind || value as ChromoffAiSettings['provider'], providerId: saved?.id, activeProviderId: saved?.id || null, ...(saved?.kind === 'byesu' && saved.model ? { byesuModel: saved.model } : {}), ...(saved?.kind === 'openrouter' && saved.model ? { openrouterModel: saved.model } : {}) })) }} className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100"><option value="builtin:byesu">BYESU</option><option value="builtin:openrouter">OpenRouter</option><option value="builtin:cockpit">Cockpit</option>{providers.map((provider) => <option key={provider.id} value={`saved:${provider.id}`}>{provider.name} · {provider.kind}</option>)}</select></label>{settings.provider === 'byesu' && <label className="text-sm text-slate-400">Модель<select value={settings.byesuModel} onChange={(event) => setSettings((current) => ({ ...current, byesuModel: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100">{byesuModels.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>}{settings.provider === 'openrouter' && <label className="text-sm text-slate-400">Модель<Input value={settings.openrouterModel} onChange={(event) => setSettings((current) => ({ ...current, openrouterModel: event.target.value }))} className="mt-1 border-slate-700 bg-slate-950" /></label>}<label className="text-sm text-slate-400">Параллельно<Input type="number" min="1" max="10" value={settings.concurrency} onChange={(event) => setSettings((current) => ({ ...current, concurrency: Number(event.target.value) }))} className="mt-1 border-slate-700 bg-slate-950" /></label><label className="text-sm text-slate-400">Max tokens<Input type="number" min="1000" max="20000" value={settings.maxTokens} onChange={(event) => setSettings((current) => ({ ...current, maxTokens: Number(event.target.value) }))} className="mt-1 border-slate-700 bg-slate-950" /></label></div><p className="mt-3 text-xs text-slate-500">По умолчанию: BYESU · Gemini 3.7 Flash · vision contact sheets 3×3.</p></div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Системный промпт</h2><textarea value={settings.systemPrompt} onChange={(event) => setSettings((current) => ({ ...current, systemPrompt: event.target.value }))} rows={14} className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm leading-6 outline-none focus:border-emerald-600" /></div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Промпты по категориям</h2><p className="mt-1 text-sm text-slate-400">Правило родительской категории применяется перед правилом подкатегории.</p></div><Button type="button" variant="outline" onClick={addRule}>Добавить</Button></div><div className="mt-4 space-y-4">{settings.categoryRules.map((rule) => <div key={rule.id} className="rounded-lg border border-slate-700 bg-slate-950 p-4"><div className="flex flex-col gap-3 md:flex-row"><select value={rule.categoryId} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); updateRule(rule.id, { categoryId: event.target.value, title: category ? categoryLabel(category, categories) : rule.title }) }} className="h-10 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm">{categories.filter((item) => item.active).map((category) => <option key={category.id} value={category.id}>{categoryLabel(category, categories)}</option>)}</select><Button type="button" variant="destructive" onClick={() => setSettings((current) => ({ ...current, categoryRules: current.categoryRules.filter((item) => item.id !== rule.id) }))}>Удалить</Button></div><textarea value={rule.prompt} onChange={(event) => updateRule(rule.id, { prompt: event.target.value })} rows={6} placeholder="Дополнительные правила для этой категории…" className="mt-3 w-full rounded-md border border-slate-700 bg-slate-900 p-3 text-sm outline-none focus:border-emerald-600" /></div>)}{!settings.categoryRules.length && <p className="rounded-lg border border-dashed border-slate-700 py-8 text-center text-sm text-slate-500">Категорийных промптов пока нет.</p>}</div></div>

          <div className="flex justify-end"><Button type="button" onClick={saveSettings} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500">{isPending ? 'Сохраняем…' : 'Сохранить настройки'}</Button></div>
        </section>}
      </div>
    </main>
  )
}

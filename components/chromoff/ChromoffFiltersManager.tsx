'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, FolderTree, ListFilter, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { setChromoffListingFilterAction, updateChromoffCategoryFiltersAction } from '@/actions/chromoff'
import {
  CHROMOFF_FILTER_NONE,
  chromoffFilterOverride,
  chromoffFilterSlug,
  matchChromoffFilter,
  parseChromoffFilterKeywords,
  type ChromoffFilterMatch,
  type ChromoffSubcategoryFilter,
} from '@/lib/chromoff-filters'
import type { RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type DraftFilter = { key: string; label: string; slug: string; keywords: string }
type ActionMessage = { text: string; ok: boolean }

const SOURCE_LABELS = { name: 'в названии', model: 'в модели', description: 'в описании' } as const

function toDraft(filters: ChromoffSubcategoryFilter[]): DraftFilter[] {
  return filters.map((filter) => ({ key: filter.slug, label: filter.label, slug: filter.slug, keywords: filter.keywords.join(', ') }))
}

function fromDraft(drafts: DraftFilter[]): ChromoffSubcategoryFilter[] {
  return drafts.map((draft) => ({
    slug: draft.slug.trim().toLowerCase() || chromoffFilterSlug(draft.label),
    label: draft.label.trim(),
    keywords: parseChromoffFilterKeywords(draft.keywords),
  }))
}

export default function ChromoffFiltersManager({
  categories,
  selected,
  listings,
}: {
  categories: RailsChromoffCategory[]
  selected: RailsChromoffCategory | null
  listings: RailsChromoffListing[]
}) {
  const router = useRouter()
  const [isSaving, startSaving] = useTransition()
  const [savedFilters, setSavedFilters] = useState<ChromoffSubcategoryFilter[]>(selected?.filters || [])
  const [drafts, setDrafts] = useState<DraftFilter[]>(() => toDraft(selected?.filters || []))
  const [metadataById, setMetadataById] = useState<Record<string, Record<string, unknown>>>(
    () => Object.fromEntries(listings.map((listing) => [listing.id, listing.metadata || {}])),
  )
  const [message, setMessage] = useState<ActionMessage | null>(null)
  const [pendingListingId, setPendingListingId] = useState<string | null>(null)

  const roots = categories.filter((category) => !category.parent_id)
  const filters = useMemo(() => fromDraft(drafts), [drafts])
  const isDirty = JSON.stringify(filters) !== JSON.stringify(savedFilters)

  // Предпросмотр считается по несохранённым правилам, чтобы было видно, куда
  // уедут товары, ещё до сохранения.
  const matches = useMemo(() => listings.map((listing) => ({
    listing,
    match: matchChromoffFilter({ ...listing, metadata: metadataById[listing.id] }, filters),
  })), [listings, metadataById, filters])

  const groups = filters.map((filter) => ({ filter, items: matches.filter((item) => item.match?.slug === filter.slug) }))
  const unmatched = matches.filter((item) => !item.match)
  const chipsVisible = groups.filter((group) => group.items.length > 0).length >= 2

  const updateDraft = (key: string, patch: Partial<DraftFilter>) => {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch } : draft))
  }

  const moveDraft = (index: number, direction: -1 | 1) => {
    setDrafts((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const addDraft = () => {
    setDrafts((current) => [...current, { key: `new-${Date.now()}`, label: '', slug: '', keywords: '' }])
  }

  const save = () => {
    if (!selected) return
    startSaving(async () => {
      const result = await updateChromoffCategoryFiltersAction(selected.id, filters)
      setMessage({ text: result.message, ok: result.success })
      if (result.success && result.filters) {
        setSavedFilters(result.filters)
        setDrafts(toDraft(result.filters))
      }
    })
  }

  const setOverride = async (listingId: string, value: string) => {
    setPendingListingId(listingId)
    const result = await setChromoffListingFilterAction(listingId, value)
    setPendingListingId(null)
    if (result.success && result.metadata) {
      setMetadataById((current) => ({ ...current, [listingId]: result.metadata }))
    } else {
      setMessage({ text: result.message, ok: false })
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 px-4 py-5 text-slate-200 sm:p-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><ListFilter className="h-6 w-6 text-violet-300" /><h1 className="text-2xl font-bold text-slate-100">Фильтры Chromoff</h1></div>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">Чипы над товарами в подкатегории витрины: «Levi&apos;s / Carhartt» в джинсах, ширина ремня и т. п. Товар попадает в фильтр по первому найденному ключевому слову — сначала в названии, потом в модели и описании. Если слова не справляются, привяжите товар вручную.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="border-slate-700 bg-slate-800 text-slate-200"><Link href="/admin/chromoff/categories"><FolderTree className="h-4 w-4" />Разделы</Link></Button>
            <Button asChild variant="outline" className="border-slate-700 bg-slate-800 text-slate-200"><Link href="/admin/chromoff"><ArrowLeft className="h-4 w-4" />К каталогу</Link></Button>
          </div>
        </header>

        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1 sm:w-96">
            <Label htmlFor="filters-subcategory" className="text-xs text-slate-400">Подраздел</Label>
            <select
              id="filters-subcategory"
              value={selected?.id || ''}
              onChange={(event) => router.push(`/admin/chromoff/filters?category=${event.target.value}`)}
              className="h-10 w-full rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-slate-100 outline-none focus:border-violet-400"
            >
              {roots.map((root) => (
                <optgroup key={root.id} label={root.name}>
                  {categories.filter((category) => category.parent_id === root.id).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}{category.filters?.length ? ` · фильтров: ${category.filters.length}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {selected && <p className="text-sm text-slate-500 sm:pb-2">Опубликованных товаров: {listings.length}</p>}
        </div>

        {!selected ? (
          <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center text-slate-400">Подразделов Chromoff пока нет.</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(22rem,30rem)_1fr] lg:items-start">
            <section className="rounded-xl border border-slate-700 bg-slate-800/70 p-4 lg:sticky lg:top-4">
              <h2 className="mb-1 font-semibold text-slate-100">Правила</h2>
              <p className="mb-4 text-xs text-slate-400">Порядок здесь — порядок чипов на сайте. Ключевые слова — через запятую, регистр и «ё» не важны: «levi» найдёт и «Levi&apos;s 501».</p>

              <div className="space-y-3">
                {drafts.map((draft, index) => {
                  const count = groups[index]?.items.length ?? 0
                  return (
                    <div key={draft.key} className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-slate-600 text-slate-300">{count} тов.</Badge>
                        <div className="ml-auto flex gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-400" disabled={index === 0} onClick={() => moveDraft(index, -1)} aria-label="Выше"><ArrowUp className="h-4 w-4" /></Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-400" disabled={index === drafts.length - 1} onClick={() => moveDraft(index, 1)} aria-label="Ниже"><ArrowDown className="h-4 w-4" /></Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-rose-300 hover:text-rose-200" onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))} aria-label="Удалить фильтр"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-[1fr_9rem] gap-2">
                        <div className="space-y-1"><Label htmlFor={`label-${draft.key}`} className="text-xs text-slate-400">Название чипа</Label><Input id={`label-${draft.key}`} value={draft.label} onChange={(event) => updateDraft(draft.key, { label: event.target.value })} placeholder="Например, Levi's" className="h-9 bg-slate-700 text-slate-100" /></div>
                        <div className="space-y-1"><Label htmlFor={`slug-${draft.key}`} className="text-xs text-slate-400">Slug в адресе</Label><Input id={`slug-${draft.key}`} value={draft.slug} onChange={(event) => updateDraft(draft.key, { slug: event.target.value })} placeholder={chromoffFilterSlug(draft.label) || 'авто'} className="h-9 bg-slate-700 text-slate-100" /></div>
                      </div>
                      <div className="space-y-1"><Label htmlFor={`keywords-${draft.key}`} className="text-xs text-slate-400">Ключевые слова</Label><Textarea id={`keywords-${draft.key}`} value={draft.keywords} onChange={(event) => updateDraft(draft.key, { keywords: event.target.value })} placeholder="levi, 501, 517" rows={2} className="min-h-0 border-slate-600 bg-slate-700 text-slate-100" /></div>
                    </div>
                  )
                })}
              </div>

              <Button type="button" variant="outline" className="mt-3 w-full border-dashed border-slate-600 bg-transparent text-violet-300" onClick={addDraft}><Plus className="h-4 w-4" />Добавить фильтр</Button>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-700 pt-4">
                <Button type="button" onClick={save} disabled={isSaving || !isDirty}>{isSaving ? 'Сохраняю…' : <><Save className="h-4 w-4" />Сохранить</>}</Button>
                {isDirty && <Button type="button" variant="ghost" className="text-slate-400" onClick={() => setDrafts(toDraft(savedFilters))}><RotateCcw className="h-4 w-4" />Отменить</Button>}
                {message && <span className={`text-xs ${message.ok ? 'text-emerald-300' : 'text-amber-300'}`}><Check className="mr-1 inline h-3.5 w-3.5" />{message.text}</span>}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {chipsVisible
                  ? 'Чипы будут видны на сайте.'
                  : 'Чипы не появятся на сайте: нужно хотя бы два фильтра, в каждом из которых есть товары.'}
              </p>
            </section>

            <section className="space-y-4">
              {groups.map(({ filter, items }) => (
                <PreviewGroup key={filter.slug} title={filter.label || 'Без названия'} items={items} savedFilters={savedFilters} metadataById={metadataById} pendingListingId={pendingListingId} onOverride={setOverride} />
              ))}
              <PreviewGroup title="Не попали в фильтры — видны только во «Все»" muted items={unmatched} savedFilters={savedFilters} metadataById={metadataById} pendingListingId={pendingListingId} onOverride={setOverride} />
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

function PreviewGroup({
  title,
  items,
  savedFilters,
  metadataById,
  pendingListingId,
  onOverride,
  muted = false,
}: {
  title: string
  items: Array<{ listing: RailsChromoffListing; match: ChromoffFilterMatch | null }>
  savedFilters: ChromoffSubcategoryFilter[]
  metadataById: Record<string, Record<string, unknown>>
  pendingListingId: string | null
  onOverride: (listingId: string, value: string) => void
  muted?: boolean
}) {
  return (
    <div className={`overflow-hidden rounded-xl border ${muted ? 'border-dashed border-slate-700' : 'border-slate-700 bg-slate-800/70'}`}>
      <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3">
        <h3 className={`font-semibold ${muted ? 'text-slate-400' : 'text-slate-100'}`}>{title}</h3>
        <span className="text-xs text-slate-500">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Нет товаров.</p>
      ) : (
        <div className="grid gap-px bg-slate-700/60 sm:grid-cols-2 2xl:grid-cols-3">
          {items.map(({ listing, match }) => (
            <PreviewRow
              key={listing.id}
              listing={listing}
              match={match}
              override={chromoffFilterOverride({ ...listing, metadata: metadataById[listing.id] })}
              savedFilters={savedFilters}
              isPending={pendingListingId === listing.id}
              onOverride={onOverride}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PreviewRow({
  listing,
  match,
  override,
  savedFilters,
  isPending,
  onOverride,
}: {
  listing: RailsChromoffListing
  match: ChromoffFilterMatch | null
  override: string | null
  savedFilters: ChromoffSubcategoryFilter[]
  isPending: boolean
  onOverride: (listingId: string, value: string) => void
}) {
  const image = listing.image_url || listing.images?.[0]
  const reason = override === CHROMOFF_FILTER_NONE
    ? 'убран из фильтров вручную'
    : match?.reason === 'manual'
      ? 'привязан вручную'
      : match?.reason === 'keyword'
        ? `по слову «${match.keyword}» ${SOURCE_LABELS[match.source]}`
        : 'ни одно слово не подошло'

  return (
    <div className="flex gap-3 bg-slate-900 p-3">
      {image
        // eslint-disable-next-line @next/next/no-img-element -- маленькое превью из CDN каталога, оптимизация не нужна
        ? <img src={image} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
        : <div className="h-16 w-12 shrink-0 rounded bg-slate-800" />}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 text-sm text-slate-100">{listing.name}</p>
        <p className={`text-xs ${match?.reason === 'manual' || override === CHROMOFF_FILTER_NONE ? 'text-violet-300' : 'text-slate-500'}`}>{reason}</p>
        <select
          aria-label={`Фильтр для «${listing.name}»`}
          value={override || ''}
          disabled={isPending || savedFilters.length === 0}
          onChange={(event) => onOverride(listing.id, event.target.value)}
          className="h-8 w-full rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 outline-none focus:border-violet-400 disabled:opacity-50"
        >
          <option value="">Авто — по ключевым словам</option>
          {savedFilters.map((filter) => <option key={filter.slug} value={filter.slug}>Всегда в «{filter.label}»</option>)}
          <option value={CHROMOFF_FILTER_NONE}>Не показывать в фильтрах</option>
        </select>
      </div>
    </div>
  )
}

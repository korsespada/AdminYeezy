'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, WandSparkles, X } from 'lucide-react'
import { getChromoffAiListingAction } from '@/actions/chromoff-ai'
import type { RailsChromoffListing } from '@/lib/rails-admin'
import { Badge } from '@/components/ui/badge'
import ProductPhotoGallery from '@/components/products/ProductPhotoGallery'

type QueueItem = {
  status: 'pending' | 'running' | 'completed' | 'failed'
  error_message?: string | null
}

const queueLabels: Record<QueueItem['status'], string> = {
  pending: 'В очереди',
  running: 'Обрабатывается',
  completed: 'Обработано ИИ',
  failed: 'Ошибка обработки',
}

export function listingPhotos(listing: RailsChromoffListing) {
  const media = Array.isArray(listing.media) && listing.media.length
    ? [...listing.media]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((medium) => medium.original_url || medium.preview_url)
      .filter((url): url is string => Boolean(url))
    : Array.isArray(listing.images) ? listing.images : []
  return media.length ? media : listing.image_url ? [listing.image_url] : []
}

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 whitespace-pre-wrap break-words text-sm text-slate-200 ${mono ? 'font-mono text-xs leading-5' : ''}`}>
        {value?.trim() ? value : <span className="text-slate-600">Не заполнено</span>}
      </div>
    </div>
  )
}

export default function ChromoffAiProductDrawer({
  listing,
  isOpen,
  onClose,
  queueItem,
}: {
  listing: RailsChromoffListing | null
  isOpen: boolean
  onClose: () => void
  queueItem?: QueueItem
}) {
  const [full, setFull] = useState<RailsChromoffListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFull(listing)
    setError(null)
    if (!isOpen || !listing) return
    let cancelled = false
    setLoading(true)
    getChromoffAiListingAction(listing.id).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.success) setFull(result.data)
      else setError(result.error || 'Не удалось загрузить товар')
    })
    return () => { cancelled = true }
  }, [listing, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !listing) return null

  const photos = listingPhotos(full || listing)
  const categoryPath = full?.chromoff_category || listing.chromoff_category
  const priceCents = full?.price_cents ?? listing.price_cents

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden overscroll-contain border-l border-slate-700 bg-slate-900 shadow-2xl lg:max-w-2xl">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2"><WandSparkles className="h-5 w-5 text-emerald-300" /></div>
            <h2 className="break-words text-base font-semibold text-white sm:text-lg">
              {full?.brand?.name || listing.brand?.name ? `${full?.brand?.name || listing.brand?.name} · ` : ''}{full?.name || listing.name}
            </h2>
          </div>
          <div className="flex items-center justify-end gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:text-white" aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4 pb-32 sm:p-6">
          {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{error}</div>}

          {queueItem && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Очередь AI</h3>
              <Badge className={
                queueItem.status === 'completed' ? 'bg-emerald-600/20 text-emerald-300'
                  : queueItem.status === 'failed' ? 'bg-red-600/20 text-red-300'
                    : 'bg-blue-600/20 text-blue-300'
              }>{queueLabels[queueItem.status]}</Badge>
              {queueItem.error_message && <p className="whitespace-pre-wrap break-words rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{queueItem.error_message}</p>}
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Фотографии ({photos.length})</h3>
            <ProductPhotoGallery photos={photos} emptyText="У товара нет фотографий" />
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">SEO Chromoff</h3>
            <Field label="H1" value={full?.h1 ?? listing.h1} />
            <Field label="SEO title" value={full?.seo_title ?? listing.seo_title} />
            <Field label="SEO описание" value={full?.seo_description ?? listing.seo_description} />
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Описание</h3>
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
              {(full?.description || listing.description || '').trim() || <span className="text-slate-600">Пусто</span>}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Категория</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-200">
                {categoryPath ? <span>{categoryPath.name}</span> : <span className="text-slate-600">Без категории</span>}
                {(full?.published ?? listing.published) && <Badge className="bg-emerald-500/15 text-emerald-300">Опубликован</Badge>}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Цена</div>
              <div className="mt-1 text-sm text-slate-200">{priceCents ? `${new Intl.NumberFormat('ru-RU').format(Math.round(priceCents / 100))} ₽` : 'По запросу'}</div>
            </div>
          </section>

          {full?.catalog_attributes && Object.keys(full.catalog_attributes).length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Характеристики</h3>
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {Object.entries(full.catalog_attributes).map(([key, value]) => (
                  <div key={key} className="flex min-w-0 justify-between gap-3 border-b border-slate-800 pb-1 text-sm">
                    <dt className="shrink-0 text-slate-500">{key}</dt>
                    <dd className="truncate text-right text-slate-200">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

        </div>
      </div>
    </>,
    document.body,
  )
}

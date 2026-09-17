'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle2, ImageOff, Loader2, RefreshCw, Search, Sparkles, Upload } from 'lucide-react'
import {
  attachDavidPhotosAction,
  createDavidChromoffProductAction,
  generateDavidDraftAction,
  searchChromoffProductsAction,
  startDavidPhotoCleaningAction,
} from '@/actions/david-studio'

type Photo = {
  id: string
  sourcePosition: number | null
  status: string
  cleanStatus: string | null
  s3CleanUrl: string | null
  s3BeforeUrl: string | null
  s3AfterUrl: string | null
  error: string | null
}

type Draft = {
  status: string
  ai_output: any
  price_rub: number | null
  rails_product_id: string | null
  chromoff_listing_id: string | null
} | null

type Option = { id: string; name: string; parent_id?: string | null }

const VERDICT_LABEL: Record<string, string> = {
  ok: 'вотермарка убрана',
  review: 'на глаза',
  miss: 'не найдена',
}

export default function DavidImportPanel({
  handle,
  title,
  sourceUrl,
  priceLabel,
  photos,
  draft,
  categories,
  chromoffCategories,
}: {
  handle: string
  title: string
  sourceUrl: string
  priceLabel: string
  photos: Photo[]
  draft: Draft
  categories: Option[]
  chromoffCategories: Option[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tab, setTab] = useState<'new' | 'existing'>('new')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const ai = draft?.ai_output || {}
  const [name, setName] = useState<string>(ai.name || title)
  const [description, setDescription] = useState<string>(ai.description || '')
  const [categoryId, setCategoryId] = useState<string>(ai.category || '')
  const [chromoffCategoryId, setChromoffCategoryId] = useState<string>(ai.chromoffCategory?.id || '')
  const [gender, setGender] = useState<string>(ai.gender || '')
  const [priceRub, setPriceRub] = useState<string>(draft?.price_rub ? String(draft.price_rub) : '')
  const [publish, setPublish] = useState(true)
  const [alts, setAlts] = useState<string[]>(Array.isArray(ai.photoAlts) ? ai.photoAlts : [])

  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Array<{ id: string; name: string; photos: number; category: string; price: number }>>([])
  const [targetId, setTargetId] = useState<string>('')

  const counts = useMemo(() => {
    const result: Record<string, number> = { pending: 0, claimed: 0, done: 0, failed: 0 }
    for (const photo of photos) result[photo.status] = (result[photo.status] || 0) + 1
    return result
  }, [photos])

  const busy = counts.pending > 0 || counts.claimed > 0
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(timer)
  }, [busy, router])

  const readyPhotos = photos.filter((photo) => photo.status === 'done' && photo.s3CleanUrl)

  function run(action: () => Promise<{ success: boolean; error?: string; data?: unknown }>, okText: string) {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      if (!result.success) setMessage({ kind: 'error', text: result.error || 'Не получилось' })
      else {
        setMessage({ kind: 'ok', text: okText })
        router.refresh()
      }
    })
  }

  function onAltChange(index: number, value: string) {
    setAlts((current) => {
      const next = [...current]
      next[index] = value
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-100">{title}</h1>
            <p className="mt-1 text-xs text-slate-400">
              {handle} · цена David: <span className="text-slate-200">{priceLabel || '—'}</span> ·{' '}
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
                карточка поставщика
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(() => startDavidPhotoCleaningAction(handle), 'Фото поставлены в очередь')}
              disabled={pending}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Очистить фото ({photos.length})
            </button>
            <button
              type="button"
              onClick={() => run(() => generateDavidDraftAction(handle, tab === 'existing' ? targetId || null : null), 'Черновик ИИ готов')}
              disabled={pending || !readyPhotos.length}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Сделать черновик ИИ
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
          <span>в очереди: <b className="text-slate-100">{counts.pending}</b></span>
          <span>чистится: <b className="text-slate-100">{counts.claimed}</b></span>
          <span>готово: <b className="text-emerald-300">{counts.done}</b></span>
          <span>ошибок: <b className="text-rose-300">{counts.failed}</b></span>
          {busy && <span className="text-amber-300">локальный воркер чистит фото — страница обновляется сама</span>}
        </div>

        {message && (
          <p className={`mt-3 text-sm ${message.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>
        )}

        {readyPhotos.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {readyPhotos.map((photo) => (
              <div key={photo.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>кадр {photo.sourcePosition ?? '—'}</span>
                  <span className={photo.cleanStatus === 'ok' ? 'text-emerald-300' : photo.cleanStatus === 'miss' ? 'text-slate-400' : 'text-amber-300'}>
                    {photo.cleanStatus ? VERDICT_LABEL[photo.cleanStatus] || photo.cleanStatus : ''}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  <figure>
                    <figcaption className="text-[11px] text-slate-500">до</figcaption>
                    {photo.s3BeforeUrl ? (
                      <Image src={photo.s3BeforeUrl} alt="до" width={420} height={140} unoptimized className="w-full rounded" />
                    ) : (
                      <div className="flex h-16 items-center justify-center text-slate-600"><ImageOff className="h-5 w-5" /></div>
                    )}
                  </figure>
                  <figure>
                    <figcaption className="text-[11px] text-slate-500">после</figcaption>
                    {photo.s3AfterUrl ? (
                      <Image src={photo.s3AfterUrl} alt="после" width={420} height={140} unoptimized className="w-full rounded" />
                    ) : (
                      <div className="flex h-16 items-center justify-center text-slate-600"><ImageOff className="h-5 w-5" /></div>
                    )}
                  </figure>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('new')}
          className={`h-10 rounded-md px-4 text-sm ${tab === 'new' ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 bg-slate-800 text-slate-200'}`}
        >
          Новый товар в Chromoff
        </button>
        <button
          type="button"
          onClick={() => setTab('existing')}
          className={`h-10 rounded-md px-4 text-sm ${tab === 'existing' ? 'bg-slate-100 text-slate-900' : 'border border-slate-600 bg-slate-800 text-slate-200'}`}
        >
          К существующему товару
        </button>
      </div>

      {tab === 'new' ? (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/60 p-5">
          {draft?.rails_product_id ? (
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Товар уже создан: product {draft.rails_product_id}, листинг {draft.chromoff_listing_id}
            </p>
          ) : null}

          <label className="block text-sm text-slate-300">
            Название
            <input value={name} onChange={(event) => setName(event.target.value)}
                   className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100" />
          </label>

          <label className="block text-sm text-slate-300">
            Описание
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={8}
                      className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100" />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm text-slate-300">
              Категория каталога
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100">
                <option value="">— выберите —</option>
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Категория Chromoff
              <select value={chromoffCategoryId} onChange={(event) => setChromoffCategoryId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100">
                <option value="">— выберите —</option>
                {chromoffCategories.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Пол
              <select value={gender} onChange={(event) => setGender(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100">
                <option value="">не указан</option>
                <option value="male">мужской</option>
                <option value="female">женский</option>
                <option value="unisex">унисекс</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="text-sm text-slate-300">
              Цена David (USD)
              <div className="mt-1 flex h-10 items-center rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200">
                {priceLabel || '—'}
              </div>
            </div>
            <label className="block text-sm text-slate-300">
              Цена в рублях
              <input value={priceRub} onChange={(event) => setPriceRub(event.target.value.replace(/[^\d]/g, ''))}
                     inputMode="numeric" placeholder="например 45000"
                     className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100" />
            </label>
            <label className="flex items-center gap-2 self-end text-sm text-slate-300">
              <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
              публиковать в Chromoff
            </label>
          </div>

          {alts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Альты фотографий</p>
              {alts.map((alt, index) => (
                <input key={index} value={alt} onChange={(event) => onAltChange(index, event.target.value)}
                       className="h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100" />
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !name || !priceRub || !categoryId || !chromoffCategoryId}
              onClick={() => run(() => createDavidChromoffProductAction({
                handle,
                name,
                description,
                priceRub: Number(priceRub),
                categoryId,
                chromoffCategoryId,
                gender: gender || null,
                attributes: ai.attributes || {},
                photoAlts: alts,
                seoDescription: ai.seoDescription || '',
                published: publish,
              }), 'Товар создан в Chromoff')}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Создать товар только для Chromoff
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/60 p-5">
          <div className="flex gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск товара Chromoff по названию"
                   className="h-10 flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100" />
            <button
              type="button"
              disabled={pending || !query.trim()}
              onClick={() => run(async () => {
                const result = await searchChromoffProductsAction(query)
                if (result.success) setFound(result.data)
                return result as any
              }, 'Найдено')}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-600 bg-slate-700 px-4 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            >
              <Search className="h-4 w-4" /> Найти
            </button>
          </div>

          {found.length > 0 && (
            <div className="divide-y divide-slate-700 overflow-hidden rounded-lg border border-slate-700">
              {found.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 bg-slate-900/60 px-3 py-2 text-sm">
                  <span className="flex items-center gap-3">
                    <input type="radio" name="target" checked={targetId === item.id} onChange={() => setTargetId(item.id)} />
                    <span className="text-slate-100">{item.name}</span>
                  </span>
                  <span className="text-xs text-slate-400">{item.category} · фото {item.photos} · {item.price} ₽</span>
                </label>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={pending || !targetId || !readyPhotos.length}
            onClick={() => run(() => attachDavidPhotosAction({ handle, productId: targetId, photoAlts: alts }),
                               'Фото добавлены к товару')}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Добавить очищенные фото ({readyPhotos.length})
          </button>
          <p className="text-xs text-slate-400">
            Название, описание и цена существующего товара не меняются. Фото, которые уже есть у товара, пропускаются.
          </p>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, Eye, ImageOff, Loader2, RefreshCw, RotateCcw, Search, Sparkles, Trash2, Upload } from 'lucide-react'
import {
  attachDavidPhotosAction,
  createDavidChromoffProductAction,
  excludeDavidPhotoAction,
  generateDavidDraftAction,
  requeueDavidProblemPhotosAction,
  restoreDavidPhotoAction,
  searchChromoffProductsAction,
  startDavidPhotoCleaningAction,
} from '@/actions/david-studio'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MeasurementTable } from '@/lib/measurement-templates'

type Photo = {
  id: string
  sourceKey: string
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
  error: string | null
  rails_product_id: string | null
  chromoff_listing_id: string | null
} | null

type Option = { id: string; name: string; parent_id?: string | null }
type FoundProduct = { id: string; name: string; photos: number; category: string; price: number; externalId: string; attributes: Record<string, unknown> }

const VERDICT_LABEL: Record<string, string> = {
  ok: 'вотермарка убрана',
  review: 'на глаза',
  miss: 'не найдена',
}

const DRAFT_LABEL: Record<string, string> = {
  draft: 'не запускался',
  ai_ready: 'готов',
  ai_error: 'ошибка',
  created: 'товар создан',
}

const HIDDEN_ATTRIBUTE_CODES = new Set([
  'chromoff_category_id',
  'chromoff_category_name',
  'chromoff_category_confidence',
  'chromoff_category_status',
  'chromoff_category_reason',
])

/** Характеристики для ревью: служебные ключи Chromoff не показываем. */
function reviewableAttributes(attributes: Record<string, unknown> | null | undefined) {
  return Object.entries(attributes || {})
    .filter(([code]) => !HIDDEN_ATTRIBUTE_CODES.has(code) && code !== 'sizes' && code !== 'measurements')
    .map(([code, value]) => ({
      code,
      value: Array.isArray(value) ? value.join(', ') : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
    }))
    .filter((item) => item.value)
}

function measurementRows(table: MeasurementTable | null | undefined) {
  if (!table?.rows?.length) return []
  return table.rows.map((row) => ({
    size: row.size,
    fit: Object.values(row.values || {}).filter(Boolean).join(', '),
  }))
}

export default function DavidImportPanel({
  handle,
  title,
  sourceUrl,
  priceLabel,
  photos,
  draft,
  variantSizes,
  variantMeasurements,
  variantNotSizes,
  categories,
  chromoffCategories,
  excluded = [],
}: {
  handle: string
  title: string
  sourceUrl: string
  priceLabel: string
  photos: Photo[]
  draft: Draft
  variantSizes: string[]
  variantMeasurements: MeasurementTable | null
  variantNotSizes: string[]
  categories: Option[]
  chromoffCategories: Option[]
  /** Кадры, убранные из импорта вручную (ключ источника). */
  excluded?: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tab, setTab] = useState<'new' | 'existing'>('new')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [viewer, setViewer] = useState<Photo | null>(null)
  const [viewOriginal, setViewOriginal] = useState(false)

  const ai = draft?.ai_output || {}
  const [name, setName] = useState<string>(ai.name || title)
  const [description, setDescription] = useState<string>(ai.description || '')
  // ИИ возвращает верхнюю категорию и подкатегорию: в выборе каталога живут
  // подкатегории, поэтому подставляем именно подкатегорию.
  const [categoryId, setCategoryId] = useState<string>(ai.subcategory || ai.category || '')
  const [chromoffCategoryId, setChromoffCategoryId] = useState<string>(ai.chromoffCategory?.id || '')
  const [gender, setGender] = useState<string>(ai.gender || '')
  const [publish, setPublish] = useState(true)
  const [alts, setAlts] = useState<string[]>(Array.isArray(ai.photoAlts) ? ai.photoAlts : [])

  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundProduct[]>([])
  const [targetId, setTargetId] = useState<string>('')
  const [zeroPrice, setZeroPrice] = useState<boolean>(false)
  const [publishTarget, setPublishTarget] = useState<boolean>(false)

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

  const attributes = reviewableAttributes(ai.attributes)
  const measurements = measurementRows(variantMeasurements)
  const targetProduct = found.find((item) => item.id === targetId) || null

  const excludedSet = useMemo(() => new Set(excluded), [excluded])
  const visiblePhotos = photos.filter((photo) => !excludedSet.has(photo.sourceKey))
  const removedPhotos = photos.filter((photo) => excludedSet.has(photo.sourceKey))
  const readyPhotos = visiblePhotos.filter((photo) => photo.status === 'done' && photo.s3CleanUrl)
  // Кадры, которые стоит прогнать заново: детектор не нашёл вотермарку, кадр
  // ушёл на глаза или чистка упала.
  const problemPhotos = visiblePhotos.filter(
    (photo) => photo.status === 'failed' || (photo.status === 'done' && (photo.cleanStatus === 'miss' || photo.cleanStatus === 'review')),
  )

  function run(action: () => Promise<any>, okText: string) {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await action()
        if (!result?.success) setMessage({ kind: 'error', text: result?.error || 'Не получилось' })
        else {
          setMessage({ kind: 'ok', text: typeof result.data?.message === 'string' ? `${okText}: ${result.data.message}` : okText })
          router.refresh()
        }
      } catch (error) {
        // Серверный экшен умеет бросить исключение: без перехвата кнопка просто «ничего не делает».
        setMessage({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Сервер вернул ошибку без описания',
        })
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
              {handle} · цена David: <span className="text-slate-200">{priceLabel || '—'}</span> (USD, справка) ·{' '}
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
              onClick={() => run(
                () => generateDavidDraftAction(handle, tab === 'existing' ? targetId || null : null),
                'Черновик посчитан',
              )}
              disabled={pending || !readyPhotos.length}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {pending ? 'Считаю черновик…' : 'Сделать черновик ИИ'}
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

        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">Черновик ИИ:</span>
            <b className={draft?.status === 'created' ? 'text-emerald-300' : draft?.status === 'ai_error' ? 'text-rose-300' : 'text-slate-100'}>
              {DRAFT_LABEL[draft?.status || 'draft'] || draft?.status}
            </b>
            <span className="text-slate-500">модель из «Выгрузок» → «Настройки ИИ»</span>
          </div>
          {draft?.error && (
            <p className="mt-2 flex items-start gap-2 text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{draft.error}</span>
            </p>
          )}
          {draft?.status === 'ai_error' && (
            <button
              type="button"
              onClick={() => run(
                () => generateDavidDraftAction(handle, tab === 'existing' ? targetId || null : null),
                'Черновик посчитан',
              )}
              disabled={pending}
              className="mt-2 inline-flex h-8 items-center gap-2 rounded-md border border-slate-600 bg-slate-700 px-3 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" /> Повторить расчёт
            </button>
          )}
        </div>

        {message && (
          <p className={`mt-3 text-sm ${message.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>
        )}

        {visiblePhotos.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Очищенные кадры: <b className="text-slate-200">{visiblePhotos.length}</b> из {photos.length}
                {removedPhotos.length > 0 ? ` · убрано ${removedPhotos.length}` : ''}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">нажмите на кадр, чтобы открыть в полном размере</span>
                <button
                  type="button"
                  disabled={pending || problemPhotos.length === 0}
                  onClick={() => run(() => requeueDavidProblemPhotosAction(handle), 'Проблемные кадры отправлены на повтор')}
                  title="Прогнать заново кадры «не найдена», «на глаза» и сбои"
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-600 px-2 text-slate-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" /> Переочистить проблемные ({problemPhotos.length})
                </button>
              </span>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePhotos.map((photo) => (
                <div key={photo.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>кадр {photo.sourcePosition ?? '—'}</span>
                    <span className="flex items-center gap-2">
                      <span className={photo.cleanStatus === 'ok' ? 'text-emerald-300' : photo.cleanStatus === 'miss' ? 'text-slate-400' : 'text-amber-300'}>
                        {photo.cleanStatus ? VERDICT_LABEL[photo.cleanStatus] || photo.cleanStatus : ''}
                      </span>
                      <button
                        type="button"
                        title="Убрать кадр из импорта"
                        disabled={pending}
                        onClick={() => run(() => excludeDavidPhotoAction(handle, photo.sourceKey), 'Кадр убран')}
                        className="rounded border border-slate-600 p-1 text-slate-300 hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setViewer(photo); setViewOriginal(false) }}
                    className="mt-2 block w-full space-y-2 text-left"
                    title="Открыть кадр в полном размере"
                  >
                    <figure>
                      <figcaption className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Eye className="h-3 w-3" /> до
                      </figcaption>
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
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {removedPhotos.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Убрано из импорта ({removedPhotos.length})
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {removedPhotos.map((photo) => (
                <div key={photo.id} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => { setViewer(photo); setViewOriginal(false) }}
                    className="text-slate-300 hover:text-violet-300"
                    title="Посмотреть кадр"
                  >
                    кадр {photo.sourcePosition ?? '—'}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => restoreDavidPhotoAction(handle, photo.sourceKey), 'Кадр возвращён')}
                    className="inline-flex items-center gap-1 rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" /> вернуть
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(viewer)} onOpenChange={(open) => { if (!open) setViewer(null) }}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto border-slate-700 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle className="pr-8 text-base">
              Кадр {viewer?.sourcePosition ?? '—'}
              {viewer?.cleanStatus ? ` · ${VERDICT_LABEL[viewer.cleanStatus] || viewer.cleanStatus}` : ''}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Полный размер: очищенный кадр из S3 или оригинал поставщика.
            </DialogDescription>
          </DialogHeader>
          {viewer && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setViewOriginal(false)}
                  className={`rounded border px-2 py-1 ${viewOriginal ? 'border-slate-600 text-slate-300' : 'border-violet-500/60 bg-violet-500/10 text-violet-200'}`}
                >
                  Очищенный
                </button>
                <button
                  type="button"
                  onClick={() => setViewOriginal(true)}
                  className={`rounded border px-2 py-1 ${viewOriginal ? 'border-violet-500/60 bg-violet-500/10 text-violet-200' : 'border-slate-600 text-slate-300'}`}
                >
                  Оригинал поставщика
                </button>
                <a
                  href={viewOriginal ? viewer.sourceKey : viewer.s3CleanUrl || viewer.sourceKey}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:text-violet-300"
                >
                  Открыть в новой вкладке
                </a>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(
                    () => (excludedSet.has(viewer.sourceKey)
                      ? restoreDavidPhotoAction(handle, viewer.sourceKey)
                      : excludeDavidPhotoAction(handle, viewer.sourceKey)),
                    excludedSet.has(viewer.sourceKey) ? 'Кадр возвращён' : 'Кадр убран',
                  )}
                  className="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
                >
                  {excludedSet.has(viewer.sourceKey) ? 'Вернуть в импорт' : 'Убрать из импорта'}
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- в модалке нужен кадр целиком без оптимизации next/image */}
              <img
                src={(viewOriginal ? viewer.sourceKey : viewer.s3CleanUrl || viewer.sourceKey) || ''}
                alt={`кадр ${viewer.sourcePosition ?? ''}`}
                className="max-h-[70dvh] w-full rounded object-contain"
              />
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                {viewer.s3BeforeUrl && (
                  <a href={viewer.s3BeforeUrl} target="_blank" rel="noreferrer" className="hover:text-violet-300">
                    кроп «до»
                  </a>
                )}
                {viewer.s3AfterUrl && (
                  <a href={viewer.s3AfterUrl} target="_blank" rel="noreferrer" className="hover:text-violet-300">
                    кроп «после»
                  </a>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Размеры и замеры из вариантов David</h2>
        <p className="mt-1 text-xs text-slate-400">
          Размеры поставщика приведены к сантиметрам, одна строка замеров на размер. Значения подставляет сервер,
          модель их не придумывает.
        </p>
        {variantSizes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {variantSizes.map((size) => (
              <span key={size} className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-xs text-slate-200">{size}</span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-amber-300">Варианты не дают размера: у товара будет один вариант без размера.</p>
        )}
        {measurements.length > 0 && (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Размер</th>
                <th className="py-1 font-medium">Посадка</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {measurements.map((row) => (
                <tr key={row.size} className="border-t border-slate-700">
                  <td className="py-1 pr-3 font-semibold">{row.size}</td>
                  <td className="py-1">{row.fit || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {variantNotSizes.length > 0 && (
          <p className="mt-3 text-[11px] text-slate-500">
            Не размеры (цвета и служебные подписи поставщика): {variantNotSizes.join(', ')}
          </p>
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
              Категория каталога <span className="text-xs text-slate-500">(определил ИИ — проверьте)</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100">
                <option value="">— не определена —</option>
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
              {ai.categoryName && (
                <span className="mt-1 block text-[11px] text-slate-500">
                  ИИ: {ai.categoryName}{ai.subcategoryName ? ` / ${ai.subcategoryName}` : ''} · ответы модели правятся в каталоге Rails
                </span>
              )}
            </label>
            <label className="block text-sm text-slate-300">
              Категория Chromoff <span className="text-xs text-slate-500">(определил ИИ — проверьте)</span>
              <select value={chromoffCategoryId} onChange={(event) => setChromoffCategoryId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-slate-100">
                <option value="">— не определена —</option>
                {chromoffCategories.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">
                {ai.chromoffCategory
                  ? `уверенность ${Math.round(Number(ai.chromoffCategory.confidence || 0) * 100)}% · ${ai.chromoffCategory.status === 'ai_assigned' ? 'присвоена ИИ' : 'нужна проверка'}`
                  : 'ИИ категорию Chromoff не определил'}
              </span>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="text-sm text-slate-300">
              Цена David (USD)
              <div className="mt-1 flex h-10 items-center rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200">
                {priceLabel || '—'}
              </div>
            </div>
            <div className="text-sm text-slate-300">
              Цена в каталоге
              <div className="mt-1 flex h-10 items-center rounded-md border border-slate-700 bg-slate-900/60 px-3 text-slate-200">
                0 ₽ — витрина покажет «Цена по запросу» и не даст оформить заказ
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <h3 className="text-sm font-semibold text-slate-100">Характеристики от ИИ</h3>
            {attributes.length ? (
              <ul className="mt-2 grid gap-1 text-xs text-slate-200 sm:grid-cols-2">
                {attributes.map((item) => (
                  <li key={item.code} className="flex gap-2">
                    <span className="text-slate-500">{item.code}:</span>
                    <span>{item.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-amber-300">
                Характеристики не заполнены: запустите задание ИИ ещё раз или заполните их в каталоге Rails.
              </p>
            )}
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
              disabled={pending || !name || !categoryId || !chromoffCategoryId}
              onClick={() => run(() => createDavidChromoffProductAction({
                handle,
                name,
                description,
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
            <label className="flex items-center gap-2 self-center text-sm text-slate-300">
              <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
              публиковать в Chromoff
            </label>
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
                    <input
                      type="radio"
                      name="target"
                      checked={targetId === item.id}
                      onChange={() => {
                        setTargetId(item.id)
                        // У товара, созданного этим импортом, цена обязана быть 0,
                        // и он должен быть виден в Chromoff.
                        const isDavid = item.externalId.startsWith('david-studio-')
                        setZeroPrice(isDavid)
                        setPublishTarget(isDavid)
                      }}
                    />
                    <span className="text-slate-100">{item.name}</span>
                    {item.externalId.startsWith('david-studio-') && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-200">товар David</span>
                    )}
                  </span>
                  <span className="text-xs text-slate-400">{item.category} · фото {item.photos} · {item.price} ₽</span>
                </label>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
            <p className="font-semibold text-slate-100">Что будет записано</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>фото: {readyPhotos.length} очищенных кадров (уже имеющиеся пропускаются);</li>
              <li>характеристики и замеры: пишутся только те поля, которых у товара ещё нет;</li>
              <li>размеры из вариантов David: {variantSizes.length ? variantSizes.join(', ') : 'нет'};</li>
              <li>название, описание и категории существующего товара не меняются.</li>
            </ul>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={zeroPrice} onChange={(event) => setZeroPrice(event.target.checked)} />
            обнулить цену товара и вариантов (правило David: цена 0)
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={publishTarget} onChange={(event) => setPublishTarget(event.target.checked)} />
            сделать товар активным (скрытый товар не виден и в Chromoff)
          </label>

          <button
            type="button"
            disabled={pending || !targetId || !readyPhotos.length}
            onClick={() => run(
              () => attachDavidPhotosAction({
                handle,
                productId: targetId,
                photoAlts: alts,
                attributes: ai.attributes || {},
                zeroPrice,
                publish: publishTarget,
              }),
              'Записано в товар',
            )}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Добавить фото, характеристики и замеры ({readyPhotos.length})
          </button>
          <p className="text-xs text-slate-400">
            Фото, характеристики и замеры, которые уже есть у товара, не перетираются.
          </p>
        </div>
      )}
    </div>
  )
}

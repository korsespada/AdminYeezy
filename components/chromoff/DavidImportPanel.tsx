'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, Eye, ImageOff, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import {
  createDavidChromoffProductAction,
  excludeDavidPhotoAction,
  generateDavidDraftAction,
  requeueDavidProblemPhotosAction,
  markDavidWatermarkAction,
  clearDavidWatermarkMarkAction,
  restoreDavidPhotoAction,
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
  /** Рамка, отмеченная оператором вручную (доли кадра), если она есть. */
  manualBox?: { x1: number; y1: number; x2: number; y2: number } | null
}

type Draft = {
  status: string
  ai_output: any
  error: string | null
  rails_product_id: string | null
  chromoff_listing_id: string | null
  /** Цена, с которой товар уже создан (₽). */
  price_rub?: number | null
  /** Метка обновления черновика: по ней поля ревью перечитывают ответ ИИ. */
  updated_at: string | null
} | null

type Option = { id: string; name: string; parent_id?: string | null }

const VERDICT_LABEL: Record<string, string> = {
  ok: 'вотермарка убрана',
  review: 'на глаза',
  miss: 'не найдена',
}

const DRAFT_LABEL: Record<string, string> = {
  draft: 'не запускался',
  ai_queued: 'в очереди ИИ',
  ai_running: 'ИИ считает',
  ai_ready: 'готов',
  ai_error: 'ошибка',
  created: 'товар создан',
  merged: 'объединён со старым кольцом',
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
  rulePriceRub = null,
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
  /** Цена по правилу David (USD × 172, вверх до тысячи) — подставляется в поле цены. */
  rulePriceRub?: number | null
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
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [viewer, setViewer] = useState<Photo | null>(null)
  const [viewOriginal, setViewOriginal] = useState(false)
  // Ручная пометка вотермарки: оператор обводит надпись рамкой на кадре.
  const [markMode, setMarkMode] = useState(false)
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)

  const ai = draft?.ai_output || {}
  const [name, setName] = useState<string>(ai.name || title)
  const [description, setDescription] = useState<string>(ai.description || '')
  // ИИ возвращает верхнюю категорию и подкатегорию: в выборе каталога живут
  // подкатегории, поэтому подставляем именно подкатегорию.
  const [categoryId, setCategoryId] = useState<string>(ai.subcategory || ai.category || '')
  const [chromoffCategoryId, setChromoffCategoryId] = useState<string>(ai.chromoffCategory?.id || '')
  const [gender, setGender] = useState<string>(ai.gender || '')
  const [publish, setPublish] = useState(true)
  // Цена по правилу David подставляется сразу; оператор может поправить или
  // стереть (пусто или 0 — «Цена по запросу»).
  const [priceRub, setPriceRub] = useState<string>(() => {
    const initial = draft?.price_rub ?? rulePriceRub
    return initial ? String(initial) : ''
  })
  const priceValue = Math.round(Number(priceRub.replace(/s/g, '').replace(',', '.')) || 0)
  const priceInvalid = priceRub.trim() !== '' && (!Number.isFinite(Number(priceRub.replace(/s/g, '').replace(',', '.'))) || priceValue < 0)

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

  /**
   * Поля ревью — это состояние, а ответ ИИ приходит пропсом после router.refresh().
   * Без синхронизации имя и категории оставались прежними (и кнопка создания была
   * неактивной) до полной перезагрузки страницы. Перечитываем поля, когда черновик
   * действительно обновился, и не трогаем правки оператора в остальное время.
   */
  const draftRevision = draft?.updated_at || ''
  const seededRevision = useRef<string>('__init__')
  useEffect(() => {
    if (seededRevision.current === '__init__') {
      seededRevision.current = draftRevision
      return
    }
    if (seededRevision.current === draftRevision) return
    seededRevision.current = draftRevision
    const next = draft?.ai_output || {}
    setName(next.name || title)
    setDescription(next.description || '')
    setCategoryId(next.subcategory || next.category || '')
    setChromoffCategoryId(next.chromoffCategory?.id || '')
    setGender(next.gender || '')
  }, [draftRevision, draft, title])

  const attributes = reviewableAttributes(ai.attributes)
  const measurements = measurementRows(variantMeasurements)

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


  return (
    <div className="space-y-5 pb-28">
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
              onClick={() => run(() => generateDavidDraftAction(handle), 'Черновик посчитан')}
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
                <button
                  type="button"
                  onClick={() => { setMarkMode((value) => !value); setBox(null) }}
                  className={`rounded border px-2 py-1 ${markMode ? 'border-amber-500/60 bg-amber-500/10 text-amber-200' : 'border-slate-600 text-slate-300 hover:text-amber-200'}`}
                  title="Если вотермарку не нашли — обведите её сами, и кадр уйдёт на чистку вне очереди"
                >
                  {markMode ? 'Отменить пометку' : 'Отметить вотермарку'}
                </button>
                {markMode && (
                  <button
                    type="button"
                    disabled={pending || !box}
                    onClick={() => {
                      if (!box) return
                      run(
                        () => markDavidWatermarkAction(handle, viewer.sourceKey, box),
                        'Кадр отправлен на чистку по вашей рамке',
                      )
                      setBox(null)
                      setMarkMode(false)
                    }}
                    className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-amber-200 disabled:opacity-40"
                  >
                    Очистить по рамке вне очереди
                  </button>
                )}
                {viewer.manualBox && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => clearDavidWatermarkMarkAction(handle, viewer.sourceKey), 'Пометка снята')}
                    className="rounded border border-slate-600 px-2 py-1 text-slate-400 hover:text-amber-200 disabled:opacity-50"
                    title="Кадр снова пойдёт через автоопределение"
                  >
                    Снять пометку
                  </button>
                )}
              </div>
              {markMode && (
                <p className="text-xs text-amber-200">
                  Обведите надпись мышью — затирается ровно эта рамка. Обводите только вотермарку, не захватывая изделие.
                </p>
              )}
              <div
                className={`relative select-none ${markMode ? 'cursor-crosshair' : ''}`}
                onPointerDown={(event) => {
                  if (!markMode) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const point = {
                    x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
                    y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
                  }
                  setDragStart(point)
                  setBox({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (!markMode || !dragStart) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
                  const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
                  setBox({ x1: dragStart.x, y1: dragStart.y, x2: x, y2: y })
                }}
                onPointerUp={() => setDragStart(null)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- в модалке нужен кадр целиком без оптимизации next/image */}
                <img
                  src={(viewOriginal ? viewer.sourceKey : viewer.s3CleanUrl || viewer.sourceKey) || ''}
                  alt={`кадр ${viewer.sourcePosition ?? ''}`}
                  className="w-full rounded"
                  draggable={false}
                />
                {box && (
                  <div
                    className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/20"
                    style={{
                      left: `${Math.min(box.x1, box.x2) * 100}%`,
                      top: `${Math.min(box.y1, box.y2) * 100}%`,
                      width: `${Math.abs(box.x1 - box.x2) * 100}%`,
                      height: `${Math.abs(box.y1 - box.y2) * 100}%`,
                    }}
                  />
                )}
              </div>
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
            <label className="block text-sm text-slate-300">
              Цена в каталоге, ₽
              <input
                value={priceRub}
                onChange={(event) => setPriceRub(event.target.value)}
                inputMode="numeric"
                placeholder="пусто — «Цена по запросу»"
                aria-invalid={priceInvalid}
                className={`mt-1 h-10 w-full rounded-md border bg-slate-900 px-3 text-slate-100 ${priceInvalid ? 'border-rose-500' : 'border-slate-600'}`}
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                {rulePriceRub
                  ? `по правилу David: ${rulePriceRub.toLocaleString('ru-RU')} ₽ (цена поставщика × 172, вверх до тысячи)`
                  : 'у поставщика нет цены — правило не применить'}
                {priceValue > 0 ? '' : ' · сейчас: «Цена по запросу», заказ оформить нельзя'}
              </span>
            </label>
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

        </div>

      {/* Главные действия всегда на виду: длинные формы не заставляют искать кнопку. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-xs text-slate-400">
            <span className="text-slate-300">Новый товар в Chromoff</span>
            <span className="ml-2 text-slate-500">цена: {priceValue > 0 ? `${priceValue.toLocaleString('ru-RU')} ₽` : 'по запросу'}</span>
            <span className="ml-2 text-slate-500">кадров к импорту: {readyPhotos.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(() => generateDavidDraftAction(handle), 'Черновик посчитан')}
              disabled={pending || !readyPhotos.length}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Сделать черновик ИИ
            </button>
            <>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
                  публиковать
                </label>
                <button
                  type="button"
                  disabled={pending || priceInvalid || !name || !categoryId || !chromoffCategoryId}
                  onClick={() => run(() => createDavidChromoffProductAction({
                    handle,
                    name,
                    description,
                    categoryId,
                    chromoffCategoryId,
                    gender: gender || null,
                    attributes: ai.attributes || {},
                    photoAlts: Array.isArray(ai.photoAlts) ? ai.photoAlts : [],
                    seoDescription: ai.seoDescription || '',
                    published: publish,
                    priceRub: priceValue,
                  }), 'Товар создан в Chromoff')}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Создать товар только для Chromoff
                </button>
              </>
          </div>
        </div>
      </div>
    </div>
  )
}

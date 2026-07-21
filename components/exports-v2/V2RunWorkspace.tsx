'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImageIcon,
  Layers3,
  Loader2,
  LockKeyhole,
  MousePointer2,
  ScanText,
  Sparkles,
  Split,
  Type,
  Video,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  createExportsV2DraftAction,
  saveExportsV2TrainingExampleAction,
  ungroupExportsV2AlbumAction,
  updateExportsV2AlbumRoleAction,
} from '@/actions/exports-v2'
import type { V2Album, V2AlbumRole, V2Draft, V2RunDetails } from '@/lib/exports-v2-types'

const ROLE_OPTIONS: Array<{
  value: V2AlbumRole
  label: string
  hint: string
}> = [
  { value: 'UNASSIGNED', label: 'Выберите роль', hint: 'Пока ничего не использовать' },
  { value: 'PRIMARY_PHOTOS', label: 'Основные фото', hint: 'Фото публикуются, подпись этого альбома не используется' },
  { value: 'PRODUCT_MEDIA', label: 'Основные фото + текст', hint: 'Фото публикуются, текст используется AI' },
  { value: 'EXTRA_MEDIA', label: 'Дополнительные фото + текст', hint: 'Дополнительные фото публикуются, текст используется AI' },
  { value: 'TEXT_ONLY', label: 'Только текст', hint: 'Текст используется, фотографии не публикуются' },
  { value: 'SIZE_CHART', label: 'Размеры / OCR', hint: 'Извлечь данные из изображения, само фото не публиковать' },
  { value: 'COMPARISON_OR_AD', label: 'Сравнение / реклама', hint: 'Китайские сравнения и маркетинг не использовать' },
  { value: 'IGNORE', label: 'Игнорировать', hint: 'Сохранить в источнике, исключить из товара' },
]

export default function V2RunWorkspace({
  initialData,
  initialSearch,
  initialAssignment,
}: {
  initialData: V2RunDetails
  initialSearch: string
  initialAssignment: 'all' | 'assigned' | 'unassigned'
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [previewAlbum, setPreviewAlbum] = useState<V2Album | null>(null)
  const totalPages = Math.max(1, Math.ceil(initialData.total_albums / initialData.per_page))

  const selectedAlbums = useMemo(
    () => initialData.albums.filter((album) => selected.includes(album.id)),
    [initialData.albums, selected],
  )

  const toggleAlbum = (album: V2Album) => {
    if (album.draft_id) return
    setSelected((current) => current.includes(album.id)
      ? current.filter((id) => id !== album.id)
      : [...current, album.id])
  }

  const createDraft = async () => {
    setPending('create')
    setMessage(null)
    const result = await createExportsV2DraftAction(initialData.id, selected)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось объединить альбомы' })
      return
    }
    setSelected([])
    setMessage({ type: 'success', text: 'Черновик создан. Теперь назначьте роль каждому альбому.' })
    router.refresh()
  }

  const updateRole = async (draftId: string, albumId: string, role: V2AlbumRole) => {
    setPending(`role-${albumId}`)
    setMessage(null)
    const result = await updateExportsV2AlbumRoleAction(draftId, albumId, role)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось назначить роль' })
      return
    }
    router.refresh()
  }

  const ungroup = async (draftId: string, albumId: string) => {
    setPending(`ungroup-${albumId}`)
    const result = await ungroupExportsV2AlbumAction(draftId, albumId)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось вернуть альбом' })
      return
    }
    router.refresh()
  }

  const saveExample = async (draft: V2Draft) => {
    setPending(`example-${draft.id}`)
    setMessage(null)
    const result = await saveExportsV2TrainingExampleAction(draft.id)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось сохранить пример' })
      return
    }
    setMessage({ type: 'success', text: 'Пример сохранён для правил этого поставщика.' })
    router.refresh()
  }

  const pageHref = (page: number) => {
    const params = new URLSearchParams()
    if (initialSearch) params.set('search', initialSearch)
    if (initialAssignment !== 'all') params.set('assignment', initialAssignment)
    if (page > 1) params.set('page', String(page))
    const suffix = params.toString()
    return `/admin/exports-v2/${initialData.id}${suffix ? `?${suffix}` : ''}`
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-700 bg-slate-800/70 p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{initialData.supplier_name}</h1>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-200">V2 TEST</span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                initialData.status === 'RUNNING'
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                  : initialData.status === 'FAILED'
                    ? 'border-red-500/30 bg-red-500/10 text-red-200'
                    : 'border-slate-600 bg-slate-900 text-slate-300'
              }`}>
                {initialData.status === 'RUNNING' ? 'ВЫГРУЗКА ИДЁТ' : initialData.status === 'FAILED' ? 'ОШИБКА' : 'ГОТОВО К РАЗМЕТКЕ'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                <LockKeyhole className="h-3 w-3" /> Без пуша
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">{initialData.name}</p>
            {initialData.source_kind === 'DB_NATIVE' && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span>Последний проход: {initialData.last_received_count} получено · +{initialData.last_inserted_count} новых · {initialData.last_updated_count} изменено · {initialData.last_unchanged_count} без изменений</span>
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 font-semibold text-slate-300 hover:bg-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Обновить
                </button>
              </div>
            )}
            {initialData.last_error && <p className="mt-2 text-xs text-red-300">{initialData.last_error}</p>}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <HeaderMetric label="Альбомы" value={initialData.album_count} />
            <HeaderMetric label="Размечено" value={initialData.assigned_count} />
            <HeaderMetric label="Товары" value={initialData.draft_count} />
            <HeaderMetric label="Примеры" value={initialData.training_example_count} />
          </div>
        </div>
      </header>

      {message && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
          message.type === 'error'
            ? 'border-red-500/30 bg-red-950/30 text-red-200'
            : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
        }`}>
          {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_520px]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
            <form className="flex flex-col gap-3 lg:flex-row">
              <input
                name="search"
                defaultValue={initialSearch}
                placeholder="Поиск по тексту или external_id"
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-500"
              />
              <select
                name="assignment"
                defaultValue={initialAssignment}
                className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="all">Все альбомы</option>
                <option value="unassigned">Без товара</option>
                <option value="assigned">Уже размеченные</option>
              </select>
              <button className="h-10 rounded-lg bg-slate-700 px-5 text-sm font-semibold text-white hover:bg-slate-600">Применить</button>
            </form>
          </div>

          <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-slate-950/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                <MousePointer2 className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Выбрано: {selected.length}</div>
                <div className="text-xs text-slate-500">
                  {selectedAlbums.length > 0
                    ? `Позиции: ${selectedAlbums.map((album) => album.source_order).join(', ')}`
                    : 'Выберите альбомы, которые относятся к одному товару'}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {selected.length > 0 && (
                <button type="button" onClick={() => setSelected([])} className="h-9 rounded-lg px-3 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white">
                  Сбросить
                </button>
              )}
              <button
                type="button"
                onClick={createDraft}
                disabled={selected.length === 0 || pending === 'create'}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
              >
                {pending === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />}
                Это один товар
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {initialData.albums.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                selected={selected.includes(album.id)}
                onToggle={() => toggleAlbum(album)}
                onPreview={() => setPreviewAlbum(album)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
            <div className="text-xs text-slate-500">Страница {initialData.page} из {totalPages} · найдено {initialData.total_albums}</div>
            <div className="flex gap-2">
              <Link
                href={pageHref(Math.max(1, initialData.page - 1))}
                aria-disabled={initialData.page <= 1}
                className={`inline-flex h-9 items-center gap-1 rounded-lg border border-slate-700 px-3 text-sm font-semibold ${initialData.page <= 1 ? 'pointer-events-none text-slate-700' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <ChevronLeft className="h-4 w-4" /> Назад
              </Link>
              <Link
                href={pageHref(Math.min(totalPages, initialData.page + 1))}
                aria-disabled={initialData.page >= totalPages}
                className={`inline-flex h-9 items-center gap-1 rounded-lg border border-slate-700 px-3 text-sm font-semibold ${initialData.page >= totalPages ? 'pointer-events-none text-slate-700' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                Далее <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Собранные товары</h2>
              <p className="mt-1 text-xs text-slate-500">Назначьте назначение каждого исходного альбома.</p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">{initialData.drafts.length}</span>
          </div>

          {initialData.drafts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
              Выберите карточки слева и нажмите «Это один товар».
            </div>
          ) : initialData.drafts.map((draft) => (
            <div key={draft.id} className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/70">
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
                <div>
                  <div className="font-semibold text-white">{draft.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{draft.albums.length} источника · {draft.status === 'GROUPED' ? 'пример сохранён' : 'черновик'}</div>
                </div>
                {draft.status === 'GROUPED' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">
                    <BookOpenCheck className="h-3 w-3" /> Обучение
                  </span>
                )}
              </div>

              <div className="space-y-3 p-4">
                {draft.albums.map((album) => {
                  const currentRole = ROLE_OPTIONS.find((option) => option.value === album.role)
                  return (
                    <div key={album.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => ungroup(draft.id, album.id)}
                          disabled={pending === `ungroup-${album.id}`}
                          title="Вернуть альбом в сетку"
                          className="shrink-0 overflow-hidden rounded-lg ring-offset-slate-900 hover:ring-2 hover:ring-red-400/60 disabled:opacity-50"
                        >
                          <AlbumThumb album={album} className="h-16 w-16" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => ungroup(draft.id, album.id)}
                              disabled={pending === `ungroup-${album.id}`}
                              className="truncate text-left text-xs font-bold text-slate-300 hover:text-red-300"
                              title="Вернуть альбом в сетку"
                            >
                              Альбом #{album.source_order}
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setPreviewAlbum(album)}
                                title="Открыть альбом"
                                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-cyan-300"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => ungroup(draft.id, album.id)}
                                disabled={pending === `ungroup-${album.id}`}
                                title="Вернуть альбом в сетку"
                                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                              >
                                {pending === `ungroup-${album.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Split className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                          <select
                            value={album.role}
                            onChange={(event) => updateRole(draft.id, album.id, event.target.value as V2AlbumRole)}
                            disabled={pending === `role-${album.id}`}
                            className="mt-2 h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs font-semibold text-slate-200 outline-none focus:border-cyan-500"
                          >
                            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <div className="mt-1.5 text-[10px] leading-4 text-slate-500">{currentRole?.hint}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                <RoleSummary draft={draft} />

                <button
                  type="button"
                  onClick={() => saveExample(draft)}
                  disabled={pending === `example-${draft.id}` || draft.status === 'GROUPED'}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {pending === `example-${draft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {draft.status === 'GROUPED' ? 'Пример сохранён' : 'Сохранить как пример поставщика'}
                </button>
              </div>
            </div>
          ))}
        </aside>
      </div>

      {previewAlbum && (
        <AlbumPreviewModal
          key={previewAlbum.id}
          album={previewAlbum}
          onClose={() => setPreviewAlbum(null)}
        />
      )}
    </div>
  )
}

function AlbumCard({
  album,
  selected,
  onToggle,
  onPreview,
}: {
  album: V2Album
  selected: boolean
  onToggle: () => void
  onPreview: () => void
}) {
  const assigned = Boolean(album.draft_id)
  const videoCount = (album.media || []).filter((item) => item.type === 'video').length
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border text-left transition ${
        selected
          ? 'border-cyan-400 bg-cyan-500/10 ring-2 ring-cyan-500/20'
          : assigned
            ? 'cursor-default border-indigo-500/20 bg-indigo-500/5 opacity-70'
            : 'border-slate-700 bg-slate-800/70 hover:border-slate-500'
      }`}
    >
      <button type="button" onClick={onToggle} disabled={assigned} className="block w-full text-left disabled:cursor-default">
        <div className="relative aspect-square overflow-hidden bg-slate-950">
          <AlbumThumb album={album} className="h-full w-full transition duration-300 group-hover:scale-[1.02]" />
          <div className="absolute left-2 top-2 rounded-md bg-slate-950/85 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">#{album.source_order}</div>
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-1 text-[10px] font-semibold text-slate-200 backdrop-blur">
            <ImageIcon className="h-3 w-3" /> {album.photos.length}
            {videoCount > 0 && <><Video className="ml-1 h-3 w-3" /> {videoCount}</>}
          </div>
          {selected && <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-slate-950"><Check className="h-4 w-4" /></div>}
          {assigned && <div className="absolute inset-x-2 bottom-2 rounded-md bg-indigo-500/90 px-2 py-1 text-center text-[10px] font-bold text-white">Уже в товаре</div>}
        </div>
        <div className="p-3">
          <p className="line-clamp-3 min-h-12 text-xs leading-4 text-slate-300">{album.description || 'Без текста'}</p>
          <div className="mt-2 truncate pr-8 text-[10px] text-slate-600">{album.external_id}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onPreview()
        }}
        title="Открыть альбом"
        aria-label={`Открыть альбом #${album.source_order}`}
        className="absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950/85 text-slate-400 backdrop-blur hover:bg-cyan-500 hover:text-white"
      >
        <Eye className="h-4 w-4" />
      </button>
    </div>
  )
}

function AlbumThumb({ album, className }: { album: Pick<V2Album, 'photos' | 'media'>; className: string }) {
  const photo = album.photos[0] || album.media?.[0]?.preview_url
  if (!photo) return <div className={`flex items-center justify-center bg-slate-950 text-slate-700 ${className}`}><ImageIcon className="h-6 w-6" /></div>
  return (
    <div
      role="img"
      aria-label="Исходный альбом"
      className={`bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url(${JSON.stringify(supplierImageUrl(photo, 420, 78))})` }}
    />
  )
}

function supplierImageUrl(source: string, size: number, quality: number) {
  if (!source || source.includes('imageMogr2/') || source.includes('vframe/')) return source
  try {
    const url = new URL(source)
    if (!url.hostname.endsWith('szwego.com')) return source
    const separator = source.includes('?') ? '&' : '?'
    return `${source}${separator}imageMogr2/auto-orient/thumbnail/!${size}x${size}r/quality/${quality}/format/webp`
  } catch {
    return source
  }
}

function AlbumPreviewModal({ album, onClose }: { album: V2Album; onClose: () => void }) {
  const media = album.media?.length
    ? album.media
    : album.photos.map((photo) => ({ type: 'image' as const, url: photo, preview_url: photo }))
  const [activeMedia, setActiveMedia] = useState(media[0] || null)
  const videoCount = media.filter((item) => item.type === 'video').length

  return (
    <div role="dialog" aria-modal="true" aria-label={`Альбом #${album.source_order}`} className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Альбом #{album.source_order}</h2>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-300">{album.photos.length} фото</span>
              {videoCount > 0 && <span className="rounded-full bg-violet-500/15 px-2 py-1 text-xs font-semibold text-violet-300">{videoCount} видео</span>}
            </div>
            <p className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap text-sm leading-5 text-slate-400">{album.description || 'Без текста'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть альбом" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {activeMedia?.type === 'video' ? (
            <video
              key={activeMedia.url}
              controls
              preload="metadata"
              poster={supplierImageUrl(activeMedia.preview_url, 1280, 85)}
              className="h-[min(62vh,720px)] w-full rounded-xl bg-slate-950 object-contain"
            >
              <source src={activeMedia.url} type="video/mp4" />
            </video>
          ) : activeMedia ? (
            <div
              role="img"
              aria-label={`Выбранное фото альбома #${album.source_order}`}
              className="h-[min(62vh,720px)] w-full rounded-xl bg-slate-950 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${JSON.stringify(supplierImageUrl(activeMedia.url, 1280, 85))})` }}
            />
          ) : (
            <div className="flex h-72 items-center justify-center rounded-xl bg-slate-950 text-slate-600">В альбоме нет фотографий</div>
          )}

          {media.length > 1 && (
            <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
              {media.map((item, index) => (
                <button
                  key={`${item.type}-${item.url}-${index}`}
                  type="button"
                  onClick={() => setActiveMedia(item)}
                  aria-label={`${item.type === 'video' ? 'Видео' : 'Фото'} ${index + 1}`}
                  className={`relative aspect-square overflow-hidden rounded-lg bg-slate-950 ${activeMedia?.url === item.url ? 'ring-2 ring-cyan-400' : 'opacity-75 hover:opacity-100'}`}
                >
                  <span
                    role="img"
                    aria-label="Миниатюра"
                    className="block h-full w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${JSON.stringify(supplierImageUrl(item.preview_url, 240, 72))})` }}
                  />
                  {item.type === 'video' && <span className="absolute inset-0 flex items-center justify-center bg-slate-950/25"><Video className="h-5 w-5 text-white" /></span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RoleSummary({ draft }: { draft: V2Draft }) {
  const publicPhotos = draft.albums.filter((album) => album.use_photos).reduce((sum, album) => sum + album.photos.length, 0)
  const textSources = draft.albums.filter((album) => album.use_text).length
  const ocrSources = draft.albums.filter((album) => album.role === 'SIZE_CHART').length

  return (
    <div className="grid grid-cols-3 gap-2">
      <SummaryMetric icon={Eye} label="Публичных фото" value={publicPhotos} />
      <SummaryMetric icon={Type} label="Источников текста" value={textSources} />
      <SummaryMetric icon={ScanText} label="OCR таблиц" value={ocrSources} />
    </div>
  )
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-950/70 p-2 text-center">
      <Icon className="mx-auto h-3.5 w-3.5 text-slate-500" />
      <div className="mt-1 text-sm font-bold text-slate-200">{value}</div>
      <div className="mt-0.5 text-[9px] leading-3 text-slate-600">{label}</div>
    </div>
  )
}

function HeaderMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded-xl bg-slate-950/60 px-3 py-2">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

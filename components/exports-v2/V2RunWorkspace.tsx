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
  MousePointer2,
  PackageCheck,
  Play,
  PlusCircle,
  RotateCcw,
  ScanText,
  Settings2,
  Sparkles,
  Split,
  Type,
  Video,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  addExportsV2AlbumsToDraftAction,
  createExportsV2DraftAction,
  reopenExportsV2DraftAction,
  saveExportsV2TrainingExampleAction,
  ungroupExportsV2AlbumAction,
  updateExportsV2AlbumRoleAction,
} from '@/actions/exports-v2'
import {
  confirmExportsV2ProductAction,
  pushExportsV2ProductsAction,
  runExportsV2GroupingAiAction,
  runExportsV2ProductAiAction,
  updateExportsV2SupplierAiSettingsAction,
} from '@/actions/exports-v2-ai'
import type { V2Album, V2AlbumRole, V2Draft, V2RunDetails } from '@/lib/exports-v2-types'
import { buildExportsV2MediaPlan } from '@/lib/exports-v2-media'

const ROLE_OPTIONS: Array<{
  value: V2AlbumRole
  label: string
  hint: string
}> = [
  { value: 'UNASSIGNED', label: 'Выберите роль', hint: 'Пока ничего не использовать' },
  { value: 'PRIMARY_MEDIA', label: 'Основные медиа + текст', hint: 'Фото и видео публикуются первыми; текст используется AI' },
  { value: 'ON_MODEL', label: 'На модели', hint: 'Медиа публикуются после основных с лимитом поставщика' },
  { value: 'MEDIA_WITH_TEXT', label: 'Медиа + текст', hint: 'Медиа публикуются, текст используется AI' },
  { value: 'EXTRA_MEDIA', label: 'Дополнительные медиа', hint: 'Медиа публикуются после основных и кадров на модели' },
  { value: 'TEXT_ONLY', label: 'Только текст', hint: 'Текст используется, медиа не публикуются' },
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [supplierSettings, setSupplierSettings] = useState({
    ai_instructions: initialData.ai_instructions || '',
    ai_cache_enabled: initialData.ai_cache_enabled,
    ai_photo_enabled: initialData.ai_photo_enabled,
    post_process_description: initialData.post_process_description || '',
  })
  const totalPages = Math.max(1, Math.ceil(initialData.total_albums / initialData.per_page))

  const selectedAlbums = useMemo(
    () => {
      const albumsById = new Map(initialData.albums.map((album) => [album.id, album]))
      return selected.map((albumId) => albumsById.get(albumId)).filter((album): album is V2Album => Boolean(album))
    },
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
    setMessage({ type: 'success', text: 'Черновик создан. Первый выбранный альбом назначен основным.' })
    router.refresh()
  }

  const addToDraft = async (draftId: string) => {
    setPending(`add-${draftId}`)
    setMessage(null)
    const result = await addExportsV2AlbumsToDraftAction(draftId, selected)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось добавить альбомы в товар' })
      return
    }
    setSelected([])
    setMessage({ type: 'success', text: 'Выбранные альбомы добавлены в товар в порядке выбора.' })
    router.refresh()
  }

  const reopenDraft = async (draftId: string) => {
    if (!window.confirm('Удалить этот пример из обучения и вернуть товар в режим редактирования?')) return
    setPending(`reopen-${draftId}`)
    setMessage(null)
    const result = await reopenExportsV2DraftAction(draftId)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось отменить сохранение примера' })
      return
    }
    setMessage({ type: 'success', text: 'Пример удалён из обучения. Теперь можно изменить состав и роли.' })
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

  const runAiStage = async (stage: 'grouping' | 'product') => {
    const question = stage === 'grouping'
      ? 'ИИ просмотрит все неразмеченные альбомы порциями и создаст предложения. Запустить этап 1?'
      : 'ИИ обработает только подтверждённые группы и создаст карточки для ручной проверки. Запустить этап 2?'
    if (!window.confirm(question)) return
    setPending(`ai-${stage}`)
    setMessage(null)
    const result = stage === 'grouping'
      ? await runExportsV2GroupingAiAction(initialData.id)
      : await runExportsV2ProductAiAction(initialData.id)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Этап ИИ завершился с ошибкой' })
      return
    }
    const data = result.data || {}
    setMessage({
      type: 'success',
      text: stage === 'grouping'
        ? `ИИ проверил ${data.analyzed || 0} альбомов и предложил ${data.created || 0} товаров. Подтвердите их справа.`
        : `Обработано карточек: ${data.processed || 0}; из кэша: ${data.cacheHits || 0}; ошибок: ${data.failed || 0}.`,
    })
    router.refresh()
  }

  const saveSupplierSettings = async () => {
    setPending('supplier-settings')
    setMessage(null)
    const result = await updateExportsV2SupplierAiSettingsAction(initialData.id, supplierSettings)
    setPending('')
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || 'Не удалось сохранить настройки поставщика' })
      return
    }
    setSettingsOpen(false)
    setMessage({ type: 'success', text: 'Настройки поставщика сохранены.' })
    router.refresh()
  }

  const pushReadyProducts = async () => {
    const readyCount = initialData.drafts.filter((draft) => draft.status === 'READY_TO_PUSH').length
    if (!readyCount) {
      setMessage({ type: 'error', text: 'Сначала подтвердите хотя бы одну обработанную карточку.' })
      return
    }
    if (!window.confirm(`Отправить в основную БД подтверждённые карточки: ${readyCount}?`)) return
    setPending('push')
    setMessage(null)
    const result = await pushExportsV2ProductsAction(initialData.id)
    setPending('')
    const pushed = result.data?.pushed || 0
    const failed = result.data?.failed || 0
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? `В основную БД отправлено товаров: ${pushed}.` : `Отправлено: ${pushed}; ошибок: ${failed}. ${result.error || ''}`,
    })
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
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-200">
                <Sparkles className="h-3 w-3" /> AI в 2 этапа
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

      <section className="rounded-2xl border border-indigo-500/20 bg-slate-900/70 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Обработка выгрузки</h2>
            <p className="mt-1 text-xs text-slate-500">
              1 — предложения объединения · ручное подтверждение · 2 — карточки товара · ручное подтверждение · пуш.
            </p>
            <p className="mt-1 text-[11px] text-slate-600">Модели: {initialData.grouping_model} / {initialData.product_model}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800">
              <Settings2 className="h-4 w-4" /> Поставщик
            </button>
            <button type="button" onClick={() => runAiStage('grouping')} disabled={pending.startsWith('ai-')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-3 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
              {pending === 'ai-grouping' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 1. Объединить AI
            </button>
            <button type="button" onClick={() => runAiStage('product')} disabled={pending.startsWith('ai-')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
              {pending === 'ai-product' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} 2. Создать карточки
            </button>
            <button type="button" onClick={pushReadyProducts} disabled={pending === 'push'} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {pending === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Пуш готовых
            </button>
          </div>
        </div>
      </section>

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
                    ? `Порядок выбора: ${selectedAlbums.map((album) => album.source_order).join(' → ')}`
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
                selectionOrder={selected.indexOf(album.id) + 1}
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
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-[11px] leading-4 text-indigo-100/80">
            Примеры не расходуют токены сами по себе. Этап 1 использует их как подсказки; каждое AI-предложение нужно подтвердить до этапа 2.
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
                  <div className="mt-0.5 text-xs text-slate-500">{draft.albums.length} источника · {draftStatusLabel(draft.status)}</div>
                </div>
                {(draft.status === 'GROUPED' || draft.status === 'READY_FOR_AI') && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">
                    <BookOpenCheck className="h-3 w-3" /> Пример
                  </span>
                )}
                {draft.origin === 'AI' && <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-300">AI {draft.ai_confidence === null ? '' : `${Math.round(Number(draft.ai_confidence) * 100)}%`}</span>}
              </div>

              <div className="space-y-3 p-4">
                {['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) && selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => addToDraft(draft.id)}
                    disabled={pending === `add-${draft.id}`}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    {pending === `add-${draft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                    Добавить выбранные альбомы ({selected.length})
                  </button>
                )}
                {draft.albums.map((album) => {
                  const currentRole = ROLE_OPTIONS.find((option) => option.value === album.role)
                  return (
                    <div key={album.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => ungroup(draft.id, album.id)}
                          disabled={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) || pending === `ungroup-${album.id}`}
                          title={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) ? 'Сначала верните группу к редактированию' : 'Вернуть альбом в сетку'}
                          className="shrink-0 overflow-hidden rounded-lg ring-offset-slate-900 hover:ring-2 hover:ring-red-400/60 disabled:opacity-50"
                        >
                          <AlbumThumb album={album} className="h-16 w-16" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => ungroup(draft.id, album.id)}
                              disabled={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) || pending === `ungroup-${album.id}`}
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
                                disabled={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) || pending === `ungroup-${album.id}`}
                                title={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) ? 'Сначала верните группу к редактированию' : 'Вернуть альбом в сетку'}
                                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                              >
                                {pending === `ungroup-${album.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Split className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                          <select
                            value={album.role}
                            onChange={(event) => updateRole(draft.id, album.id, event.target.value as V2AlbumRole)}
                            disabled={!['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) || pending === `role-${album.id}`}
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

                <RoleSummary draft={draft} maxOnModelMedia={initialData.max_on_model_media} />

                {draft.origin === 'AI' && draft.ai_group_reason && (
                  <p className="rounded-lg bg-cyan-500/5 px-3 py-2 text-[11px] leading-4 text-cyan-100/70">Почему AI объединил: {draft.ai_group_reason}</p>
                )}

                {draft.status === 'GROUPED' || draft.status === 'READY_FOR_AI' ? (
                  <button
                    type="button"
                    onClick={() => reopenDraft(draft.id)}
                    disabled={pending === `reopen-${draft.id}`}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-sm font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {pending === `reopen-${draft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Удалить пример и редактировать
                  </button>
                ) : ['GROUPING_DRAFT', 'NEEDS_REVIEW'].includes(draft.status) ? (
                  <button
                    type="button"
                    onClick={() => saveExample(draft)}
                    disabled={pending === `example-${draft.id}`}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {pending === `example-${draft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {draft.origin === 'AI' ? 'Подтвердить группу и сохранить пример' : 'Сохранить как пример поставщика'}
                  </button>
                ) : draft.status === 'AI_PROCESSED' && draft.ai_product ? (
                  <ProductReview
                    draft={draft}
                    lookups={initialData.catalog_lookups}
                    pending={pending === `confirm-${draft.id}`}
                    onPending={(value) => setPending(value ? `confirm-${draft.id}` : '')}
                    onMessage={setMessage}
                    onDone={() => router.refresh()}
                  />
                ) : draft.status === 'READY_TO_PUSH' ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center text-xs font-bold text-emerald-200">Карточка подтверждена и готова к пушу</div>
                ) : draft.status === 'PUSHED' ? (
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-center text-xs font-bold text-cyan-200">Отправлено в основную БД · {draft.pushed_product_id || 'ID получен'}</div>
                ) : null}
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
      {settingsOpen && (
        <SupplierSettingsModal
          value={supplierSettings}
          onChange={setSupplierSettings}
          scriptName={initialData.post_process_script}
          groupingModel={initialData.grouping_model}
          productModel={initialData.product_model}
          pending={pending === 'supplier-settings'}
          onSave={saveSupplierSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function draftStatusLabel(status: string) {
  const labels: Record<string, string> = {
    GROUPING_DRAFT: 'черновик',
    NEEDS_REVIEW: 'предложение AI — проверьте',
    GROUPED: 'группа подтверждена',
    READY_FOR_AI: 'готово для AI',
    AI_PROCESSED: 'карточка AI — проверьте',
    READY_TO_PUSH: 'готово к пушу',
    PUSHED: 'в основной БД',
  }
  return labels[status] || status
}

function ProductReview({
  draft,
  lookups,
  pending,
  onPending,
  onMessage,
  onDone,
}: {
  draft: V2Draft
  lookups: V2RunDetails['catalog_lookups']
  pending: boolean
  onPending: (value: boolean) => void
  onMessage: (value: { type: 'error' | 'success'; text: string }) => void
  onDone: () => void
}) {
  const initial = draft.ai_product || {}
  const [product, setProduct] = useState({
    ...initial,
    name: String(initial.name || ''),
    description: String(initial.description || ''),
    price: Number(initial.price || 0),
    brand: String(initial.brand || ''),
    category: String(initial.category || ''),
    subcategory: String(initial.subcategory || ''),
    gender: String(initial.gender || ''),
  })
  const [attributes, setAttributes] = useState(JSON.stringify(initial.attributes || {}, null, 2))
  const subcategories = lookups.subcategories.filter((item) => !product.category || !item.parent_id || item.parent_id === product.category)

  const confirm = async () => {
    let parsedAttributes: Record<string, any>
    try {
      parsedAttributes = attributes.trim() ? JSON.parse(attributes) : {}
    } catch {
      onMessage({ type: 'error', text: `В карточке «${product.name}» атрибуты содержат неверный JSON.` })
      return
    }
    onPending(true)
    const result = await confirmExportsV2ProductAction(draft.id, { ...product, attributes: parsedAttributes })
    onPending(false)
    if (!result.success) {
      onMessage({ type: 'error', text: result.error || 'Не удалось подтвердить карточку' })
      return
    }
    onMessage({ type: 'success', text: `Карточка «${product.name}» подтверждена и готова к пушу.` })
    onDone()
  }

  const fieldClass = 'h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500'
  return (
    <div className="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3">
      <div className="text-xs font-bold text-indigo-200">Проверка карточки товара</div>
      <input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} placeholder="Название" className={fieldClass} />
      <textarea value={product.description} onChange={(event) => setProduct({ ...product, description: event.target.value })} placeholder="Описание" className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 outline-none focus:border-indigo-500" />
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min="0" value={product.price} onChange={(event) => setProduct({ ...product, price: Number(event.target.value) })} placeholder="Цена" className={fieldClass} />
        <select value={product.gender} onChange={(event) => setProduct({ ...product, gender: event.target.value })} className={fieldClass}>
          <option value="">Гендер не выбран</option><option value="female">Женский</option><option value="male">Мужской</option><option value="unisex">Унисекс</option>
        </select>
      </div>
      <select value={product.brand} onChange={(event) => setProduct({ ...product, brand: event.target.value })} className={fieldClass}>
        <option value="">Бренд не выбран</option>{lookups.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select value={product.category} onChange={(event) => setProduct({ ...product, category: event.target.value, subcategory: '' })} className={fieldClass}>
          <option value="">Категория не выбрана</option>{lookups.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={product.subcategory} onChange={(event) => setProduct({ ...product, subcategory: event.target.value })} className={fieldClass}>
          <option value="">Подкатегория не выбрана</option>{subcategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      <label className="block text-[10px] text-slate-500">Атрибуты (JSON по кодам)</label>
      <textarea value={attributes} onChange={(event) => setAttributes(event.target.value)} className="min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-300 outline-none focus:border-indigo-500" />
      <button type="button" onClick={confirm} disabled={pending || !product.name.trim()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Подтвердить карточку для пуша
      </button>
    </div>
  )
}

function SupplierSettingsModal({ value, onChange, scriptName, groupingModel, productModel, pending, onSave, onClose }: {
  value: { ai_instructions: string; ai_cache_enabled: boolean; ai_photo_enabled: boolean; post_process_description: string }
  onChange: (value: { ai_instructions: string; ai_cache_enabled: boolean; ai_photo_enabled: boolean; post_process_description: string }) => void
  scriptName: string | null
  groupingModel: string
  productModel: string
  pending: boolean
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Настройки поставщика" className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-bold text-white">Настройки поставщика для AI</h2><p className="mt-1 text-xs text-slate-500">Доступны прямо из текущей выгрузки.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block"><span className="text-xs font-bold text-slate-300">Инструкции обработки карточек</span><textarea value={value.ai_instructions} onChange={(event) => onChange({ ...value, ai_instructions: event.target.value })} className="mt-2 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 outline-none focus:border-indigo-500" placeholder="Например: футболки — 19000; формировать название..." /></label>
          <label className="block"><span className="text-xs font-bold text-slate-300">Описание старого скрипта для объединения</span><textarea value={value.post_process_description} onChange={(event) => onChange({ ...value, post_process_description: event.target.value })} className="mt-2 min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 outline-none focus:border-cyan-500" placeholder="Опишите словами порядок и признаки объединения альбомов" /></label>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-400">
            Скрипт: <span className="text-slate-200">{scriptName || 'не задан'}</span>. Его код не отправляется AI — используется только описание выше.<br />
            Группировка: <span className="font-mono text-cyan-300">{groupingModel}</span><br />Карточки: <span className="font-mono text-indigo-300">{productModel}</span>. Модели меняются в «Настройках ИИ».
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-200"><input type="checkbox" checked={value.ai_photo_enabled} onChange={(event) => onChange({ ...value, ai_photo_enabled: event.target.checked })} className="h-4 w-4" /><span><b>Использовать изображение при создании карточки</b><small className="block text-slate-500">Этап 1 всегда получает одну сжатую плитку каталога; здесь регулируется этап 2.</small></span></label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-200"><input type="checkbox" checked={value.ai_cache_enabled} onChange={(event) => onChange({ ...value, ai_cache_enabled: event.target.checked })} className="h-4 w-4" /><span><b>Использовать безопасный кэш</b><small className="block text-slate-500">Повторно использует результат только при совпадении текста, настроек, модели, версии промпта и изображения.</small></span></label>
          <button type="button" onClick={onSave} disabled={pending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Сохранить настройки</button>
        </div>
      </div>
    </div>
  )
}

function AlbumCard({
  album,
  selected,
  selectionOrder,
  onToggle,
  onPreview,
}: {
  album: V2Album
  selected: boolean
  selectionOrder: number
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
          {selected && <div className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-cyan-400 px-1 text-xs font-black text-slate-950">{selectionOrder}</div>}
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

function RoleSummary({ draft, maxOnModelMedia }: { draft: V2Draft; maxOnModelMedia: number }) {
  const mediaPlan = buildExportsV2MediaPlan(draft.albums, maxOnModelMedia)
  const textSources = draft.albums.filter((album) => album.use_text).length
  const ocrSources = draft.albums.filter((album) => album.role === 'SIZE_CHART').length

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        <SummaryMetric icon={Eye} label="Медиа в карточке" value={mediaPlan.items.length} />
        <SummaryMetric icon={ImageIcon} label="На модели" value={`${mediaPlan.on_model_included}/${mediaPlan.on_model_available}`} />
        <SummaryMetric icon={Type} label="Источников текста" value={textSources} />
        <SummaryMetric icon={ScanText} label="OCR таблиц" value={ocrSources} />
      </div>
      <p className="mt-2 text-center text-[10px] text-slate-500">
        Порядок: основные → медиа + текст → на модели → дополнительные. Внутри ролей сохраняется порядок выбора.
      </p>
    </div>
  )
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: React.ReactNode }) {
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

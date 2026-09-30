'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Film, ImageOff, Link2, Loader2, PlayCircle, RefreshCw, RotateCcw, Search, Upload, XCircle } from 'lucide-react'
import {
  applyApprovedVideoMatchesAction,
  approveVideoMatchesAction,
  attachVideoMatchSupplierChunkAction,
  buildVideoMatchesChunkAction,
  bulkApproveVideoMatchesAction,
  getVideoMatchStatsAction,
  listVideoMatchMissesAction,
  listVideoMatchesAction,
  rejectVideoMatchesAction,
  resetApprovedVideoMatchesAction,
  resetVideoMatchesAction,
  retryFailedVideoMatchesAction,
  type VideoMatchCursor,
} from '@/actions/video-matches'
import { VIDEO_MATCH_BAND_LABELS, VIDEO_MATCH_PRESETS } from '@/lib/video-match-presets'

type Alternative = {
  id: number
  rank: number
  confidence: string
  score: number
  video_source_url: string
  video_poster_url: string | null
  source_fields: Record<string, string | null>
  status: string
}

type Row = {
  id: number
  crm_product_id: string
  crm_slug: string | null
  crm_name: string | null
  crm_category: string | null
  crm_status: string | null
  crm_photo_url: string | null
  rank: number
  candidates_total: number
  confidence: string
  score: number
  source_fields: Record<string, string | null>
  crm_fields: Record<string, string | null>
  differences: Array<{ field: string; catalog: string | null; album: string | null; verdict: string }>
  status: string
  video_source_url: string
  video_poster_url: string | null
  s3_video_url: string | null
  s3_poster_url: string | null
  error: string | null
  alternatives: Alternative[]
}

type Miss = {
  crm_product_id: string
  crm_slug: string | null
  crm_name: string | null
  crm_category: string | null
  crm_photo_url: string | null
  crm_fields: Record<string, string | null>
}

type Stats = {
  counts: {
    total: number; pending: number; pendingAlternatives: number; approved: number; applied: number; rejected: number; failed: number
    exact: number; strong: number; probable: number; singleCandidate: number; products: number; withoutCandidates: number
  }
  scannedProducts: number
  albums: number
  albumsWithoutFields: number
  albumsWithoutVideo: number
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Ждут решения' },
  { value: 'approved', label: 'Апрувнуты' },
  { value: 'applied', label: 'Видео привязано' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'failed', label: 'Ошибки' },
  { value: 'all', label: 'Все' },
]

const FIELD_LABELS: Record<string, string> = {
  style: 'Стиль',
  colour: 'Цвет',
  size: 'Размер',
  leather: 'Кожа',
  hardware: 'Фурнитура',
}

const VERDICT_STYLE: Record<string, string> = {
  match: 'text-emerald-300',
  partial: 'text-amber-300',
  mismatch: 'text-rose-300',
  unknown: 'text-slate-500',
}

const BAND_STYLE: Record<string, string> = {
  exact: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  strong: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  probable: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  weak: 'border-slate-600 bg-slate-800 text-slate-300',
}

const PER_PAGE_OPTIONS = [30, 60, 100, 200]

/**
 * Скроллится не window, а оболочка админки, поэтому позицию снимаем со всех
 * возможных контейнеров и возвращаем её после перерисовки списка.
 */
function scrollElements(): HTMLElement[] {
  return [
    document.scrollingElement as HTMLElement | null,
    document.querySelector<HTMLElement>('.admin-scroll'),
    document.querySelector<HTMLElement>('.admin-shell'),
    document.querySelector<HTMLElement>('main'),
  ].filter((element): element is HTMLElement => Boolean(element))
}

function captureScroll() {
  return scrollElements().map((element) => ({ element, top: element.scrollTop }))
}

function restoreScroll(snapshot: Array<{ element: HTMLElement; top: number }>) {
  for (const { element, top } of snapshot) {
    if (element.isConnected) element.scrollTop = top
  }
}

export default function VideoMatchesApp() {
  const preset = VIDEO_MATCH_PRESETS[0]
  const [status, setStatus] = useState('pending')
  const [bands, setBands] = useState<string[]>(['exact', 'strong', 'probable'])
  const [search, setSearch] = useState('')
  const [onlySingleCandidate, setOnlySingleCandidate] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(60)
  // Сколько видео заливается параллельно в одном запросе: больше — быстрее,
  // но каждый файл качается и перекодируется ffmpeg.
  const [applyBatchSize, setApplyBatchSize] = useState(2)
  const [misses, setMisses] = useState<Miss[]>([])
  const [showMisses, setShowMisses] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const cancelRef = useRef(false)
  const scrollSnapshotRef = useRef<Array<{ element: HTMLElement; top: number }> | null>(null)

  const loadStats = useCallback(async () => {
    const result = await getVideoMatchStatsAction(preset.key)
    if (result.success) setStats(result.data as Stats)
    return result
  }, [preset.key])

  const loadRows = useCallback(async (options: { silent?: boolean } = {}) => {
    // Тихая перезагрузка не сбрасывает список в состояние «Загрузка…»: иначе
    // страница схлопывается и оператора отбрасывает в начало списка.
    if (!options.silent) setLoading(true)
    else scrollSnapshotRef.current = captureScroll()
    const result = await listVideoMatchesAction({
      presetKey: preset.key,
      status: status as any,
      bands: status === 'pending' ? bands : undefined,
      onlySingleCandidate: status === 'pending' ? onlySingleCandidate : false,
      // В «Ждут решения» показываем только основной вариант, а в статусах-решениях —
      // все строки: оператор мог апрувить не первый вариант товара.
      onlyBest: status === 'pending' || status === 'all',
      search: search.trim() || undefined,
      limit: perPage,
      offset: (page - 1) * perPage,
    })
    if (result.success) {
      setRows((result.data?.rows || []) as Row[])
      setTotal(Number(result.data?.total || 0))
    } else {
      setError(result.error || 'Не удалось загрузить совпадения')
    }
    if (!options.silent) setLoading(false)
  }, [preset.key, status, bands, onlySingleCandidate, search, page, perPage])

  const refresh = useCallback(async () => {
    await Promise.all([loadStats(), loadRows()])
  }, [loadStats, loadRows])

  useEffect(() => { void refresh() }, [refresh])

  // Возврат к прежней позиции после тихой перезагрузки списка.
  useLayoutEffect(() => {
    const snapshot = scrollSnapshotRef.current
    if (!snapshot) return
    scrollSnapshotRef.current = null
    restoreScroll(snapshot)
  }, [rows])

  // Смена фильтров возвращает на первую страницу: иначе оператор остаётся
  // на несуществующем номере страницы и видит пустой список.
  const bandsKey = bands.join(',')
  useEffect(() => { setPage(1); setSelected(new Set()) }, [status, search, onlySingleCandidate, perPage, bandsKey])

  const loadMisses = useCallback(async () => {
    const result = await listVideoMatchMissesAction(preset.key, 60)
    if (result.success) setMisses((result.data || []) as Miss[])
  }, [preset.key])

  const runLoop = async (label: string, step: () => Promise<{ done: boolean; note: string }>) => {
    cancelRef.current = false
    setBusy(label)
    setError('')
    setMessage('')
    try {
      let guard = 0
      for (;;) {
        if (cancelRef.current) { setProgress('Остановлено оператором'); break }
        const result = await step()
        setProgress(result.note)
        if (result.done) break
        guard += 1
        if (guard > 4000) break
      }
      await refresh()
    } finally {
      setBusy('')
    }
  }

  const buildMatches = () => runLoop('build', async () => {
    let cursor: VideoMatchCursor | undefined
    let scanned = 0
    let candidates = 0
    for (;;) {
      const result = await buildVideoMatchesChunkAction(preset.key, cursor)
      if (!result.success) throw new Error(result.error || 'Ошибка сборки')
      const data = result.data
      scanned += Number(data.scanned || 0)
      candidates += Number(data.candidates || 0)
      setProgress(`Собрано: товаров ${scanned}, вариантов ${candidates}${data.category ? ` · ${data.category}` : ''}`)
      if (data.done) {
        setMessage(`Сборка завершена: ${scanned} товаров, ${candidates} вариантов`)
        return { done: true, note: `Готово: ${scanned} товаров, ${candidates} вариантов` }
      }
      cursor = data.next
    }
  }).catch((cause: any) => setError(cause?.message || 'Ошибка сборки'))

  const attachSupplier = () => runLoop('attach', async () => {
    let cursor: VideoMatchCursor | undefined
    let updated = 0
    let skipped = 0
    for (;;) {
      const result = await attachVideoMatchSupplierChunkAction(preset.key, cursor)
      if (!result.success) throw new Error(result.error || 'Ошибка закрепления поставщика')
      const data = result.data
      updated += Number(data.updated || 0)
      skipped += Number(data.skipped || 0)
      setProgress(`Поставщик «${preset.supplierName}»: обновлено ${updated}, уже стоит ${skipped}${data.category ? ` · ${data.category}` : ''}`)
      if (data.done) {
        setMessage(`Поставщик «${preset.supplierName}» закреплён: обновлено ${updated}, пропущено ${skipped}`)
        return { done: true, note: `Готово: обновлено ${updated}` }
      }
      cursor = data.next
    }
  }).catch((cause: any) => setError(cause?.message || 'Ошибка закрепления поставщика'))

  const applyApproved = () => runLoop('apply', async () => {
    let applied = 0
    let failed = 0
    for (;;) {
      const result = await applyApprovedVideoMatchesAction(preset.key, applyBatchSize)
      if (!result.success) throw new Error(result.error || 'Ошибка загрузки видео')
      const data = result.data
      applied += Number(data.applied || 0)
      failed += Number(data.failed || 0)
      setProgress(`Видео в S3 и в карточках: ${applied}${failed ? `, ошибок ${failed}` : ''}`)
      if (!data.processed) {
        setMessage(`Загрузка завершена: привязано ${applied}${failed ? `, ошибок ${failed}` : ''}`)
        return { done: true, note: `Готово: привязано ${applied}` }
      }
    }
  }).catch((cause: any) => setError(cause?.message || 'Ошибка загрузки видео'))

  const retryFailed = async () => {
    setBusy('bulk')
    setError('')
    const result = await retryFailedVideoMatchesAction(preset.key)
    if (result.success) setMessage(`Возвращено в очередь на заливку: ${result.data?.updated ?? 0}`)
    else setError(result.error || 'Не удалось вернуть ошибки в очередь')
    setBusy('')
    await Promise.all([loadStats(), loadRows({ silent: true })])
  }

  const bulkApprove = async (single: boolean) => {
    setBusy('bulk')
    setError('')
    const result = await bulkApproveVideoMatchesAction(preset.key, bands, single)
    if (result.success) setMessage(`Апрувнуто вариантов: ${result.data?.updated ?? 0}`)
    else setError(result.error || 'Ошибка массового апрува')
    setBusy('')
    await Promise.all([loadStats(), loadRows({ silent: true })])
  }

  const resetApproved = async () => {
    setBusy('bulk')
    setError('')
    const result = await resetApprovedVideoMatchesAction(preset.key)
    if (result.success) setMessage(`Возвращено в ожидание: ${result.data?.updated ?? 0}`)
    else setError(result.error || 'Не удалось сбросить апрув')
    setBusy('')
    await Promise.all([loadStats(), loadRows({ silent: true })])
  }

  /**
   * Решение по одной строке: список не перезагружаем — иначе карточки
   * размонтируются, страница схлопывается и скролл улетает наверх.
   * Строка сразу получает новый статус, а очередь обновится штатным «Обновить».
   */
  const decide = async (ids: number[], action: 'approve' | 'reject' | 'reset') => {
    if (ids.length === 0) return
    setBusy('decide')
    setError('')
    const runner = action === 'approve' ? approveVideoMatchesAction : action === 'reject' ? rejectVideoMatchesAction : resetVideoMatchesAction
    const result = await runner(ids)
    if (!result.success) setError(result.error || 'Ошибка решения')
    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending'
    setRows((current) => current.map((row) => (ids.includes(row.id) ? { ...row, status: nextStatus } : row)))
    setSelected(new Set())
    setBusy('')
    await loadStats()
  }

  const toggleSelected = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleBand = (band: string) => {
    setBands((current) => current.includes(band) ? current.filter((item) => item !== band) : [...current, band])
  }

  const counts = stats?.counts
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))

  // Сколько строк затронет массовый апрув при текущем наборе уровней.
  const approxBulkCount = (['exact', 'strong', 'probable', 'weak'] as const)
    .filter((band) => bands.includes(band))
    .reduce((sum, band) => sum + Number((counts as any)?.[band] || 0), 0)

  const selectionSummary = useMemo(() => `${selected.size} выбрано`, [selected])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Видео → товары</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Альбомы с видео из выгрузки «{preset.title}» сопоставляются с товарами каталога по стилю, цвету, размеру,
            коже и фурнитуре. Апрувнутое видео уезжает в S3 и прикрепляется к карточке товара.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={attachSupplier} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
            {busy === 'attach' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            1. Закрепить поставщика «{preset.supplierName}»
          </button>
          <button onClick={buildMatches} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy === 'build' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            2. Собрать совпадения
          </button>
          <button onClick={applyApproved} disabled={Boolean(busy) || !counts?.approved} className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
            {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            4. Загрузить апрувнутые ({counts?.approved ?? 0})
          </button>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400">
            параллельно
            <select
              value={applyBatchSize}
              onChange={(event) => setApplyBatchSize(Number(event.target.value))}
              disabled={Boolean(busy)}
              className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-xs text-white"
            >
              {[2, 4, 6].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          {(counts?.failed ?? 0) > 0 && (
            <button
              onClick={() => {
                if (!window.confirm(`Вернуть в очередь ${counts?.failed ?? 0} упавших заливок и попробовать снова?`)) return
                void retryFailed()
              }}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> Повторить ошибки ({counts?.failed ?? 0})
            </button>
          )}
          {busy && (
            <button onClick={() => { cancelRef.current = true }} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              Остановить
            </button>
          )}
        </div>
      </div>

      {(progress || message || error) && (
        <div className="space-y-1 text-xs">
          {progress && <p className="text-slate-400">{progress}</p>}
          {message && <p className="text-emerald-300">{message}</p>}
          {error && <p className="text-rose-300">{error}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Товаров в скоупе" value={stats?.scannedProducts ?? 0} hint={`вариантов всего: ${counts?.total ?? 0}`} />
        <StatCard
          label="Ждут решения"
          value={counts?.pending ?? 0}
          hint={`точных: ${counts?.exact ?? 0} · спорных: ${(counts?.strong ?? 0) + (counts?.probable ?? 0)} · запасных вариантов: ${counts?.pendingAlternatives ?? 0}`}
        />
        <StatCard label="Апрувнуто / привязано" value={`${counts?.approved ?? 0} / ${counts?.applied ?? 0}`} hint={counts?.failed ? `ошибок: ${counts.failed}` : 'ошибок нет'} />
        <StatCard label="Без совпадений" value={counts?.withoutCandidates ?? 0} hint={`альбомов с полями: ${stats?.albums ?? 0} из ${(stats?.albums ?? 0) + (stats?.albumsWithoutFields ?? 0)}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white">
          {STATUS_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
        </select>
        {status === 'pending' && (['exact', 'strong', 'probable', 'weak'] as const).map((band) => (
          <button
            key={band}
            onClick={() => toggleBand(band)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${bands.includes(band) ? BAND_STYLE[band] : 'border-slate-700 text-slate-500'}`}
          >
            {VIDEO_MATCH_BAND_LABELS[band]}
          </button>
        ))}
        {status === 'pending' && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={onlySingleCandidate} onChange={(event) => setOnlySingleCandidate(event.target.checked)} />
            только один вариант
          </label>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Название или slug"
            className="h-9 w-56 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 text-sm text-white"
          />
        </div>
        <button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
          <RefreshCw className="h-3.5 w-3.5" /> Обновить
        </button>
        <span className="ml-auto text-xs text-slate-500">{selectionSummary}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
        <span>
          Показано {total === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}
        </span>
        <label className="flex items-center gap-2">
          На странице
          <select
            value={perPage}
            onChange={(event) => setPerPage(Number(event.target.value))}
            className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-white"
          >
            {PER_PAGE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Назад
          </button>
          <span className="px-1">
            стр. {page} из {Math.max(1, Math.ceil(total / perPage))}
          </span>
          <button
            onClick={() => setPage((value) => value + 1)}
            disabled={page >= Math.ceil(total / perPage) || loading}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Вперёд
          </button>
        </div>
        <span className="w-full text-slate-500">
          Вариант в карточке — это предпросмотр: он применяется кнопкой «Апрувить» на этой карточке.
          Массовый апрув берёт вариант №1 у товаров, где решения ещё нет, и ручной выбор не перебивает.
        </span>
      </div>

      {status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              const scope = bands.length === 0
                ? 'уровни не выбраны'
                : `уровни: ${bands.map((band) => VIDEO_MATCH_BAND_LABELS[band] || band).join(', ')}`
              if (!window.confirm(`Апрувить основные варианты (${scope})? Затронуто товаров: ~${approxBulkCount}. Видео на сайт не уйдёт, пока не нажмёте «Загрузить апрувнутые».`)) return
              void bulkApprove(false)
            }}
            disabled={Boolean(busy) || bands.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> 3. Массово апрувить выбранные уровни ({approxBulkCount})
          </button>
          <button
            onClick={() => {
              if (!window.confirm(`Апрувить только товары с единственным вариантом (${counts?.singleCandidate ?? 0})?`)) return
              void bulkApprove(true)
            }}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            Только однозначные ({counts?.singleCandidate ?? 0})
          </button>
          <button onClick={() => void decide([...selected], 'approve')} disabled={Boolean(busy) || selected.size === 0} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
            Апрувить выбранные
          </button>
          <button onClick={() => void decide([...selected], 'reject')} disabled={Boolean(busy) || selected.size === 0} className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
            Отклонить выбранные
          </button>
          <button onClick={() => void decide([...selected], 'reset')} disabled={Boolean(busy) || selected.size === 0} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" />
          </button>
          {(counts?.approved ?? 0) > 0 && (
            <button
              onClick={() => {
                if (!window.confirm(`Вернуть в ожидание все апрувнутые варианты (${counts?.approved ?? 0})? Уже привязанные к товарам видео останутся на месте.`)) return
                void resetApproved()
              }}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> Сбросить апрув ({counts?.approved ?? 0})
            </button>
          )}
          <button
            onClick={() => { setShowMisses((value) => !value); if (!showMisses) void loadMisses() }}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <AlertTriangle className="h-4 w-4" /> Без совпадений ({counts?.withoutCandidates ?? 0})
          </button>
        </div>
      )}

      {showMisses && status === 'pending' && (
        <div className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {misses.length === 0 ? <p className="text-sm text-slate-500">Нет товаров без совпадений.</p> : misses.map((miss) => (
            <div key={miss.crm_product_id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-xs">
              <p className="font-semibold text-slate-200">{miss.crm_name || miss.crm_slug}</p>
              <p className="text-slate-500">{miss.crm_category} · {Object.entries(miss.crm_fields).filter(([, value]) => value).map(([key, value]) => `${FIELD_LABELS[key] || key}: ${value}`).join(' · ') || 'характеристики не разобраны'}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
          <p>Под текущий фильтр строк нет.</p>
          {status === 'pending' && (counts?.approved ?? 0) > 0 && (
            <p className="text-slate-400">
              Основные варианты уже апрувнуты ({(counts?.approved ?? 0).toLocaleString('ru-RU')}) — включите фильтр «Апрувнуты»
              или нажмите «Сбросить апрув», чтобы вернуть их в ожидание.
            </p>
          )}
          {status === 'pending' && (counts?.pending ?? 0) === 0 && (counts?.total ?? 0) === 0 && (
            <p className="text-slate-400">Совпадений ещё нет — нажмите «Собрать совпадения».</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())}
            />
            Выбрать все на странице
          </label>
          {rows.map((row) => (
            <MatchCard
              key={row.id}
              row={row}
              selected={selected.has(row.id)}
              onToggle={() => toggleSelected(row.id)}
              onDecide={decide}
              busy={Boolean(busy)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function MatchCard({ row, selected, onToggle, onDecide, busy }: {
  row: Row
  selected: boolean
  onToggle: () => void
  onDecide: (ids: number[], action: 'approve' | 'reject' | 'reset') => Promise<void>
  busy: boolean
}) {
  const [played, setPlayed] = useState(false)
  const [pickedId, setPickedId] = useState(row.id)
  const [note, setNote] = useState('')
  const picked = row.alternatives.find((item) => item.id === pickedId) || null
  const videoUrl = picked?.video_source_url || row.video_source_url
  const posterUrl = picked?.video_poster_url || row.video_poster_url || row.crm_photo_url
  const differences = row.differences

  // Решение по строке не перезагружает список: карточка остаётся на месте,
  // а результат виден подписью и бейджем статуса.
  const decide = async (ids: number[], action: 'approve' | 'reject' | 'reset', label: string) => {
    setNote(label)
    await onDecide(ids, action)
  }

  const statusLabel = row.status === 'approved' ? 'апрувнуто'
    : row.status === 'rejected' ? 'отклонено'
      : row.status === 'applied' ? 'видео привязано'
        : row.status === 'failed' ? 'ошибка заливки'
          : ''

  return (
    <article className={`rounded-xl border p-3 ${selected ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-40 shrink-0">
          {played ? (
            <video src={videoUrl} poster={posterUrl || undefined} controls autoPlay muted playsInline className="h-40 w-40 rounded-lg bg-black object-cover" />
          ) : (
            <button onClick={() => setPlayed(true)} className="group relative block h-40 w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
              {posterUrl ? <img src={posterUrl} alt="" className="h-full w-full object-cover opacity-90" /> : <span className="flex h-full items-center justify-center text-slate-600"><Film className="h-6 w-6" /></span>}
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100"><PlayCircle className="h-8 w-8 text-white" /></span>
            </button>
          )}
          <p className="mt-1 text-[10px] text-slate-500">Альбом с видео (rank {picked?.rank ?? row.rank})</p>
        </div>

        <div className="w-32 shrink-0">
          {row.crm_photo_url ? <img src={row.crm_photo_url} alt="" className="h-32 w-32 rounded-lg border border-slate-700 object-cover" /> : <span className="flex h-32 w-32 items-center justify-center rounded-lg border border-slate-700 text-slate-600"><ImageOff className="h-5 w-5" /></span>}
          <p className="mt-1 text-[10px] text-slate-500">Первое фото товара</p>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selected} onChange={onToggle} />
              <span className="text-sm font-semibold text-white">{row.crm_name || row.crm_slug}</span>
            </label>
            <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${BAND_STYLE[row.confidence] || BAND_STYLE.weak}`}>
              {VIDEO_MATCH_BAND_LABELS[row.confidence] || row.confidence} · {row.score}
            </span>
            <span className="text-xs text-slate-500">{row.crm_category} · {row.crm_status}{row.candidates_total > 1 ? ` · вариантов ${row.candidates_total}` : ' · единственный вариант'}</span>
            {statusLabel && (
              <span className={`rounded border px-2 py-0.5 text-[11px] ${row.status === 'rejected' || row.status === 'failed' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
                {statusLabel}
              </span>
            )}
            {note && <span className="text-[11px] text-emerald-300">{note}</span>}
            {row.error && <span className="text-xs text-rose-300">{row.error}</span>}
          </div>

          <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {differences.map((difference) => (
              <div key={difference.field} className="flex items-baseline gap-2">
                <span className="w-20 shrink-0 text-slate-500">{FIELD_LABELS[difference.field] || difference.field}</span>
                <span className={VERDICT_STYLE[difference.verdict] || 'text-slate-400'}>
                  {difference.catalog || '—'} <span className="text-slate-600">/</span> {difference.album || '—'}
                </span>
              </div>
            ))}
          </div>

          {row.alternatives.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-slate-500">Вариант:</span>
              {row.alternatives.map((alternative) => (
                <button
                  key={alternative.id}
                  onClick={() => { setPickedId(alternative.id); setPlayed(false); setNote('') }}
                  className={`rounded border px-2 py-0.5 text-[11px] ${pickedId === alternative.id ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                >
                  #{alternative.rank} · {alternative.score}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {row.status === 'applied' ? (
              row.s3_video_url && <a href={row.s3_video_url} target="_blank" rel="noreferrer" className="text-xs text-sky-300 underline">S3-видео</a>
            ) : (
              <>
                <button
                  onClick={() => void decide([pickedId], 'approve', pickedId === row.id ? 'апрувнуто' : `апрувнут вариант #${picked?.rank ?? ''}`)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Апрувить{pickedId !== row.id ? ' выбранный' : ''}
                </button>
                <button
                  onClick={() => void decide([row.id], 'reject', 'отклонено')}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Отклонить
                </button>
                {row.status !== 'pending' && (
                  <button
                    onClick={() => void decide([row.id], 'reset', 'возвращено в ожидание')}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> В ожидание
                  </button>
                )}
              </>
            )}
            <span className="text-[11px] text-slate-600">/{row.crm_slug}</span>
          </div>
        </div>
      </div>
    </article>
  )
}

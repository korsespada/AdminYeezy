'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles, Undo2, XCircle } from 'lucide-react'
import {
  applyRingMatchAction,
  getRingMatchOverviewAction,
  listDavidRingCandidatesAction,
  rejectRingMatchAction,
  resetRingMatchAction,
  runRingMatchBatchAction,
  setRingMatchCandidateAction,
  type RingMatchOverview,
  type RingMatchRow,
} from '@/actions/david-ring-match'

const STOREFRONT = 'https://chromoff.store'

const STATUS_LABEL: Record<string, string> = {
  new: 'не считалось',
  suggested: 'есть пара',
  no_match: 'нет совпадения',
  no_candidates: 'нет кандидатов',
  invalid_index: 'сбой разбора',
  error: 'ошибка',
  applied: 'применено',
  rejected: 'отклонено',
}

const STATUS_FILTERS = [
  { value: 'work', label: 'К работе' },
  { value: 'suggested', label: 'Есть пара' },
  { value: 'confident', label: 'Уверенные' },
  { value: 'no_match', label: 'Нет совпадения' },
  { value: 'no_candidates', label: 'Нет кандидатов' },
  { value: 'problems', label: 'Сбои' },
  { value: 'applied', label: 'Применённые' },
  { value: 'rejected', label: 'Отклонённые' },
  { value: 'all', label: 'Все' },
] as const

type FilterValue = (typeof STATUS_FILTERS)[number]['value']

function matchesFilter(row: RingMatchRow, filter: FilterValue) {
  if (filter === 'all') return true
  if (filter === 'work') return row.status === 'new' || row.status === 'suggested' || row.status === 'invalid_index' || row.status === 'error'
  if (filter === 'problems') return row.status === 'invalid_index' || row.status === 'error'
  if (filter === 'confident') return row.status === 'suggested' && Number(row.confidence || 0) >= 0.9
  return row.status === filter
}

function formatPrice(priceCents: number) {
  if (!priceCents) return 'цена не задана'
  return `${(priceCents / 100).toLocaleString('ru-RU')} ₽`
}

export default function DavidRingMatchPanel({ initial }: { initial: RingMatchOverview }) {
  const [overview, setOverview] = useState(initial)
  const [filter, setFilter] = useState<FilterValue>('work')
  const [log, setLog] = useState<string[]>([])
  const [batchSize, setBatchSize] = useState(3)
  const [running, startRun] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const stopRef = useRef(false)

  const push = useCallback((line: string) => {
    setLog((previous) => [line, ...previous].slice(0, 60))
  }, [])

  const refresh = useCallback(async () => {
    const result = await getRingMatchOverviewAction()
    if (result.success) setOverview(result.data)
    return result
  }, [])

  async function runBatch() {
    const result = await runRingMatchBatchAction({ limit: batchSize })
    if (!result.success) {
      push(`Ошибка подбора: ${result.error}`)
      return { remaining: 0, ok: false }
    }
    for (const item of result.data.results) {
      if (item.status === 'suggested') {
        push(`Пара: ${item.anchor} → ${item.davidTitle} (${Math.round(Number(item.confidence || 0) * 100)}%)`)
      } else if (item.status === 'no_match') {
        push(`Без пары: ${item.anchor}`)
      } else if (item.status === 'no_candidates') {
        push(`Нет кандидатов: ${item.anchor}`)
      } else {
        push(`Сбой: ${item.anchor} — ${item.error}`)
      }
    }
    await refresh()
    return { remaining: result.data.remaining, ok: true }
  }

  function startAutoRun() {
    stopRef.current = false
    startRun(async () => {
      let guard = 0
      while (!stopRef.current && guard < 60) {
        guard += 1
        const { remaining, ok } = await runBatch()
        if (!ok || remaining <= 0) break
      }
      push(stopRef.current ? 'Остановлено оператором' : 'Очередь подбора пуста')
    })
  }

  async function applyRow(row: RingMatchRow) {
    if (!row.matchId) return
    const confirmed = window.confirm(
      `Перенести название, описание, характеристики и фото David в старую карточку «${row.anchor.name}»?\n\nТовар David «${row.davidTitle}» будет удалён, а его URL получит 301 на старый. Цена старой карточки не меняется.`,
    )
    if (!confirmed) return
    setBusyId(row.matchId)
    try {
      const result = await applyRingMatchAction(row.matchId)
      if (result.success) {
        push(`Применено: ${row.anchor.name} — ${result.data.message}`)
      } else {
        push(`Не применено (${row.anchor.name}): ${result.error}`)
      }
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function rejectRow(row: RingMatchRow) {
    if (!row.matchId) return
    setBusyId(row.matchId)
    try {
      const result = await rejectRingMatchAction(row.matchId)
      push(result.message)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function resetRow(row: RingMatchRow) {
    if (!row.matchId) return
    setBusyId(row.matchId)
    try {
      const result = await resetRingMatchAction(row.matchId)
      push(result.message)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function pickCandidate(row: RingMatchRow, handle: string) {
    if (!row.matchId) return
    setBusyId(row.matchId)
    try {
      const result = await setRingMatchCandidateAction(row.matchId, handle)
      push(result.message)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const rows = useMemo(() => overview.rows.filter((row) => matchesFilter(row, filter)), [overview.rows, filter])
  const { stats } = overview

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">Дубли колец: старые ↔ David</h1>
            <span className="rounded bg-violet-500/15 px-2 py-0.5 text-xs text-violet-200">chromoff.store</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Старое кольцо остаётся каноном: у него живой URL, история и цена. ИИ ищет к нему ту же модель среди
            колец David, после чего название, описание, характеристики и фото переезжают в старую карточку, а дубль
            удаляется вместе с 301.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={running}
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Обновить
          </button>
          {running ? (
            <button
              type="button"
              onClick={() => { stopRef.current = true }}
              className="flex h-10 items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 text-sm text-rose-200"
            >
              <XCircle className="h-4 w-4" /> Остановить
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => startRun(async () => {
              const { remaining, ok } = await runBatch()
              if (!ok || remaining <= 0) push(stopRef.current ? 'Остановлено оператором' : 'Очередь подбора пуста')
            })}
            disabled={running}
            className="flex h-10 items-center gap-2 rounded-lg border border-violet-700/60 bg-violet-950/40 px-4 text-sm text-violet-100 hover:bg-violet-900/40 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Подобрать {batchSize}
          </button>
          <button
            type="button"
            onClick={startAutoRun}
            disabled={running}
            className="flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Подобрать всё
          </button>
          <select
            value={batchSize}
            onChange={(event) => setBatchSize(Number(event.target.value))}
            className="h-10 rounded-lg border border-slate-700 bg-slate-800 px-2 text-sm text-slate-200"
            aria-label="Размер партии"
          >
            {[1, 3, 5, 10].map((size) => <option key={size} value={size}>{size} за раз</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Старых колец" value={stats.anchors} />
        <Stat label="Моделей David" value={stats.candidates} />
        <Stat label="Посчитано" value={stats.processed} />
        <Stat label="Есть пара" value={stats.suggested} tone="violet" />
        <Stat label="Уверенных" value={stats.confident} tone="emerald" />
        <Stat label="Применено" value={stats.applied} tone="emerald" />
        <Stat label="Сбои" value={stats.errors + stats.invalidIndex} tone={stats.errors + stats.invalidIndex ? 'rose' : undefined} />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === item.value
                ? 'border-violet-500/60 bg-violet-500/15 text-violet-100'
                : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
        <span className="self-center text-xs text-slate-500">показано {rows.length} из {overview.rows.length}</span>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <RowCard
            key={row.anchor.listingId}
            row={row}
            busy={busyId === row.matchId}
            onApply={() => void applyRow(row)}
            onReject={() => void rejectRow(row)}
            onReset={() => void resetRow(row)}
            onPick={(handle) => void pickCandidate(row, handle)}
          />
        ))}
        {!rows.length ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/40 p-8 text-center text-sm text-slate-400">
            В этом фильтре пусто.
          </div>
        ) : null}
      </div>

      {log.length ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Журнал прогона</h2>
            <button type="button" onClick={() => setLog([])} className="text-xs text-slate-400 hover:text-slate-200">Очистить</button>
          </div>
          <div className="max-h-64 space-y-1 overflow-auto text-xs text-slate-400">
            {log.map((line, index) => <div key={index}>{line}</div>)}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'violet' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'violet' ? 'text-violet-200' : tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-slate-100'
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

function Photo({ url, alt }: { url?: string; alt: string }) {
  if (!url) {
    return <div className="h-16 w-16 shrink-0 rounded-lg border border-slate-700 bg-slate-800" />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="h-16 w-16 shrink-0 rounded-lg border border-slate-700 object-cover" loading="lazy" />
  )
}

function RowCard({
  row,
  busy,
  onApply,
  onReject,
  onReset,
  onPick,
}: {
  row: RingMatchRow
  busy: boolean
  onApply: () => void
  onReject: () => void
  onReset: () => void
  onPick: (handle: string) => void
}) {
  const confidence = row.confidence === null ? null : Math.round(row.confidence * 100)
  const canApply = row.status === 'suggested' && Boolean(row.davidHandle)
  const tone = row.status === 'applied'
    ? 'border-emerald-600/40'
    : row.status === 'error' || row.status === 'invalid_index'
      ? 'border-rose-600/40'
      : row.status === 'suggested'
        ? 'border-violet-600/40'
        : 'border-slate-700'

  return (
    <div className={`rounded-xl border ${tone} bg-slate-800/40 p-4`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex items-start gap-3">
          {row.anchor.photos.slice(0, 2).map((url, index) => (
            <Photo key={url + index} url={url} alt={row.anchor.name} />
          ))}
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-100">{row.anchor.name}</div>
            <div className="mt-1 text-xs text-slate-400">
              {formatPrice(row.anchor.priceCents)}
              {row.anchor.modelName ? ` · модель: ${row.anchor.modelName}` : ''}
            </div>
            <a
              href={`${STOREFRONT}/product/${row.anchor.slug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
            >
              /product/{row.anchor.slug.slice(0, 42)}… <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="text-slate-500">→</div>

        <div className="flex items-start gap-3">
          {row.davidPhotos.slice(0, 2).map((url, index) => (
            <Photo key={url + index} url={url} alt={row.davidTitle} />
          ))}
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-100">
              {row.davidTitle || (row.davidHandle ? row.davidHandle : 'модель не найдена')}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {row.davidHandle || '—'}
              {row.davidHandle ? (row.davidCreated ? ' · карточка создана' : ' · карточка не создана') : ''}
            </div>
            {row.status === 'suggested' && confidence !== null ? (
              <div className={`mt-1 inline-flex items-center gap-1 text-xs ${confidence >= 90 ? 'text-emerald-300' : 'text-amber-300'}`}>
                {confidence >= 90 ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                уверенность {confidence}%
              </div>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex flex-col items-end gap-2">
          <span className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-300">
            {STATUS_LABEL[row.status] || row.status}
          </span>
          <div className="flex gap-2">
            {canApply ? (
              <button
                type="button"
                onClick={onApply}
                disabled={busy}
                className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Применить
              </button>
            ) : null}
            {row.matchId && row.status !== 'applied' && row.status !== 'rejected' ? (
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                className="flex h-9 items-center gap-2 rounded-lg border border-slate-600 px-3 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Отклонить
              </button>
            ) : null}
            {row.matchId ? (
              <button
                type="button"
                onClick={onReset}
                disabled={busy}
                className="flex h-9 items-center gap-2 rounded-lg border border-slate-600 px-3 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" /> Пересчитать
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {row.evidence ? (
        <p className="mt-3 rounded-lg bg-slate-900/50 p-2 text-xs text-slate-400">ИИ: {row.evidence}</p>
      ) : null}
      {row.error ? (
        <p className="mt-3 rounded-lg border border-rose-600/30 bg-rose-950/30 p-2 text-xs text-rose-200">{row.error}</p>
      ) : null}

      {row.shortlist.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
            Что видела ИИ: кандидаты по названию и модели ({row.shortlist.length})
          </summary>
          <div className="mt-2 space-y-1 rounded-lg border border-slate-700 bg-slate-900/40 p-1">
            {row.shortlist.map((entry) => (
              <div key={entry.handle} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                <span className="truncate text-slate-300">
                  {entry.title}
                  <span className="ml-2 text-slate-500">{entry.shared.join(', ')}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-slate-500">{entry.handle}{entry.created ? ' · создана' : ''}</span>
                  {row.status !== 'applied' && row.matchId ? (
                    <button
                      type="button"
                      onClick={() => onPick(entry.handle)}
                      disabled={busy}
                      className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                    >
                      выбрать
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {row.matchId && row.status !== 'applied' ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
            Заменить модель вручную (вся выгрузка David)
          </summary>
          <div className="mt-2">
            <CandidateList onPick={onPick} disabled={busy} />
          </div>
        </details>
      ) : null}
    </div>
  )
}

/**
 * Полный список моделей David для ручной замены пары — когда ИИ ошиблась или
 * верного кандидата не было в коротком списке.
 */
function CandidateList({ onPick, disabled }: { onPick: (handle: string) => void; disabled: boolean }) {
  const [items, setItems] = useState<Array<{ handle: string; title: string; created: boolean; photos: number }> | null>(null)
  const [error, setError] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void (async () => {
      const result = await listDavidRingCandidatesAction()
      if (result.success) setItems(result.data)
      else setError(result.error)
    })()
  }, [])

  if (error) return <p className="text-xs text-rose-300">{error}</p>
  if (!items) return <p className="text-xs text-slate-500">Загрузка моделей…</p>

  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-900/40">
      {items.map((item) => (
        <button
          key={item.handle}
          type="button"
          disabled={disabled}
          onClick={() => onPick(item.handle)}
          className="flex w-full items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5 text-left text-xs text-slate-300 last:border-b-0 hover:bg-slate-800 disabled:opacity-50"
        >
          <span className="truncate">{item.title}</span>
          <span className="shrink-0 text-slate-500">{item.handle} · фото {item.photos}{item.created ? ' · создана' : ''}</span>
        </button>
      ))}
      {!items.length ? <p className="p-3 text-xs text-slate-500">Модели David не найдены в выгрузке.</p> : null}
    </div>
  )
}

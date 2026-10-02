'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, ImageOff, Loader2, Pause, RefreshCw, Save, Search, Sparkles, Trash2, Upload, XCircle } from 'lucide-react'
import {
  applyProductCardsChunkAction,
  approveSafeProductCardsAction,
  clearPendingProductCardsAction,
  decideProductCardsAction,
  getProductCardPromptAction,
  getProductCardStatsAction,
  getProductCardsAiRunAction,
  listProductCardSuppliersAction,
  listProductCardsAction,
  runProductCardsAiAction,
  saveProductCardPromptAction,
  scanProductCardsChunkAction,
  startProductCardsAiRunAction,
  stopProductCardsAiRunAction,
  type ProductCardCursor,
} from '@/actions/product-card-updates'
import type { CardAiStatus, CardKind, CardUpdateStatus } from '@/lib/product-card-updates'

/**
 * Обработка уже опубликованных карточек поставщика по правилам выгрузки.
 *
 * Две страницы, как в «Выгрузках»: список поставщиков с прогрессом ИИ и
 * открытие поставщика — карточки товаров с фильтрами, промптом поставщика и
 * кнопками скана, ИИ и применения. До апрува оператора в Rails ничего не уходит.
 */

type CardCounts = {
  total: number; pending: number; approved: number; applied: number; rejected: number; failed: number
  bags: number; shoes: number; aiReady: number; aiPending: number; aiFailed: number; withWarnings: number
}

type SupplierRow = {
  key: string
  title: string
  supplierName: string
  brandSlug: string
  categories: number
  counts: CardCounts
  promptStored: boolean
  promptLength: number
}

type CardRow = {
  id: number
  crm_product_id: string
  current_name: string | null
  current_slug: string | null
  current_description: string | null
  current_media: Array<{ original_url: string; alt_text?: string }>
  proposed_name: string | null
  proposed_slug: string | null
  proposed_description: string | null
  proposed_photo_alts: string[]
  attribute_patch: Record<string, unknown>
  warnings: string[]
  category: string | null
  kind: string
  status: string
  ai_status: string
  ai_model: string | null
  ai_error: string | null
  error: string | null
}

type PromptState = {
  supplierName: string
  stored: string
  fallback: string
  effective: string
  packagingStored: string
  packagingFallback: string
  packaging: string
}

type AiRunState = {
  run: {
    status: string
    batch_size: number
    processed: number
    failed: number
    model: string | null
    started_at: string | null
    heartbeat_at: string | null
    finished_at: string | null
    last_error: string | null
  } | null
  active: boolean
  remaining: number
  aiReady: number
  aiFailed: number
}

const STATUS_FILTERS: Array<{ value: CardUpdateStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Ждут решения' },
  { value: 'approved', label: 'Апрувнуты' },
  { value: 'applied', label: 'Применены' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'failed', label: 'Ошибки' },
  { value: 'all', label: 'Все' },
]

const KIND_FILTERS: Array<{ value: CardKind | 'all'; label: string }> = [
  { value: 'all', label: 'Всё' },
  { value: 'bag', label: 'Сумки' },
  { value: 'shoe', label: 'Обувь' },
]

const AI_FILTERS: Array<{ value: CardAiStatus | 'all'; label: string }> = [
  { value: 'all', label: 'ИИ: любой' },
  { value: 'ready', label: 'ИИ обработано' },
  { value: 'pending', label: 'ИИ ждёт' },
  { value: 'failed', label: 'ИИ ошибки' },
]

const ATTRIBUTE_LABELS: Record<string, string> = {
  model_name: 'Модель',
  hardware_color: 'Цвет фурнитуры',
  dimensions: 'Габариты',
  bag_width_cm: 'Ширина, см',
  bag_height_cm: 'Высота, см',
  upper_material: 'Материал верха',
  sole_material: 'Материал подошвы',
  lining_material: 'Материал подкладки',
  heel_height: 'Высота каблука, см',
  materials: 'Материалы',
  colors: 'Цвета',
}

const SCAN_CHUNKS_PER_CLICK = 10
const APPLY_CHUNKS_PER_CLICK = 5
const AI_PER_CLICK = 3

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.display_value ?? record.value ?? record.label ?? JSON.stringify(value))
  }
  return String(value)
}

export default function ProductCardsApp() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const loadSuppliers = useCallback(async () => {
    setBusy('load')
    try {
      const result = await listProductCardSuppliersAction()
      if (result.success) setSuppliers((result.data as { suppliers: SupplierRow[] }).suppliers)
      else setError(result.error || 'Не удалось загрузить поставщиков')
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => { void loadSuppliers() }, [loadSuppliers])

  if (!openedKey) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Карточки по правилам выгрузки</h1>
            <p className="mt-1 text-sm text-slate-400">
              Уже опубликованные товары поставщика: название, характеристики, описание и альты по правилам выгрузки.
              Выгрузки и альбомы не затрагиваются.
            </p>
          </div>
          <button onClick={() => void loadSuppliers()} disabled={busy === 'load'} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            {busy === 'load' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
        </div>

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="space-y-2">
          {suppliers.map((supplier) => (
            <button
              key={supplier.key}
              onClick={() => setOpenedKey(supplier.key)}
              className="flex w-full flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left hover:border-indigo-500/50 hover:bg-slate-900"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{supplier.supplierName}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {supplier.title} · категорий {supplier.categories} · промпт:
                  {' '}{supplier.promptStored ? `свой (${supplier.promptLength} знаков)` : 'подсказка по умолчанию'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="text-slate-400">в очереди <span className="text-slate-100">{supplier.counts.total}</span></span>
                <span className="text-slate-400">ждут <span className="text-slate-100">{supplier.counts.pending}</span></span>
                <span className="text-emerald-300">ИИ готово {supplier.counts.aiReady}</span>
                <span className="text-slate-400">ИИ ждёт {supplier.counts.aiPending}</span>
                {supplier.counts.aiFailed > 0 && <span className="text-rose-300">ИИ ошибок {supplier.counts.aiFailed}</span>}
                {supplier.counts.withWarnings > 0 && <span className="text-amber-300">спорных {supplier.counts.withWarnings}</span>}
              </div>
              <ChevronRight className="h-4 w-4 text-slate-500" />
            </button>
          ))}
          {suppliers.length === 0 && !error && (
            <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              Поставщиков нет. Добавьте пресет в <code>lib/product-card-presets.ts</code>.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <SupplierCards
      presetKey={openedKey}
      onBack={() => { setOpenedKey(null); void loadSuppliers() }}
    />
  )
}

function SupplierCards({ presetKey, onBack }: { presetKey: string; onBack: () => void }) {
  const [stats, setStats] = useState<{ counts: CardCounts } | null>(null)
  const [rows, setRows] = useState<CardRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<CardUpdateStatus | 'all'>('pending')
  const [kind, setKind] = useState<CardKind | 'all'>('all')
  const [aiStatus, setAiStatus] = useState<CardAiStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [failures, setFailures] = useState<string[]>([])
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [packagingDraft, setPackagingDraft] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [aiRun, setAiRun] = useState<AiRunState | null>(null)

  const loadStats = useCallback(async () => {
    const result = await getProductCardStatsAction(presetKey)
    if (result.success) setStats(result.data as { counts: CardCounts })
  }, [presetKey])

  const loadPrompt = useCallback(async () => {
    const result = await getProductCardPromptAction(presetKey)
    if (result.success) {
      const data = result.data as PromptState
      setPrompt(data)
      setPromptDraft(data.stored || data.fallback)
      setPackagingDraft(data.packagingStored || data.packagingFallback)
    }
  }, [presetKey])

  const loadRows = useCallback(async () => {
    const result = await listProductCardsAction({ presetKey, status, kind, aiStatus, search, limit: 50 })
    if (result.success) {
      setRows((result.data as { rows: CardRow[] }).rows)
      setTotal((result.data as { total: number }).total)
    } else {
      setNote(result.error || 'Не удалось загрузить очередь')
    }
  }, [presetKey, status, kind, aiStatus, search])

  useEffect(() => { void loadStats(); void loadPrompt() }, [loadStats, loadPrompt])
  useEffect(() => { void loadRows() }, [loadRows])

  const loadAiRun = useCallback(async () => {
    const result = await getProductCardsAiRunAction(presetKey)
    if (result.success) setAiRun(result.data as AiRunState)
  }, [presetKey])

  useEffect(() => { void loadAiRun() }, [loadAiRun])

  // Пока фоновый прогон идёт, раз в пять секунд обновляем прогресс и очередь.
  const runStatus = aiRun?.run?.status
  useEffect(() => {
    if (runStatus !== 'running') return
    const timer = setInterval(() => {
      void loadAiRun()
      void loadStats()
      void loadRows()
    }, 5000)
    return () => clearInterval(timer)
  }, [runStatus, loadAiRun, loadStats, loadRows])

  const startAiRun = async () => {
    setBusy('ai-run')
    setNote('')
    try {
      const result = await startProductCardsAiRunAction(presetKey, 4)
      if (!result.success) setNote(result.error || 'Не удалось запустить прогон ИИ')
      else setNote('Прогон ИИ по всем карточкам запущен: вкладку можно закрыть, обработка идёт на сервере')
      await Promise.all([loadAiRun(), loadStats()])
    } finally {
      setBusy('')
    }
  }

  const stopAiRun = async () => {
    setBusy('ai-run')
    try {
      await stopProductCardsAiRunAction(presetKey)
      setNote('Прогон ИИ остановлен')
      await loadAiRun()
    } finally {
      setBusy('')
    }
  }

  const runScan = async () => {
    setBusy('scan')
    setNote('')
    let cursor: ProductCardCursor | null = { categoryIndex: 0, page: 1 }
    let scanned = 0
    let saved = 0
    try {
      for (let index = 0; index < SCAN_CHUNKS_PER_CLICK && cursor; index += 1) {
        const result = await scanProductCardsChunkAction(presetKey, cursor)
        if (!result.success) { setNote(result.error || 'Сбой сканирования'); break }
        const data = result.data as { next: ProductCardCursor | null; scanned: number; saved: number; category?: string }
        scanned += data.scanned
        saved += data.saved
        cursor = data.next
        setNote(`Сканирование: ${data.category || ''}, обработано ${scanned}, записано ${saved}`)
      }
      await Promise.all([loadStats(), loadRows()])
      setNote(`Сканирование завершено: обработано ${scanned}, записано ${saved}${cursor ? ' (нажмите ещё раз, чтобы продолжить)' : ''}`)
    } finally {
      setBusy('')
    }
  }

  const runAi = async (ids: number[] = []) => {
    setBusy('ai')
    setNote('')
    try {
      const result = await runProductCardsAiAction(presetKey, ids, ids.length > 0 ? ids.length : AI_PER_CLICK)
      if (!result.success) { setNote(result.error || 'Сбой ИИ'); return }
      const data = result.data as { processed: number; ready: number; failed: number; failures: string[]; model?: string; promptSource?: string }
      setFailures(data.failures || [])
      setNote(`ИИ (${data.model || ''}, промпт: ${data.promptSource === 'supplier' ? 'поставщика' : 'по умолчанию'}): обработано ${data.processed}, готово ${data.ready}, ошибок ${data.failed}`)
      await Promise.all([loadStats(), loadRows()])
    } finally {
      setBusy('')
    }
  }

  const applyApproved = async () => {
    setBusy('apply')
    setNote('')
    try {
      let applied = 0
      let failed = 0
      const collected: string[] = []
      for (let index = 0; index < APPLY_CHUNKS_PER_CLICK; index += 1) {
        const result = await applyProductCardsChunkAction(presetKey, 10)
        if (!result.success) { setNote(result.error || 'Сбой применения'); break }
        const data = result.data as { processed: number; applied: number; failed: number; failures: string[] }
        applied += data.applied
        failed += data.failed
        collected.push(...(data.failures || []))
        setNote(`Применение: ${applied} записано, ошибок ${failed}`)
        if (data.processed === 0) break
      }
      setFailures(collected)
      await Promise.all([loadStats(), loadRows()])
      setNote(`Применение завершено: ${applied} записано, ошибок ${failed}`)
    } finally {
      setBusy('')
    }
  }

  const decide = async (ids: number[], action: 'approve' | 'reject' | 'reset') => {
    setBusy('decide')
    try {
      const result = await decideProductCardsAction(ids, action)
      if (!result.success) setNote(result.error || 'Не удалось сохранить решение')
      else setSelected([])
      await Promise.all([loadStats(), loadRows()])
    } finally {
      setBusy('')
    }
  }

  const approveAllSafe = async () => {
    setBusy('bulk')
    try {
      const result = await approveSafeProductCardsAction(presetKey, kind)
      if (!result.success) setNote(result.error || 'Сбой массового апрува')
      else setNote(`Апрувнуто без спорных: ${(result.data as { updated: number }).updated}`)
      await Promise.all([loadStats(), loadRows()])
    } finally {
      setBusy('')
    }
  }

  const clearQueue = async () => {
    setBusy('clear')
    try {
      const result = await clearPendingProductCardsAction(presetKey)
      if (!result.success) setNote(result.error || 'Сбой очистки')
      else setNote(`Удалено строк: ${(result.data as { deleted: number }).deleted}`)
      await Promise.all([loadStats(), loadRows()])
    } finally {
      setBusy('')
    }
  }

  const savePrompt = async () => {
    setBusy('prompt')
    try {
      const result = await saveProductCardPromptAction(presetKey, promptDraft, packagingDraft)
      if (!result.success) setNote(result.error || 'Не удалось сохранить промпт')
      else setNote('Промпт поставщика сохранён')
      await Promise.all([loadPrompt(), loadStats()])
    } finally {
      setBusy('')
    }
  }

  const counts = stats?.counts

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
            <ArrowLeft className="h-3.5 w-3.5" /> Поставщики
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{prompt?.supplierName || 'Поставщик'}</h1>
            <p className="mt-1 text-xs text-slate-400">
              Название с моделью, размером и цветом Hermes, характеристики, описание и альты. До апрува в Rails ничего не уходит.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void runScan()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            {busy === 'scan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Собрать карточки
          </button>
          <button onClick={() => void runAi(selected)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/50 px-3 py-2 text-xs text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50">
            {busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {selected.length ? `ИИ по выбранным (${selected.length})` : `ИИ по ${AI_PER_CLICK}`}
          </button>
          {runStatus === 'running' ? (
            <button onClick={() => void stopAiRun()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-amber-500/50 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">
              {busy === 'ai-run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />} Пауза ИИ
            </button>
          ) : (
            <button onClick={() => void startAiRun()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {busy === 'ai-run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} ИИ по всем
            </button>
          )}
          <button onClick={() => void approveAllSafe()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            <CheckCircle2 className="h-3.5 w-3.5" /> Апрувить без спорных
          </button>
          <button onClick={() => void applyApproved()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
            {busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Применить апрувнутые
          </button>
          <button onClick={() => void clearQueue()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Очистить несогласованные
          </button>
          <button onClick={() => setShowPrompt((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">
            {showPrompt ? 'Скрыть промпт' : 'Промпт поставщика'}
          </button>
        </div>
      </div>

      {showPrompt && prompt && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs text-slate-400">
            Промпт поставщика добавляется к обязательным требованиям и правилам каталога.
            Сейчас используется: {prompt.stored.trim() ? 'сохранённый текст' : 'подсказка по умолчанию (Hermes)'}.
          </p>
          <textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            rows={12}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200 outline-none"
          />
          <p className="text-xs text-slate-400">
            Комплектация и упаковка: этот текст добавляется к описанию отдельным абзацем,
            поэтому модель про упаковку не пишет. Сейчас: {prompt.packagingStored.trim() ? 'сохранённый текст' : 'подсказка Hermes'}.
          </p>
          <textarea
            value={packagingDraft}
            onChange={(event) => setPackagingDraft(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200 outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void savePrompt()} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {busy === 'prompt' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить
            </button>
            <button onClick={() => { setPromptDraft(prompt.fallback); setPackagingDraft(prompt.packagingFallback) }} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
              Вернуть подсказки Hermes
            </button>
            <button onClick={() => { setPromptDraft(''); setPackagingDraft('') }} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
              Очистить (использовать подсказки)
            </button>
            <button onClick={() => { setPromptDraft(prompt.effective); setPackagingDraft(prompt.packaging) }} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
              Показать действующие
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="В очереди" value={counts?.total ?? 0} hint={`сумки ${counts?.bags ?? 0}, обувь ${counts?.shoes ?? 0}`} />
        <StatCard label="Ждут решения" value={counts?.pending ?? 0} hint={`спорных: ${counts?.withWarnings ?? 0}`} />
        <StatCard label="Апрувнуто / применено" value={`${counts?.approved ?? 0} / ${counts?.applied ?? 0}`} hint={counts?.failed ? `ошибок: ${counts.failed}` : 'ошибок нет'} />
        <StatCard label="ИИ обработано" value={counts?.aiReady ?? 0} hint={`осталось ${counts?.aiPending ?? 0}, ошибок ${counts?.aiFailed ?? 0}`} />
      </div>

      {aiRun?.run && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 text-xs text-indigo-100">
          <span className="font-semibold">Прогон ИИ по всем:</span>
          <span>
            {aiRun.run.status === 'running'
              ? (aiRun.active ? 'идёт' : 'запущен, цикл поднимается')
              : aiRun.run.status === 'finished' ? 'завершён'
                : aiRun.run.status === 'stopped' ? 'остановлен'
                  : aiRun.run.status === 'interrupted' ? 'прерван' : aiRun.run.status}
          </span>
          <span>обработано {aiRun.run.processed}</span>
          <span>ошибок {aiRun.run.failed}</span>
          <span>осталось {aiRun.remaining}</span>
          {aiRun.run.model && <span>модель {aiRun.run.model}</span>}
          {aiRun.run.last_error && <span className="text-rose-300">последняя ошибка: {aiRun.run.last_error}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(event) => setStatus(event.target.value as CardUpdateStatus | 'all')} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
          {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select value={kind} onChange={(event) => setKind(event.target.value as CardKind | 'all')} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
          {KIND_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select value={aiStatus} onChange={(event) => setAiStatus(event.target.value as CardAiStatus | 'all')} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
          {AI_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-300">
          <Search className="h-3.5 w-3.5" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название или адрес" className="w-56 bg-transparent text-xs text-slate-100 outline-none" />
        </label>
        {selected.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-slate-300">
            выбрано {selected.length}
            <button onClick={() => void decide(selected, 'approve')} disabled={Boolean(busy)} className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 hover:bg-emerald-500/10">Апрувить</button>
            <button onClick={() => void decide(selected, 'reject')} disabled={Boolean(busy)} className="rounded border border-rose-500/40 px-2 py-1 text-rose-300 hover:bg-rose-500/10">Отклонить</button>
            <button onClick={() => void decide(selected, 'reset')} disabled={Boolean(busy)} className="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800">В ожидание</button>
          </span>
        )}
        <span className="text-xs text-slate-500">показано {rows.length} из {total}</span>
        {note && <span className="text-xs text-emerald-300">{note}</span>}
      </div>

      {failures.length > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-200">
          <p className="font-semibold">Ошибки применения и ИИ</p>
          <ul className="mt-1 space-y-1">
            {failures.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <CardItem
            key={row.id}
            row={row}
            selected={selected.includes(row.id)}
            busy={Boolean(busy)}
            onToggle={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])}
            onDecide={decide}
            onRunAi={() => void runAi([row.id])}
          />
        ))}
        {rows.length === 0 && (
          <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            По фильтру ничего нет. Нажмите «Собрать карточки», чтобы прочитать товары поставщика из каталога.
          </p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}

function CardItem({ row, selected, busy, onToggle, onDecide, onRunAi }: {
  row: CardRow
  selected: boolean
  busy: boolean
  onToggle: () => void
  onDecide: (ids: number[], action: 'approve' | 'reject' | 'reset') => Promise<void>
  onRunAi: () => void
}) {
  const [showDescription, setShowDescription] = useState(false)
  const patch = Object.entries(row.attribute_patch || {})
  const statusLabel = row.status === 'approved' ? 'апрувнуто'
    : row.status === 'applied' ? 'применено'
      : row.status === 'rejected' ? 'отклонено'
        : row.status === 'failed' ? 'ошибка применения'
          : ''
  const aiLabel = row.ai_status === 'ready' ? `ИИ готово${row.ai_model ? ` · ${row.ai_model}` : ''}`
    : row.ai_status === 'failed' ? 'ИИ ошибка'
      : 'ИИ ждёт'

  return (
    <article className={`rounded-xl border p-3 ${selected ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-24 shrink-0">
          {row.current_media?.[0]?.original_url
            ? <img src={row.current_media[0].original_url} alt="" className="h-24 w-24 rounded-lg border border-slate-700 object-cover" />
            : <span className="flex h-24 w-24 items-center justify-center rounded-lg border border-slate-700 text-slate-600"><ImageOff className="h-5 w-5" /></span>}
          <p className="mt-1 text-[10px] text-slate-500">фото: {row.current_media?.length ?? 0}</p>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={selected} onChange={onToggle} />
              <span className="text-sm font-semibold text-white">{row.current_name || row.current_slug}</span>
            </label>
            <span className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">{row.category}</span>
            <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">{row.kind === 'bag' ? 'сумка' : 'обувь'}</span>
            <span className={`rounded border px-2 py-0.5 text-[11px] ${row.ai_status === 'ready' ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200' : row.ai_status === 'failed' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-slate-700 text-slate-400'}`}>{aiLabel}</span>
            {statusLabel && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">{statusLabel}</span>}
            {row.error && <span className="text-[11px] text-rose-300">{row.error}</span>}
          </div>

          <div className="grid gap-x-4 gap-y-1 text-xs text-slate-300 sm:grid-cols-2">
            <div><span className="text-slate-500">Название: </span>{row.current_name || '—'} <span className="text-slate-600">→</span> <span className="text-emerald-300">{row.proposed_name || '—'}</span></div>
            <div className="break-all"><span className="text-slate-500">Адрес: </span>{row.current_slug || '—'} <span className="text-slate-600">→</span> <span className="text-emerald-300">{row.proposed_slug || '—'}</span></div>
          </div>

          {patch.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              {patch.map(([key, value]) => (
                <span key={key}>{ATTRIBUTE_LABELS[key] || key}: <span className="text-slate-200">{valueLabel(value)}</span></span>
              ))}
            </div>
          )}

          {row.warnings.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>{row.warnings.join('; ')}</span>
            </div>
          )}
          {row.ai_error && <p className="text-[11px] text-rose-300">ИИ: {row.ai_error}</p>}

          {row.proposed_description && (
            <div className="text-xs text-slate-400">
              <button onClick={() => setShowDescription((value) => !value)} className="text-[11px] text-sky-300 underline">
                {showDescription ? 'Скрыть' : 'Показать'} описание и альты
              </button>
              <span className="ml-2 text-[11px] text-slate-500">
                {row.ai_status === 'ready' ? 'описание заменит текущее' : 'черновик: без ИИ описание не меняется'}
              </span>
              {showDescription && (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2">
                  <p className="whitespace-pre-line text-slate-300">{row.proposed_description}</p>
                  <ul className="space-y-1">
                    {row.proposed_photo_alts.map((alt, index) => (
                      <li key={`${row.id}-${index}`} className="text-[11px] text-slate-400">{index + 1}. {alt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {row.status === 'applied' ? (
              <span className="text-[11px] text-emerald-300">Записано в Rails</span>
            ) : (
              <>
                <button onClick={() => void onDecide([row.id], 'approve')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Апрувить
                </button>
                <button onClick={() => void onDecide([row.id], 'reject')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                  <XCircle className="h-3.5 w-3.5" /> Отклонить
                </button>
                <button onClick={onRunAi} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/50 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50">
                  <Sparkles className="h-3.5 w-3.5" /> ИИ по карточке
                </button>
                {row.status !== 'pending' && (
                  <button onClick={() => void onDecide([row.id], 'reset')} disabled={busy} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
                    Вернуть в ожидание
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

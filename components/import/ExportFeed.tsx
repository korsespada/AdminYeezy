'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Archive,
  ArchiveX,
  BadgeRussianRuble,
  Bot,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Star,
  Trash2,
} from 'lucide-react'
import {
  deleteBatchAction,
  deleteExportBatchFromAdminAction,
  deleteExportFileFromAdminAction,
  reorderSuppliersAction,
  type ExportHistoryBatch,
  type ExportHistoryFile,
} from '@/actions/suppliers'
import { restoreMissingRawSnapshotAction } from '@/actions/csv-import'
import { startBatchAiAction, stopBatchAiRunAction } from '@/actions/batch-ai'
import SupplierList, { type SupplierListApi, type SupplierListItem } from '@/components/inventory/SupplierList'
import CsvModal from './CsvModal'
import SupplierPriceRulesDialog from './SupplierPriceRulesDialog'
import { batchStatusProgress, batchSubtitle, canDeletePublishedCatalog, shouldOpenBatchArtifactAsFile } from '@/lib/batch-history'
import {
  BATCH_FEED_LABELS,
  PRODUCT_BUCKETS,
  RUNNING_KINDS,
  STALE_DAYS,
  batchErrorMessage,
  batchFeedKind,
  batchProductCount,
  buildSupplierFeedRows,
  daysSinceExport,
  formatRelativeTime,
  isAiRunning,
  moveFeedKey,
  sortFeedRows,
  type BatchFeedKind,
  type FeedSort,
  type ProductBucket,
  type SupplierFeedRow,
} from '@/lib/export-feed'
import { imagePresets, resizeImageUrl } from '@/lib/image'

type CatalogLookups = React.ComponentProps<typeof SupplierList>['catalogLookups']
type FeedRow = SupplierFeedRow<SupplierListItem>

type ModalState = {
  localPath: string
  rawPath?: string | null
  aiPath?: string | null
  supplierId: number | null
  batchId: string | null
  snapshotId?: string | null
  supplierName: string | null
  supplierAvatar: string | null
  forceFileMode?: boolean
}

const KIND_STYLES: Record<BatchFeedKind, string> = {
  scraping: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  raw: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  script: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
  ai_running: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  ready: 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200',
  publishing: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  pushed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  archived: 'border-slate-600 bg-slate-700/30 text-slate-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
  deleted: 'border-rose-500/20 bg-rose-500/5 text-rose-300/80',
}

const FILE_STATUS_STYLES: Record<string, string> = {
  'Сырой товар': 'border-cyan-500/30 text-cyan-200',
  'Обработан скриптом': 'border-orange-500/40 text-orange-200',
  'Обработано ИИ': 'border-violet-500/30 text-violet-200',
  'Запущено': 'border-teal-500/30 text-teal-200',
  failed: 'border-red-500/40 text-red-300',
}

const BUCKET_COLORS: Record<ProductBucket, string> = {
  site: 'bg-emerald-500',
  push: 'bg-sky-400',
  ready: 'bg-indigo-400',
  ai: 'bg-violet-400 animate-pulse',
  script: 'bg-orange-400',
  raw: 'bg-cyan-400',
  err: 'bg-red-400',
  arch: 'bg-slate-500',
}

const SORT_LABELS: Record<FeedSort, string> = {
  manual: 'Свой порядок (перетаскивание)',
  attention: 'Сначала требующие действия',
  recent: 'Последняя выгрузка: новые сверху',
  oldest: 'Дольше всего без выгрузки',
  name: 'По названию',
}

const ROW_GRID = 'xl:grid-cols-[48px_minmax(220px,1.4fr)_130px_minmax(210px,1.2fr)_minmax(230px,1.5fr)_auto]'

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('ru-RU')
}

const fmt = (value: number) => value.toLocaleString('ru-RU')

function batchProgress(batch: ExportHistoryBatch, kind: BatchFeedKind) {
  return batchStatusProgress({
    publishing: kind === 'publishing',
    aiRunning: kind === 'ai_running',
    activeOperation: batch.active_operation,
    aiCompletedCount: batch.ai_completed_count,
    aiFailedCount: batch.ai_failed_count,
    aiTotalCount: batch.ai_total_count,
  })
}

function progressRatio(progress: string) {
  const match = progress.match(/(\d+)\/(\d+)/)
  if (!match) return null
  const total = Number(match[2])
  return total > 0 ? Math.min(1, Number(match[1]) / total) : null
}

function kindHint(batch: ExportHistoryBatch, kind: BatchFeedKind) {
  const count = batchProductCount(batch)
  switch (kind) {
    case 'scraping': return 'Парсер собирает посты'
    case 'raw': return `${fmt(count)} тов.`
    case 'script': return `${fmt(count)} тов.`
    case 'ai_running': return `${fmt(count)} тов. в партии`
    case 'ready': return `${fmt(count)} тов. · проверьте и опубликуйте`
    case 'publishing': return `${fmt(count)} тов.`
    case 'pushed': return `${fmt(count)} тов. на сайте`
    case 'archived': return 'Сняты с сайта · вернутся при новой публикации'
    case 'failed': return batchErrorMessage(batch) || 'Парсер завершился с ошибкой'
    case 'deleted': return 'Товары удалены из технической БД'
  }
}

function StageBadge({ batch, kind }: { batch: ExportHistoryBatch; kind: BatchFeedKind }) {
  const progress = batchProgress(batch, kind)
  const running = RUNNING_KINDS.includes(kind)
  return (
    <span className={`inline-flex w-fit max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${KIND_STYLES[kind]}`}>
      {running && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      <span className="truncate">{BATCH_FEED_LABELS[kind]}</span>
      {progress && <span className="font-normal tabular-nums opacity-80">{progress}</span>}
    </span>
  )
}

function ProductBar({ counts }: { counts: FeedRow['counts'] }) {
  const visible = PRODUCT_BUCKETS.filter(({ key }) => counts[key] > 0)
  if (!visible.length) return <div className="text-xs text-slate-500">Товаров пока нет</div>
  return (
    <div className="min-w-0">
      <div className="flex h-2 gap-px overflow-hidden rounded bg-slate-800">
        {visible.map(({ key, label }) => (
          <span key={key} className={BUCKET_COLORS[key]} style={{ flexGrow: counts[key] }} title={`${label}: ${fmt(counts[key])}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-300">
        {visible.map(({ key, label }) => (
          <span key={key} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className={`h-1.5 w-1.5 rounded-full ${BUCKET_COLORS[key].split(' ')[0]}`} />
            <b className="font-semibold tabular-nums text-slate-100">{fmt(counts[key])}</b> {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function NoteIcon({ note }: { note: string }) {
  return (
    <span className="group/note relative inline-flex shrink-0">
      <span
        tabIndex={0}
        aria-label={`Комментарий: ${note}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-500/15 text-amber-300 outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <MessageSquareText className="h-3.5 w-3.5" />
      </span>
      <span role="tooltip" className="pointer-events-none invisible absolute left-1/2 top-full z-30 mt-2 w-max max-w-xs -translate-x-1/2 whitespace-pre-line rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-5 text-slate-100 opacity-0 shadow-2xl transition-opacity group-hover/note:visible group-hover/note:opacity-100 group-focus-within/note:visible group-focus-within/note:opacity-100">
        {note}
      </span>
    </span>
  )
}

export default function ExportFeed({
  initialSuppliers,
  catalogLookups,
  initialBatches,
  initialSiteCounts,
}: {
  initialSuppliers: SupplierListItem[]
  catalogLookups: CatalogLookups
  initialBatches: ExportHistoryBatch[]
  initialSiteCounts: Record<number, number>
}) {
  const router = useRouter()
  const [batches, setBatches] = useState<ExportHistoryBatch[]>(initialBatches)
  const [siteCounts, setSiteCounts] = useState<Record<number, number>>(initialSiteCounts)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sort, setSort] = useState<FeedSort>('manual')
  const [positions, setPositions] = useState<Record<number, number>>({})
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [priceSupplier, setPriceSupplier] = useState<{ id: number; name: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { setBatches(initialBatches) }, [initialBatches])
  useEffect(() => { setSiteCounts(initialSiteCounts) }, [initialSiteCounts])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('export-feed-sort') as FeedSort | null
      if (saved && saved in SORT_LABELS) setSort(saved)
    } catch { /* storage недоступен — остаётся сортировка по умолчанию */ }
  }, [])

  const changeSort = (value: FeedSort) => {
    setSort(value)
    try { localStorage.setItem('export-feed-sort', value) } catch { /* ignore */ }
  }

  const saveOrder = async (ids: number[]) => {
    const previous = positions
    setPositions(Object.fromEntries(ids.map((id, index) => [id, index + 1])))
    if (sort !== 'manual') changeSort('manual')
    const res = await reorderSuppliersAction(ids)
    if (!res.success) {
      setPositions(previous)
      alert(`Не удалось сохранить порядок: ${res.error}`)
    }
  }

  // Лента читается обычным GET (/api/batches/feed), а не серверными экшенами:
  // экшены и переходы App Router идут одной очередью, и пока опрос ленты
  // ждал ответа, клик по выгрузке не открывал её. Запрос в полёте один,
  // при уходе со страницы он отменяется.
  const refreshRequest = useRef<AbortController | null>(null)
  // Фоновый опрос пропускает тик, если ответ ещё не пришёл; явное обновление
  // (кнопка, после действия) отменяет старый запрос, чтобы не показать
  // данные, прочитанные до изменения.
  const refresh = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (refreshRequest.current) {
      if (background) return
      refreshRequest.current.abort()
    }
    const controller = new AbortController()
    refreshRequest.current = controller
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/batches/feed', { cache: 'no-store', signal: controller.signal })
      const payload = response.ok ? await response.json() : null
      if (payload?.success) {
        setBatches(payload.data.batches)
        if (payload.data.siteCounts) setSiteCounts(payload.data.siteCounts)
        setNow(Date.now())
      }
    } catch {
      // Отменённый или сорвавшийся опрос не мешает работе: следующий тик повторит.
    } finally {
      if (refreshRequest.current === controller) refreshRequest.current = null
      if (!controller.signal.aborted) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => () => refreshRequest.current?.abort(), [])

  const hasRunning = batches.some((batch) => RUNNING_KINDS.includes(batchFeedKind(batch)))
  useEffect(() => {
    if (!hasRunning) return
    const interval = setInterval(() => {
      if (!document.hidden) void refresh({ background: true })
    }, 3000)
    return () => clearInterval(interval)
  }, [hasRunning, refresh])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuId])

  const toggleRow = (key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const openBatch = (batch: ExportHistoryBatch) => router.push(`/admin/batches/${encodeURIComponent(batch.id)}`)

  const openFile = (batch: ExportHistoryBatch, file: ExportHistoryFile) => {
    if (file.snapshot_missing) {
      alert('Исторический снимок этого этапа не сохранился. Текущие товары партии не будут показаны вместо него.')
      return
    }
    if (!batch.isSynthetic && file.batch_id) {
      const snapshot = file.snapshot_id ? `?snapshot=${encodeURIComponent(file.snapshot_id)}` : ''
      router.push(`/admin/batches/${encodeURIComponent(file.batch_id)}${snapshot}`)
      return
    }
    setModalState({
      localPath: file.result_path || '',
      rawPath: batch.raw_path,
      aiPath: batch.ai_path,
      supplierId: file.supplier_id,
      batchId: file.batch_id,
      snapshotId: file.snapshot_id,
      supplierName: file.supplier_name,
      supplierAvatar: file.supplier_avatar,
      forceFileMode: shouldOpenBatchArtifactAsFile(file.result_path, file.snapshot_id),
    })
  }

  const runBatchAction = async (key: string, action: () => Promise<void>) => {
    setPendingAction(key)
    setOpenMenuId(null)
    try {
      await action()
    } finally {
      setPendingAction(null)
    }
  }

  const archiveFromSite = (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(`Убрать опубликованные товары выгрузки «${batch.name}» с сайта в архив?\n\nТовары не удаляются: Rails переводит их в архив. Если новая выгрузка снова принесёт тот же external_id, при публикации товар вернётся на сайт. Локальные товары и история останутся.`)) return
    const replaceShared = window.confirm(
      'Убрать в архив также товары с тем же external_id, которые входят в более новую опубликованную выгрузку этого поставщика?\n\n' +
      'Да — убрать и совпадения.\nНет — оставить общие товары на сайте.',
    )
    void runBatchAction(`catalog-${batch.id}`, async () => {
      const res = await deleteBatchAction(batch.id, { catalogOnly: true, replaceShared })
      if (res.success) {
        alert(`Перенесено в архив: ${res.catalogArchivedCount || 0}${res.catalogProtectedCount ? `, оставлено на сайте как общие: ${res.catalogProtectedCount}` : ''}`)
        await refresh()
      } else {
        alert(`Не удалось убрать с сайта: ${res.error}`)
      }
    })
  }

  const deleteLocally = (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(`Удалить локальные товары и медиа из технической БД для выгрузки «${batch.name}»? История этапов останется.\n\nТовары на сайте не будут затронуты.`)) return
    void runBatchAction(`db-${batch.id}`, async () => {
      const res = await deleteBatchAction(batch.id)
      if (res.success) {
        alert(`Локально удалено: ${res.deletedCount || 0}. Сайт не затронут.`)
        await refresh()
      } else {
        alert(`Ошибка при удалении из БД: ${res.error}`)
      }
    })
  }

  const deleteFromHistory = (batch: ExportHistoryBatch) => {
    if (!confirm(`Удалить выгрузку «${batch.name}» и связанную историю этапов из админки?`)) return
    void runBatchAction(`admin-${batch.id}`, async () => {
      const res = batch.isSynthetic
        ? await deleteExportFileFromAdminAction(Number(batch.files[0].id))
        : await deleteExportBatchFromAdminAction(batch.id)
      if (res.success) setBatches((prev) => prev.filter((item) => item.id !== batch.id))
      else alert(`Ошибка при удалении из админки: ${res.error}`)
    })
  }

  const deleteStage = (file: ExportHistoryFile) => {
    if (file.is_virtual) return
    const stageName = file.label || file.status
    const rollsBack = file.is_current && file.status !== 'Сырой товар'
    if (!confirm(rollsBack
      ? `Удалить этап «${stageName}»?\n\nТовары партии вернутся к предыдущему этапу, и он станет текущей версией.`
      : `Удалить этап «${stageName}» из истории?`)) return
    void runBatchAction(`file-${file.id}`, async () => {
      const res = await deleteExportFileFromAdminAction(Number(file.id))
      if (res.success) await refresh()
      else alert(`Ошибка при удалении этапа: ${res.error}`)
    })
  }

  const restoreRaw = (file: ExportHistoryFile) => {
    if (!file.batch_id) return
    const batchId = file.batch_id
    void runBatchAction(`restore-raw-${file.id}`, async () => {
      const result = await restoreMissingRawSnapshotAction(batchId)
      if (result.success) {
        await refresh()
        alert(`Сырой снимок восстановлен: ${result.data?.count || 0} товаров.`)
      } else {
        alert(result.error || 'Не удалось восстановить сырой снимок')
      }
    })
  }

  const startAi = (batch: ExportHistoryBatch) => {
    void runBatchAction(`ai-${batch.id}`, async () => {
      const result = await startBatchAiAction(batch.id, 'full')
      if (!result.success) alert(`Ошибка ИИ: ${result.error}`)
      await refresh()
    })
  }

  const stopAi = (batch: ExportHistoryBatch) => {
    if (!batch.ai_run_id || !confirm('Остановить AI-обработку? Уже завершённые товары останутся сохранены.')) return
    void runBatchAction(`stop-ai-${batch.id}`, async () => {
      const result = await stopBatchAiRunAction(batch.ai_run_id!)
      if (!result.success) alert(`Не удалось остановить ИИ: ${result.error}`)
      await refresh()
    })
  }

  const renderBody = (api: SupplierListApi) => (
    <FeedBody
      api={api}
      batches={batches}
      siteCounts={siteCounts}
      positions={positions}
      saveOrder={saveOrder}
      now={now}
      sort={sort}
      setSort={changeSort}
      query={query}
      setQuery={setQuery}
      expanded={expanded}
      toggleRow={toggleRow}
      openMenuId={openMenuId}
      setOpenMenuId={setOpenMenuId}
      pendingAction={pendingAction}
      isRefreshing={isRefreshing}
      refresh={refresh}
      openBatch={openBatch}
      openFile={openFile}
      startAi={startAi}
      stopAi={stopAi}
      archiveFromSite={archiveFromSite}
      deleteLocally={deleteLocally}
      deleteFromHistory={deleteFromHistory}
      deleteStage={deleteStage}
      restoreRaw={restoreRaw}
      openPriceRules={(supplier) => setPriceSupplier(supplier)}
    />
  )

  return (
    <>
      <SupplierList
        initialData={initialSuppliers}
        catalogLookups={catalogLookups}
        onScrapeStarted={(supplierId) => {
          setExpanded((prev) => new Set(prev).add(String(supplierId)))
          void refresh()
        }}
      >
        {renderBody}
      </SupplierList>
      <CsvModal
        isOpen={Boolean(modalState)}
        onClose={() => setModalState(null)}
        localPath={modalState?.localPath}
        rawPath={modalState?.rawPath || undefined}
        aiPath={modalState?.aiPath || undefined}
        supplierId={modalState?.supplierId}
        batchId={modalState?.batchId}
        snapshotId={modalState?.snapshotId}
        supplierName={modalState?.supplierName}
        supplierAvatar={modalState?.supplierAvatar}
        forceFileMode={modalState?.forceFileMode}
      />
      {priceSupplier && <SupplierPriceRulesDialog supplierId={priceSupplier.id} supplierName={priceSupplier.name} onClose={() => setPriceSupplier(null)} />}
    </>
  )
}

type FeedBodyProps = {
  api: SupplierListApi
  batches: ExportHistoryBatch[]
  siteCounts: Record<number, number>
  positions: Record<number, number>
  saveOrder: (ids: number[]) => Promise<void>
  now: number
  sort: FeedSort
  setSort: (value: FeedSort) => void
  query: string
  setQuery: (value: string) => void
  expanded: Set<string>
  toggleRow: (key: string) => void
  openMenuId: string | null
  setOpenMenuId: (value: string | null) => void
  pendingAction: string | null
  isRefreshing: boolean
  refresh: () => Promise<void>
  openBatch: (batch: ExportHistoryBatch) => void
  openFile: (batch: ExportHistoryBatch, file: ExportHistoryFile) => void
  startAi: (batch: ExportHistoryBatch) => void
  stopAi: (batch: ExportHistoryBatch) => void
  archiveFromSite: (batch: ExportHistoryBatch) => void
  deleteLocally: (batch: ExportHistoryBatch) => void
  deleteFromHistory: (batch: ExportHistoryBatch) => void
  deleteStage: (file: ExportHistoryFile) => void
  restoreRaw: (file: ExportHistoryFile) => void
  openPriceRules: (supplier: { id: number; name: string }) => void
}

function FeedBody(props: FeedBodyProps) {
  const { api, batches, siteCounts, positions, sort, setSort, query, setQuery } = props
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | null>(null)

  const suppliers = useMemo(
    () => api.suppliers.map((supplier) => (supplier.id in positions ? { ...supplier, feed_position: positions[supplier.id] } : supplier)),
    [api.suppliers, positions],
  )
  const rows = useMemo(() => buildSupplierFeedRows(suppliers, batches, siteCounts), [suppliers, batches, siteCounts])
  const sortedRows = useMemo(() => sortFeedRows(rows, sort), [rows, sort])

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sortedRows
    return sortedRows.filter((row) => {
      const haystack = [row.name, row.supplier?.id, row.supplier?.album_id, row.supplier?.operator_note].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [sortedRows, query])

  // Новый порядок строится из того, что сейчас видно на экране (с учётом
  // текущей сортировки), и сохраняется как «Свой порядок».
  const moveRow = (from: string, target: string, after: boolean) => {
    const keys = moveFeedKey(sortedRows.map((row) => row.key), from, target, after)
    const ids = keys.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    void props.saveOrder(ids)
  }

  const dnd: DragHandlers = {
    dragKey,
    dropTarget,
    arm: (key) => setDragKey(key),
    over: (key, after) => {
      if (!dragKey || dragKey === key) { if (dropTarget) setDropTarget(null); return }
      if (dropTarget?.key !== key || dropTarget.after !== after) setDropTarget({ key, after })
    },
    drop: () => {
      if (dragKey && dropTarget) moveRow(dragKey, dropTarget.key, dropTarget.after)
      setDragKey(null)
      setDropTarget(null)
    },
    end: () => { setDragKey(null); setDropTarget(null) },
    moveByKeyboard: (key, direction) => {
      const index = visibleRows.findIndex((row) => row.key === key)
      const target = visibleRows[index + direction]
      if (index >= 0 && target?.supplier) moveRow(key, target.key, direction === 1)
    },
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Выгрузки</h2>
          <p className="mt-1 text-sm text-slate-400">Все поставщики в одной ленте. Раскройте строку, чтобы увидеть партии и их этапы.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void props.refresh()} disabled={props.isRefreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${props.isRefreshing ? 'animate-spin' : ''}`} /> Обновить
          </button>
          <button type="button" onClick={() => api.openSettings(null)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            <Plus className="h-4 w-4" /> Поставщик
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поставщик, ID, альбом, комментарий"
            aria-label="Поиск поставщика"
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 pl-9 pr-3 text-sm text-white outline-none focus:border-indigo-500"
          />
        </label>
        <select value={sort} onChange={(event) => setSort(event.target.value as FeedSort)} aria-label="Сортировка" className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200">
          {(Object.keys(SORT_LABELS) as FeedSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
        <div className={`hidden gap-4 rounded-t-xl border-b border-slate-700 bg-slate-950/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 xl:grid ${ROW_GRID}`}>
          <span />
          <span>Поставщик</span>
          <span>Последняя выгрузка</span>
          <span>Текущая партия</span>
          <span>Товары по этапам</span>
          <span className="text-right">Действия</span>
        </div>
        {visibleRows.map((row) => <SupplierRow key={row.key} row={row} dnd={dnd} {...props} />)}
        {visibleRows.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-slate-500">
            {rows.length ? 'Ничего не найдено. Измените поиск.' : 'Поставщиков пока нет. Добавьте первого кнопкой «Поставщик».'}
          </div>
        )}
      </div>
    </div>
  )
}

type DragHandlers = {
  dragKey: string | null
  dropTarget: { key: string; after: boolean } | null
  arm: (key: string) => void
  over: (key: string, after: boolean) => void
  drop: () => void
  end: () => void
  moveByKeyboard: (key: string, direction: -1 | 1) => void
}

function SupplierRow({ row, dnd, ...props }: FeedBodyProps & { row: FeedRow; dnd: DragHandlers }) {
  const { api, now, expanded, toggleRow } = props
  const supplier = row.supplier
  const isOpen = expanded.has(row.key)
  const latest = row.latest
  const kind = row.latestKind
  const days = daysSinceExport(row, now)
  const scraping = row.batches.some((batch) => batchFeedKind(batch) === 'scraping')
  const currentBatch = row.batches.find((batch) => !batch.isSynthetic && !['scraping', 'failed', 'deleted'].includes(batchFeedKind(batch)))
  const progress = latest && kind ? batchProgress(latest, kind) : ''
  const ratio = progressRatio(progress)
  const note = supplier?.operator_note?.trim() || ''

  const canDrag = Boolean(supplier)
  const isDragging = dnd.dragKey === row.key
  const dropBefore = dnd.dropTarget?.key === row.key && !dnd.dropTarget.after
  const dropAfter = dnd.dropTarget?.key === row.key && dnd.dropTarget.after

  return (
    <div
      className={`relative border-t border-slate-800 first:border-t-0 ${isDragging ? 'opacity-40' : ''}`}
      draggable={canDrag && isDragging}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', row.key)
      }}
      onDragOver={(event) => {
        if (!dnd.dragKey || !canDrag) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        dnd.over(row.key, event.clientY > rect.top + Math.min(rect.height, 64) / 2)
      }}
      onDrop={(event) => { event.preventDefault(); dnd.drop() }}
      onDragEnd={dnd.end}
    >
      {dropBefore && <span className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-indigo-400" />}
      {dropAfter && <span className="pointer-events-none absolute inset-x-0 -bottom-px z-10 h-0.5 bg-indigo-400" />}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => toggleRow(row.key)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleRow(row.key)
          }
        }}
        className={`grid cursor-pointer grid-cols-[48px_1fr_auto] items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors hover:bg-slate-800/50 xl:gap-4 xl:px-4 ${ROW_GRID} ${isOpen ? 'bg-slate-800/40' : ''}`}
      >
        <span className="flex items-center gap-0.5">
          {canDrag ? (
            <span
              role="button"
              tabIndex={0}
              title="Перетащите, чтобы изменить порядок (или ↑/↓ с клавиатуры)"
              aria-label={`Переместить ${row.name}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={() => dnd.arm(row.key)}
              onPointerUp={() => { if (!dnd.dropTarget) dnd.end() }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.stopPropagation()
                  dnd.moveByKeyboard(row.key, event.key === 'ArrowUp' ? -1 : 1)
                }
              }}
              className="flex h-7 w-5 cursor-grab items-center justify-center rounded text-slate-600 outline-none hover:text-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-400 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          ) : <span className="w-5" />}
          <span className="flex h-7 w-6 items-center justify-center rounded-md text-slate-400">
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </span>
        </span>

        <div className="flex min-w-0 items-center gap-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-600 bg-slate-700">
            {supplier?.avatar_url
              ? <img src={resizeImageUrl(supplier.avatar_url, imagePresets.avatar)} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-300">{row.name.charAt(0).toUpperCase() || '?'}</div>}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-white">{row.name}</span>
              {note && <span onClick={(event) => event.stopPropagation()}><NoteIcon note={note} /></span>}
              {supplier && (
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); api.toggleFavorite(supplier.id) }}
                  className={`shrink-0 rounded p-0.5 ${supplier.is_favorite ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-400'}`}
                  title={supplier.is_favorite ? 'Убрать из избранного' : 'В избранное'}
                  aria-label={supplier.is_favorite ? 'Убрать из избранного' : 'В избранное'}
                >
                  <Star className={`h-3.5 w-3.5 ${supplier.is_favorite ? 'fill-current' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              {supplier ? <span className="tabular-nums">#{supplier.id}</span> : <span>Партии без найденного поставщика</span>}
              {supplier?.has_post_process_script && <span className="rounded border border-orange-500/40 px-1 text-[10px] font-semibold text-orange-300">Скрипт</span>}
              {supplier?.album_id && (
                <a
                  href={`https://www.szwego.com/static/index.html#shop_detail/${supplier.album_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 hover:text-emerald-400"
                >
                  альбом <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="col-start-2 text-sm xl:col-start-auto">
          {row.lastExportAt !== null ? (
            <>
              <div className={`font-medium ${days >= 14 ? 'text-red-300' : days >= STALE_DAYS ? 'text-amber-300' : 'text-slate-100'}`}>{formatRelativeTime(row.lastExportAt, now)}</div>
              <div className="text-xs tabular-nums text-slate-500">{formatDateTime(latest?.created_at)}</div>
            </>
          ) : (
            <div className="text-slate-500">Ещё не выгружался</div>
          )}
        </div>

        <div className="col-span-2 col-start-2 min-w-0 xl:col-span-1 xl:col-start-auto">
          {latest && kind ? (
            <>
              <StageBadge batch={latest} kind={kind} />
              {ratio !== null && (
                <div className="mt-1.5 h-1 max-w-56 overflow-hidden rounded bg-slate-800">
                  <div className={`h-full rounded ${kind === 'publishing' ? 'bg-sky-400' : 'bg-violet-400'} transition-all`} style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
                </div>
              )}
              <div className={`mt-1 line-clamp-2 text-xs ${kind === 'failed' ? 'text-red-300' : 'text-slate-500'}`}>{kindHint(latest, kind)}</div>
            </>
          ) : (
            <span className="text-xs text-slate-500">Нет партий</span>
          )}
        </div>

        <div className="col-span-2 col-start-2 min-w-0 xl:col-span-1 xl:col-start-auto">
          <ProductBar counts={row.counts} />
        </div>

        {/* На телефоне кнопки идут отдельной строкой под поставщиком, чтобы
            не сжимать его имя; с sm — справа в первой строке. */}
        <div className="col-span-2 col-start-2 flex flex-wrap items-center justify-start gap-1.5 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end xl:col-start-auto xl:row-start-auto" onClick={(event) => event.stopPropagation()}>
          {supplier && (
            <button
              type="button"
              onClick={() => api.openScrape(supplier.id)}
              disabled={scraping}
              title={scraping ? 'Выгрузка уже идёт' : 'Запустить выгрузку'}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" /><span className="hidden xl:inline">Выгрузить</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => currentBatch && props.openBatch(currentBatch)}
            disabled={!currentBatch}
            title="Открыть текущую партию"
            aria-label="Открыть текущую партию"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          {supplier && (
            <button
              type="button"
              onClick={() => props.openPriceRules({ id: supplier.id, name: supplier.name })}
              title="Правила цен поставщика"
              aria-label="Правила цен поставщика"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700"
            >
              <BadgeRussianRuble className="h-4 w-4" />
            </button>
          )}
          {supplier && (
            <button
              type="button"
              onClick={() => api.openSettings(supplier)}
              title="Настройки поставщика"
              aria-label="Настройки поставщика"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-slate-800 bg-slate-950/40 px-3 pb-4 pt-2 lg:pl-14 lg:pr-4">
          {row.batches.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-slate-400">
              <span>У поставщика ещё нет партий.</span>
              {supplier && (
                <button type="button" onClick={() => api.openScrape(supplier.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                  <Download className="h-4 w-4" /> Первая выгрузка
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-slate-500">
                <span>{row.batches.length} партий · нажмите на этап, чтобы открыть его снимок</span>
                {row.batches.some((batch) => batchFeedKind(batch) === 'archived') && (
                  <span className="max-w-2xl rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-slate-300">
                    Товары в архиве не удалены: если новая выгрузка снова принесёт тот же external_id, при публикации товар вернётся на сайт.
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {row.batches.map((batch, index) => <BatchRow key={batch.id} batch={batch} isCurrent={index === 0} supplierName={row.name} {...props} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BatchRow({ batch, isCurrent, supplierName, ...props }: FeedBodyProps & { batch: ExportHistoryBatch; isCurrent: boolean; supplierName: string }) {
  const { pendingAction, openMenuId, setOpenMenuId } = props
  const kind = batchFeedKind(batch)
  const productCount = batchProductCount(batch)
  const aiProductCount = Number(batch.ai_product_count || 0)
  const aiRunning = isAiRunning(batch)
  const canAi = !batch.isSynthetic && productCount > 0 && aiProductCount < productCount && !['deleted', 'scraping', 'publishing', 'pushed', 'archived'].includes(kind)
  const canArchive = !batch.isSynthetic && canDeletePublishedCatalog(batch.stage, batch.published_external_count, batch.catalog_deleted_at)
  const isBusy = Boolean(pendingAction?.endsWith(batch.id))
  // Название партии обычно «<Поставщик> - <дата>»: дату уже показываем сами,
  // поэтому подпись выводится, только если в ней есть что-то кроме даты.
  const rawSubtitle = batchSubtitle(batch.name, supplierName)
  const subtitle = /[A-Za-zА-Яа-яЁё]/.test(rawSubtitle) ? rawSubtitle : ''
  const menuOpen = openMenuId === batch.id

  return (
    <div className={`grid gap-3 rounded-lg border bg-slate-900 p-3 lg:grid-cols-[minmax(160px,1fr)_minmax(0,2.4fr)_auto] lg:items-center ${isCurrent ? 'border-slate-600' : 'border-slate-800'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-100">{formatDateTime(batch.created_at)}</span>
          <StageBadge batch={batch} kind={kind} />
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {isCurrent ? 'Текущая партия · ' : ''}
          {subtitle ? `${subtitle} · ` : ''}
          с {formatDate(batch.created_at)} · {batch.end_date ? `до ${formatDate(batch.end_date)}` : 'весь период'} · {fmt(productCount)} тов.
        </div>
        {kind === 'failed' && <div className="mt-1 text-xs text-red-300">{batchErrorMessage(batch) || 'Парсер завершился с ошибкой'}</div>}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {batch.files.map((file, index) => (
          <React.Fragment key={file.id}>
            {index > 0 && <span className="text-xs text-slate-600">→</span>}
            <span className={`inline-flex items-center overflow-hidden rounded-md border bg-slate-950/60 text-xs ${FILE_STATUS_STYLES[file.status] || 'border-slate-700 text-slate-300'} ${file.is_current ? 'ring-1 ring-indigo-400/50' : ''}`}>
              <button
                type="button"
                onClick={() => props.openFile(batch, file)}
                disabled={file.snapshot_missing}
                className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                title={file.snapshot_missing ? 'Исторический снимок недоступен' : file.is_current ? 'Текущая редактируемая версия' : 'Открыть снимок только для просмотра'}
              >
                {file.status === 'Запущено' && <Loader2 className="h-3 w-3 animate-spin" />}
                {file.status === 'failed' ? 'Ошибка' : file.label || file.status}
                <span className="font-mono text-[11px] opacity-70">{fmt(Number(file.items_count || 0))}</span>
              </button>
              {file.snapshot_missing && file.status === 'Сырой товар' && (
                <button
                  type="button"
                  onClick={() => props.restoreRaw(file)}
                  disabled={!file.raw_artifact_available || pendingAction === `restore-raw-${file.id}`}
                  className="border-l border-slate-700 px-1.5 py-1 text-indigo-300 hover:bg-indigo-500/10 disabled:text-slate-600"
                  title={file.raw_artifact_available ? 'Восстановить сырой снимок из сохранённого файла' : 'Сохранённого файла для восстановления нет'}
                  aria-label="Восстановить сырой снимок"
                >
                  {pendingAction === `restore-raw-${file.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                </button>
              )}
              {!file.is_virtual && (
                <button
                  type="button"
                  onClick={() => props.deleteStage(file)}
                  className="border-l border-slate-700 px-1.5 py-1 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                  title="Удалить этап из админки"
                  aria-label={`Удалить этап ${file.label || file.status}`}
                >
                  {pendingAction === `file-${file.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              )}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className="relative flex flex-wrap items-center justify-end gap-1.5">
        {canAi && !aiRunning && (
          <button type="button" onClick={() => props.startAi(batch)} disabled={pendingAction === `ai-${batch.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
            {pendingAction === `ai-${batch.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            {aiProductCount > 0 ? 'Продолжить ИИ' : 'Обработать ИИ'}
          </button>
        )}
        {aiRunning && !batch.isSynthetic && (
          <button type="button" onClick={() => props.stopAi(batch)} disabled={pendingAction === `stop-ai-${batch.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">
            {pendingAction === `stop-ai-${batch.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
            Стоп ИИ
          </button>
        )}
        {!batch.isSynthetic && !['deleted', 'scraping'].includes(kind) && (
          <button type="button" onClick={() => props.openBatch(batch)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700">
            <FolderOpen className="h-3.5 w-3.5" /> Открыть
          </button>
        )}
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); setOpenMenuId(menuOpen ? null : batch.id) }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Действия с партией"
          aria-expanded={menuOpen}
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-20 w-72 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 py-1 text-left shadow-2xl" onClick={(event) => event.stopPropagation()}>
            {canArchive && (
              <MenuButton onClick={() => props.archiveFromSite(batch)} disabled={isBusy} icon={<Archive className="h-4 w-4" />} hint="Товары уйдут в архив и вернутся при новой публикации того же external_id">
                Убрать с сайта в архив
              </MenuButton>
            )}
            <MenuButton onClick={() => props.deleteLocally(batch)} disabled={batch.isSynthetic || kind === 'deleted' || isBusy} icon={<Database className="h-4 w-4" />} hint="Только техническая БД, сайт не затрагивается">
              Удалить локально
            </MenuButton>
            <MenuButton onClick={() => props.deleteFromHistory(batch)} danger icon={<ArchiveX className="h-4 w-4" />}>Удалить из истории</MenuButton>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuButton({ children, onClick, icon, hint, danger = false, disabled = false }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; hint?: string; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-2 px-4 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-600 ${danger ? 'text-red-300 hover:bg-red-500/10' : 'text-slate-200 hover:bg-slate-800'}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span><b className="block font-medium">{children}</b>{hint && <small className="block text-xs text-slate-500">{hint}</small>}</span>
    </button>
  )
}

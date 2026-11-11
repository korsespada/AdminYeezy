'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArchiveX,
  Bot,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  FolderPlus,
  RotateCcw,
  Settings2,
  Globe,
  BadgeRussianRuble,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  deleteBatchAction,
  deleteExportBatchFromAdminAction,
  deleteExportFileFromAdminAction,
  getExportHistoryAction,
  type ExportHistoryBatch,
  type ExportHistoryFile,
} from '@/actions/suppliers'
import { restoreMissingRawSnapshotAction } from '@/actions/csv-import'
import CsvModal from './CsvModal'
import {
  createExportFolderAction,
  deleteExportFolderAction,
  getBatchAiRunAction,
  moveBatchToFolderAction,
  renameExportFolderAction,
  startBatchAiAction,
  stopBatchAiRunAction,
} from '@/actions/batch-ai'
import SupplierPriceRulesDialog from './SupplierPriceRulesDialog'
import { batchStatusProgress, batchSubtitle, canDeletePublishedCatalog, shouldOpenBatchArtifactAsFile } from '@/lib/batch-history'

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

const statusStyles: Record<string, string> = {
  'Сырой товар': 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  'Обработан скриптом': 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  'Обработано ИИ': 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  'Запушено в БД': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  'Запущено': 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  'Обработка ИИ': 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  'Публикация в БД': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  'Каталог удалён': 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  'Удалено из БД': 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  failed: 'bg-red-500/10 text-red-300 border-red-500/20',
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('ru-RU')
}

function fileName(filePath?: string | null) {
  if (!filePath) return 'Товары партии'
  if (filePath.startsWith('db://')) return 'Снимок товаров в БД'
  return filePath.split(/[\\/]/).pop() || filePath
}

function StatusBadge({ status, loading = false, progress = '' }: { status: string; loading?: boolean; progress?: string }) {
  return (
    <span className={`inline-flex w-fit min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.failed}`}>
      {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      {status === 'failed' ? 'Ошибка' : status}
      {progress && <span className="font-normal tabular-nums opacity-80">({progress})</span>}
    </span>
  )
}

export default function ExportHistoryList({ initialData, initialFolders }: { initialData: ExportHistoryBatch[]; initialFolders: any[] }) {
  const router = useRouter()
  const [batches, setBatches] = useState<ExportHistoryBatch[]>(initialData)
  const [folders, setFolders] = useState<any[]>(initialFolders)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    setFolderFilter('all')
  }, [initialData])
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [priceSupplier, setPriceSupplier] = useState<{ id: number; name: string } | null>(null)

  const refresh = async () => {
    setIsRefreshing(true)
    const res = await getExportHistoryAction()
    if (res.success) setBatches(res.data)
    setIsRefreshing(false)
  }

  useEffect(() => {
    const hasRunning = batches.some((batch) => batch.status === 'Запущено' || ['queued', 'running'].includes(batch.ai_run_status || '') || Boolean(batch.active_operation?.includes('publish')) || batch.files.some((file) => file.status === 'Запущено'))
    if (!hasRunning) return
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [batches])

  useEffect(() => {
    if (!openMenuId) return

    const closeMenu = () => setOpenMenuId(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null)
    }

    document.addEventListener('click', closeMenu)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('click', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuId])

  const toggleBatch = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const handleDeleteFromDb = async (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(
      `Удалить локальные товары и медиа из технической БД для выгрузки "${batch.name}"? История этапов останется в админке.` +
      '\n\nТовары основного каталога не будут затронуты.',
    )) return

    setPendingAction(`db-${batch.id}`)
    const res = await deleteBatchAction(batch.id)
    if (res.success) {
      setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, status: 'Удалено из БД' } : item))
      const catalogMessage = res.catalogSkipped
        ? 'Основной каталог не затронут.'
        : res.catalogDeletedCount !== undefined
        ? `Из каталога удалено: ${res.catalogDeletedCount}, архивировано: ${res.catalogArchivedCount || 0}, ошибок: ${res.catalogFailedCount || 0}${res.catalogProtectedCount ? `, защищено как общие: ${res.catalogProtectedCount}` : ''}`
        : 'Из каталога: не проверено'
      alert(`Локально удалено: ${res.deletedCount || 0}\n${catalogMessage}`)
    } else {
      alert(`Ошибка при удалении из БД: ${res.error}`)
    }
    setPendingAction(null)
    setOpenMenuId(null)
  }

  const restoreRaw = async (batch: ExportHistoryBatch, file: ExportHistoryFile) => {
    if (!file.batch_id) return
    const batchId = file.batch_id
    setPendingAction(`restore-raw-${file.id}`)
    const result = await restoreMissingRawSnapshotAction(batchId)
    if (result.success) {
      const refreshed = await getExportHistoryAction()
      if (refreshed.success && refreshed.data) setBatches(refreshed.data as ExportHistoryBatch[])
      alert(`Сырой снимок восстановлен: ${result.data?.count || 0} товаров. Теперь его можно открыть.`)
    } else {
      alert(result.error || 'Не удалось восстановить сырой снимок')
    }
    setPendingAction(null)
  }

  const handleDeleteFromCatalog = async (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(`Удалить опубликованные товары выгрузки "${batch.name}" из основного каталога?\n\nЛокальные товары и история останутся. Статус выгрузки станет «Каталог удалён · локальная выгрузка сохранена».`)) return
    const replaceShared = window.confirm(
      'Удалить также товары с тем же external_id, которые входят в новую опубликованную выгрузку этого поставщика?\n\n' +
      'Да — удалить совпадения.\nНет — сохранить общие товары.',
    )
    setPendingAction(`catalog-${batch.id}`)
    const res = await deleteBatchAction(batch.id, { catalogOnly: true, replaceShared })
    if (res.success) {
      setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, published_external_count: 0 } : item))
      alert(`Из основного каталога удалено: ${res.catalogDeletedCount || 0}, архивировано: ${res.catalogArchivedCount || 0}${res.catalogProtectedCount ? `, защищено общих: ${res.catalogProtectedCount}` : ''}`)
    } else {
      alert(`Ошибка при удалении из основного каталога: ${res.error}`)
    }
    setPendingAction(null)
    setOpenMenuId(null)
  }

  const handleDeleteBatchFromAdmin = async (batch: ExportHistoryBatch) => {
    if (!confirm(`Удалить выгрузку "${batch.name}" и связанную историю этапов из админки?`)) return

    setPendingAction(`admin-${batch.id}`)
    const res = batch.isSynthetic
      ? await deleteExportFileFromAdminAction(Number(batch.files[0].id))
      : await deleteExportBatchFromAdminAction(batch.id)

    if (res.success) {
      setBatches((prev) => prev.filter((item) => item.id !== batch.id))
    } else {
      alert(`Ошибка при удалении из админки: ${res.error}`)
    }
    setPendingAction(null)
    setOpenMenuId(null)
  }

  const handleDeleteFileFromAdmin = async (batch: ExportHistoryBatch, file: ExportHistoryFile) => {
    if (file.is_virtual) return
    const stageName = file.label || file.status || fileName(file.result_path)
    const rollsBack = file.is_current && file.status !== 'Сырой товар'
    if (!confirm(rollsBack
      ? `Удалить этап «${stageName}»?

Товары партии вернутся к предыдущему этапу, и он станет текущей версией.`
      : `Удалить этап «${stageName}» из истории?`)) return

    setPendingAction(`file-${file.id}`)
    const res = await deleteExportFileFromAdminAction(Number(file.id))
    if (res.success) {
      // После отката текущим становится предыдущий этап: берём свежую историю.
      if (rollsBack) await refresh()
      else setBatches((prev) => prev
        .map((item) => item.id === batch.id ? { ...item, files: item.files.filter((f) => f.id !== file.id) } : item)
        .filter((item) => item.files.length > 0))
    } else {
      alert(`Ошибка при удалении файла: ${res.error}`)
    }
    setPendingAction(null)
  }

  const createFolder = async () => {
    const name = prompt('Название новой папки')?.trim()
    if (!name) return
    const result = await createExportFolderAction(name)
    if (result.success) setFolders((current) => [result.data, ...current])
    else alert(result.error)
  }

  const renameFolder = async () => {
    const folder = folders.find((item) => item.id === folderFilter)
    if (!folder) return
    const name = prompt('Новое название папки', folder.name)?.trim()
    if (!name) return
    const result = await renameExportFolderAction(folder.id, name)
    if (result.success) setFolders((items) => items.map((item) => item.id === folder.id ? { ...item, name } : item))
    else alert(result.error)
  }

  const deleteFolder = async () => {
    const folder = folders.find((item) => item.id === folderFilter)
    if (!folder || !confirm(`Удалить папку «${folder.name}»? Выгрузки останутся без папки.`)) return
    const result = await deleteExportFolderAction(folder.id)
    if (result.success) {
      setFolders((items) => items.filter((item) => item.id !== folder.id))
      setBatches((items) => items.map((item) => item.folder_id === folder.id ? { ...item, folder_id: null, folder_name: null } : item))
      setFolderFilter('all')
    } else alert((result as any).error)
  }

  const moveBatch = async (batch: ExportHistoryBatch, folderId: string) => {
    const target = folders.find((item) => item.id === folderId)
    const result = await moveBatchToFolderAction(batch.id, folderId || null)
    if (result.success) setBatches((items) => items.map((item) => item.id === batch.id ? { ...item, folder_id: folderId || null, folder_name: target?.name || null } : item))
    else alert((result as any).error)
  }

  const startAi = async (batch: ExportHistoryBatch) => {
    setPendingAction(`ai-${batch.id}`)
    try {
      const result = await startBatchAiAction(batch.id, 'full')
      if (result.success) {
        const data: any = result.data
        if (data?.runId) {
          setBatches((items) => items.map((item) => item.id === batch.id ? {
            ...item,
            ai_run_id: data.runId,
            ai_run_status: 'running',
          } : item))
          let finalRun: any = null
          for (let attempt = 0; attempt < 200; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000))
            const run = await getBatchAiRunAction(data.runId)
            if (!run.success) break
            finalRun = run.data
            setBatches((items) => items.map((item) => item.id === batch.id ? {
              ...item,
              ai_run_id: data.runId,
              ai_run_status: finalRun.status,
              ai_completed_count: Number(finalRun.completed_count || 0),
              ai_failed_count: Number(finalRun.failed_count || 0),
              ai_total_count: Number(finalRun.total_count || item.ai_total_count || 0),
            } : item))
            if (['completed', 'failed', 'cancelled'].includes(finalRun.status)) break
          }
          alert(finalRun?.status === 'cancelled'
            ? 'Обработка ИИ остановлена. Уже завершённые товары сохранены.'
            : finalRun?.status === 'completed'
            ? `Обработка ИИ завершена. Успешно: ${finalRun.completed_count || 0}, ошибок: ${finalRun.failed_count || 0}`
            : 'ИИ не завершил обработку вовремя. Текущий статус сохранён в истории.')
        }
        await refresh()
      } else alert(`Ошибка ИИ: ${result.error}`)
    } catch (error: any) {
      alert(`Ошибка ИИ: ${error?.message || 'не удалось запустить обработку'}`)
    } finally {
      setPendingAction(null)
    }
  }

  const stopAi = async (batch: ExportHistoryBatch) => {
    if (!batch.ai_run_id || !confirm('Остановить AI-обработку? Уже завершённые товары останутся сохранены.')) return
    setPendingAction(`stop-ai-${batch.id}`)
    try {
      const result = await stopBatchAiRunAction(batch.ai_run_id)
      if (!result.success) alert(`Не удалось остановить ИИ: ${result.error}`)
      await refresh()
    } finally {
      setPendingAction(null)
    }
  }

  const visibleBatches = batches.filter((batch) => {
    if (folderFilter === 'all') return true
    if (folderFilter === 'ungrouped') return !batch.folder_id
    return batch.folder_id === folderFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-white">История выгрузок</h2>
        <button
          onClick={refresh}
          disabled={isRefreshing}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFolderFilter('all')} className={`rounded-lg border px-3 py-2 text-sm ${folderFilter === 'all' ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>Все</button>
        <button onClick={() => setFolderFilter('ungrouped')} className={`rounded-lg border px-3 py-2 text-sm ${folderFilter === 'ungrouped' ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>Без папки</button>
        {folders.map((folder) => <button key={folder.id} onClick={() => setFolderFilter(folder.id)} className={`rounded-lg border px-3 py-2 text-sm ${folderFilter === folder.id ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{folder.name}</button>)}
        <button onClick={createFolder} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-indigo-500"><FolderPlus className="h-4 w-4" /> Новая папка</button>
        {!['all', 'ungrouped'].includes(folderFilter) && <><button onClick={renameFolder} className="text-xs text-slate-400 hover:text-white">Переименовать</button><button onClick={deleteFolder} className="text-xs text-red-400 hover:text-red-300">Удалить папку</button></>}
      </div>

      <div className="space-y-3 lg:hidden">
        {visibleBatches.map((batch) => {
          const isExpanded = expandedIds.has(batch.id)
          const isBusy = pendingAction?.endsWith(batch.id)
          const aiProductCount = Number(batch.ai_product_count || 0)
          const productCount = Number(batch.product_count || batch.items_count || 0)
          const hasAiRemaining = productCount > 0 && aiProductCount < productCount
          const canPublish = ['SCRIPT_PROCESSED', 'AI_PROCESSED', 'PUSHED'].includes(String(batch.stage || '')) && productCount > 0 && aiProductCount === productCount
          const aiRunning = ['queued', 'running'].includes(batch.ai_run_status || '')
          const publishing = Boolean(batch.active_operation?.includes('publish'))
          const parsing = batch.status === 'Запущено'
          const displayedStatus = publishing ? 'Публикация в БД' : aiRunning ? 'Обработка ИИ' : batch.status
          const statusProgress = batchStatusProgress({ publishing, aiRunning, activeOperation: batch.active_operation, aiCompletedCount: batch.ai_completed_count, aiFailedCount: batch.ai_failed_count, aiTotalCount: batch.ai_total_count })
          const subtitle = batchSubtitle(batch.name, batch.supplier_name)

          return (
            <article key={`mobile-${batch.id}`} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/80 shadow-lg">
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-600 bg-slate-700">
                      {batch.supplier_avatar ? <img src={batch.supplier_avatar} alt={batch.supplier_name || ''} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-300">{batch.supplier_name?.charAt(0).toUpperCase() || '?'}</div>}
                    </div>
                    <div className="min-w-0"><h3 className="break-words font-semibold text-white">{batch.supplier_name || 'Поставщик не найден'}</h3>{subtitle && <p className="mt-1 break-words text-xs text-slate-500">{subtitle}</p>}</div>
                  </div>
                  <div className="flex min-w-0 flex-col items-end gap-1">
                    <StatusBadge status={displayedStatus} loading={parsing || aiRunning || publishing} progress={statusProgress} />
                    {batch.catalog_deleted_at && <span className="text-right text-[10px] text-amber-300">Локальная выгрузка сохранена</span>}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">Период</dt><dd className="mt-1 text-slate-300">с {formatDate(batch.created_at)}{batch.end_date ? ` · до ${formatDate(batch.end_date)}` : ''}</dd></div>
                  <div><dt className="text-xs text-slate-500">Товаров</dt><dd className="mt-1 font-semibold text-slate-100">{batch.items_count} шт.</dd></div>
                </dl>
                <select value={batch.folder_id || ''} onChange={(event) => moveBatch(batch, event.target.value)} disabled={batch.isSynthetic} aria-label={`Папка партии ${batch.name}`} className="h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-300 disabled:opacity-40">
                  <option value="">Без папки</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => toggleBatch(batch.id)} className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:bg-slate-700">{isExpanded ? 'Скрыть этапы' : 'Показать этапы'}</button>
                  {canPublish && <button type="button" onClick={() => router.push(`/admin/batches/${encodeURIComponent(batch.id)}`)} className="min-h-11 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20">Открыть партию</button>}
                  {!canPublish && hasAiRemaining && <button type="button" onClick={() => startAi(batch)} disabled={isBusy || aiRunning} className="min-h-11 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 text-sm font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50">{aiProductCount > 0 ? 'Продолжить ИИ' : 'Обработать ИИ'}</button>}
                </div>
                {isExpanded && (
                  <div className="space-y-2 border-t border-slate-700 pt-3">
                    {batch.files.map((file) => (
                      <button type="button" key={`mobile-file-${file.id}`} onClick={() => openFile(batch, file)} disabled={file.snapshot_missing} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-indigo-400/50 disabled:cursor-not-allowed disabled:opacity-60">
                        <span className="min-w-0"><span className="block break-words text-sm font-medium text-slate-100">{file.label || fileName(file.result_path)}</span><span className="mt-1 block text-xs text-slate-500">{file.snapshot_missing ? 'Исторический снимок недоступен' : file.is_current ? 'Текущая версия' : file.is_virtual ? 'Состояние партии' : 'Только просмотр'} · {file.items_count || 0} шт.</span></span>
                        <StatusBadge status={file.status} loading={file.status === 'Запущено'} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          )
        })}
        {visibleBatches.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/50 px-4 py-16 text-center text-slate-500">Истории выгрузок пока нет</div>}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1120px] table-fixed text-left">
            <colgroup>
              <col className="w-[30%]" /><col className="w-[13%]" /><col className="w-[14%]" />
              <col className="w-[8%]" /><col className="w-[15%]" /><col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-700 bg-slate-950/60">
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Поставщик</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Папка</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Период</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Товаров</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Статус</th>
                <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleBatches.map((batch) => {
                const isExpanded = expandedIds.has(batch.id)
                const isBusy = pendingAction?.endsWith(batch.id)
                const aiProductCount = Number(batch.ai_product_count || 0)
                const productCount = Number(batch.product_count || batch.items_count || 0)
                const hasAiRemaining = productCount > 0 && aiProductCount < productCount
                const canDeleteCatalog = canDeletePublishedCatalog(batch.stage, batch.published_external_count, batch.catalog_deleted_at)
                const aiRunning = ['queued', 'running'].includes(batch.ai_run_status || '')
                const publishing = Boolean(batch.active_operation?.includes('publish'))
                const parsing = batch.status === 'Запущено'
                const displayedStatus = publishing ? 'Публикация в БД' : aiRunning ? 'Обработка ИИ' : batch.status
                const statusProgress = batchStatusProgress({ publishing, aiRunning, activeOperation: batch.active_operation, aiCompletedCount: batch.ai_completed_count, aiFailedCount: batch.ai_failed_count, aiTotalCount: batch.ai_total_count })
                const subtitle = batchSubtitle(batch.name, batch.supplier_name)

                return (
                  <React.Fragment key={batch.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-800 bg-slate-800/70 transition-colors hover:bg-slate-800"
                      onClick={() => toggleBatch(batch.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-slate-600 bg-slate-700">
                            {batch.supplier_avatar ? (
                              <img src={batch.supplier_avatar} alt={batch.supplier_name || ''} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-300">
                                {batch.supplier_name?.charAt(0).toUpperCase() || '?'}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{batch.supplier_name || 'Поставщик не найден'}</div>
                            {subtitle && <div className="truncate text-xs text-slate-500">{subtitle}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <select value={batch.folder_id || ''} onChange={(event) => moveBatch(batch, event.target.value)} disabled={batch.isSynthetic} className="max-w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 disabled:opacity-40">
                          <option value="">Без папки</option>
                          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-300">
                        <div className="flex flex-col gap-0.5 leading-4">
                          <span title="Дата начала">с {formatDate(batch.created_at)}</span>
                          <span className="text-xs text-slate-500" title="Период до">{batch.end_date ? `до ${formatDate(batch.end_date)}` : 'Весь период'}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-100">{batch.items_count} шт.</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={displayedStatus} loading={parsing || aiRunning || publishing} progress={statusProgress} />
                          {batch.catalog_deleted_at && <span className="text-[10px] text-amber-300">Локальная выгрузка сохранена</span>}
                        </div>
                      </td>
                      <td className="relative px-3 py-3 text-right">
                        <div className="ml-auto flex w-fit flex-nowrap items-center justify-end gap-0.5 whitespace-nowrap rounded-lg bg-slate-900/35 p-0.5">
                          {!batch.isSynthetic && hasAiRemaining && batch.status !== 'Удалено из БД' && (
                            <button onClick={(event) => { event.stopPropagation(); startAi(batch) }} disabled={pendingAction === `ai-${batch.id}` || ['queued','running'].includes(batch.ai_run_status || '')} className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50" title={aiProductCount > 0 ? 'Продолжить обработку остальных' : 'Обработать ИИ'} aria-label={aiProductCount > 0 ? 'Продолжить ИИ' : 'Обработать ИИ'}>
                              {pendingAction === `ai-${batch.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                            </button>
                          )}
                          {!batch.isSynthetic && ['queued', 'running'].includes(batch.ai_run_status || '') && (
                            <button
                              onClick={(event) => { event.stopPropagation(); stopAi(batch) }}
                              disabled={pendingAction === `stop-ai-${batch.id}`}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                              title="Остановить AI-обработку"
                              aria-label="Остановить AI-обработку"
                            >
                              {pendingAction === `stop-ai-${batch.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
                            </button>
                          )}
                          {!batch.isSynthetic && batch.supplier_id && (
                            <button onClick={(event) => { event.stopPropagation(); setPriceSupplier({ id: batch.supplier_id!, name: batch.supplier_name || 'Поставщик' }) }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-300 hover:bg-amber-500/10" title="Правила цен поставщика" aria-label="Правила цен"><BadgeRussianRuble className="h-4 w-4" /></button>
                          )}
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(openMenuId === batch.id ? null : batch.id)
                            }}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                            title="Действия"
                          >
                            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleBatch(batch.id)
                            }}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                            title={isExpanded ? 'Свернуть' : 'Раскрыть'}
                          >
                            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </button>
                        </div>

                        {openMenuId === batch.id && (
                          <div
                            className="absolute right-14 top-12 z-20 w-64 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 py-1 text-left shadow-2xl"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {!batch.isSynthetic && batch.supplier_id && (
                              <button
                                onClick={() => router.push(`/admin/suppliers?supplier=${batch.supplier_id}`)}
                                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
                              >
                                <Settings2 className="h-4 w-4 shrink-0" />
                                Настройки поставщика
                              </button>
                            )}
                            {canDeleteCatalog && !batch.isSynthetic && (
                              <button
                                onClick={() => handleDeleteFromCatalog(batch)}
                                disabled={isBusy}
                                className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-slate-600"
                              >
                                <Globe className="mt-0.5 h-4 w-4 shrink-0" />
                                <span><b className="block font-medium">Удалить с сайта</b><small className="block text-slate-500">Товары уйдут из каталога, локальная выгрузка останется</small></span>
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteFromDb(batch)}
                              disabled={batch.isSynthetic || batch.status === 'Удалено из БД' || isBusy}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
                            >
                              <Database className="h-4 w-4 shrink-0" />
                              Удалить локально
                            </button>
                            <button
                              onClick={() => handleDeleteBatchFromAdmin(batch)}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/10"
                            >
                              <ArchiveX className="h-4 w-4 shrink-0" />
                              Удалить из истории
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {isExpanded && batch.files.map((file) => (
                      <tr
                        key={file.id}
                        className={`${file.snapshot_missing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-800/60'} border-b border-slate-800 bg-slate-900 transition-colors`}
                        onClick={() => openFile(batch, file)}
                      >
                        <td className="px-6 py-4" colSpan={2}>
                          <div className="flex min-w-0 items-center gap-3 pl-4">
                            {file.result_path?.startsWith('db://')
                              ? <Database className="h-5 w-5 flex-shrink-0 text-slate-500" />
                              : <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-slate-500" />}
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-100">{file.label || fileName(file.result_path)}</div>
                              <div className="text-xs text-slate-600">{file.snapshot_missing ? 'Исторический снимок недоступен' : file.is_current ? 'Текущая редактируемая версия' : file.is_virtual ? 'Состояние товаров партии' : `Этап #${file.id} · только просмотр`}</div>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-400">
                          <div className="flex flex-col gap-0.5 leading-4">
                            <span title="Дата начала">с {formatDate(file.created_at)}</span>
                            <span className="text-xs text-slate-500" title="Период до">{file.end_date ? `до ${formatDate(file.end_date)}` : 'Весь период'}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-slate-300">{file.items_count || 0} шт.</td>
                        <td className="px-6 py-4"><StatusBadge status={file.status} loading={file.status === 'Запущено'} /></td>
                        <td className="px-6 py-4 text-right">
                          {file.snapshot_missing && file.status === 'Сырой товар' && <button
                            onClick={(event) => {
                              event.stopPropagation()
                              restoreRaw(batch, file)
                            }}
                            disabled={!file.raw_artifact_available || pendingAction === `restore-raw-${file.id}`}
                            className="mr-1 rounded-lg p-2 text-indigo-300 transition-colors hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:text-slate-600"
                            title={file.raw_artifact_available ? 'Восстановить сырой снимок из сохранённого файла' : 'Сохранённого файла для восстановления нет'}
                          >
                            {pendingAction === `restore-raw-${file.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          </button>}
                          {!file.is_virtual && <button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDeleteFileFromAdmin(batch, file)
                            }}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            title="Удалить этап из админки"
                          >
                            {pendingAction === `file-${file.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}

              {visibleBatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-slate-500">
                    Истории выгрузок пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
    </div>
  )
}

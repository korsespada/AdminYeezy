'use client'

import React, { useEffect, useState } from 'react'
import {
  ArchiveX,
  Bot,
  Calendar,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Send,
  Trash2,
  FolderPlus,
  RotateCcw,
  BadgeRussianRuble,
  Sparkles,
} from 'lucide-react'
import {
  deleteBatchAction,
  deleteExportBatchFromAdminAction,
  deleteExportFileFromAdminAction,
  getExportHistoryAction,
  pushBatchToCatalogAction,
  type ExportHistoryBatch,
  type ExportHistoryFile,
} from '@/actions/suppliers'
import CsvModal from './CsvModal'
import {
  createExportFolderAction,
  deleteExportFolderAction,
  getBatchSnapshotsAction,
  moveBatchToFolderAction,
  renameExportFolderAction,
  rollbackBatchAction,
  startBatchAiAction,
} from '@/actions/batch-ai'
import SupplierPriceRulesDialog from './SupplierPriceRulesDialog'
import BatchAiReviewDialog from './BatchAiReviewDialog'

type ModalState = {
  localPath: string
  rawPath?: string | null
  aiPath?: string | null
  supplierId: number | null
  batchId: string | null
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
  return filePath.split(/[\\/]/).pop() || filePath
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.failed}`}>
      {status === 'failed' ? 'Ошибка' : status}
    </span>
  )
}

export default function ExportHistoryList({ initialData, initialFolders }: { initialData: ExportHistoryBatch[]; initialFolders: any[] }) {
  const [batches, setBatches] = useState<ExportHistoryBatch[]>(initialData)
  const [folders, setFolders] = useState<any[]>(initialFolders)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialData[0] ? [initialData[0].id] : []))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [priceSupplier, setPriceSupplier] = useState<{ id: number; name: string } | null>(null)
  const [reviewBatch, setReviewBatch] = useState<ExportHistoryBatch | null>(null)

  const refresh = async () => {
    setIsRefreshing(true)
    const res = await getExportHistoryAction()
    if (res.success) setBatches(res.data)
    setIsRefreshing(false)
  }

  useEffect(() => {
    const hasRunning = batches.some((batch) => batch.status === 'Запущено' || ['queued', 'running'].includes(batch.ai_run_status || '') || batch.files.some((file) => file.status === 'Запущено'))
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
    setModalState({
      localPath: file.result_path || '',
      rawPath: batch.raw_path,
      aiPath: batch.ai_path,
      supplierId: file.supplier_id,
      batchId: file.batch_id,
      supplierName: file.supplier_name,
      supplierAvatar: file.supplier_avatar,
      forceFileMode: Boolean(file.result_path),
    })
  }

  const openBatchProducts = (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    setModalState({
      localPath: '',
      rawPath: batch.raw_path,
      aiPath: batch.ai_path,
      supplierId: batch.supplier_id,
      batchId: batch.id,
      supplierName: batch.supplier_name,
      supplierAvatar: batch.supplier_avatar,
      forceFileMode: false,
    })
  }

  const handleDeleteFromDb = async (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(`Удалить товары и фотографии S3 для выгрузки "${batch.name}"? Файлы CSV останутся в истории.`)) return

    setPendingAction(`db-${batch.id}`)
    const res = await deleteBatchAction(batch.id)
    if (res.success) {
      setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, status: 'Удалено из БД' } : item))
      alert(`Удалено продуктов: ${res.deletedCount || 0}`)
    } else {
      alert(`Ошибка при удалении из БД: ${res.error}`)
    }
    setPendingAction(null)
    setOpenMenuId(null)
  }

  const handleDeleteBatchFromAdmin = async (batch: ExportHistoryBatch) => {
    if (!confirm(`Удалить выгрузку "${batch.name}" из админки и удалить связанные CSV-файлы?`)) return

    setPendingAction(`admin-${batch.id}`)
    const res = batch.isSynthetic
      ? await deleteExportFileFromAdminAction(batch.files[0].id)
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
    if (!confirm(`Удалить этап "${fileName(file.result_path)}" из админки?`)) return

    setPendingAction(`file-${file.id}`)
    const res = await deleteExportFileFromAdminAction(file.id)
    if (res.success) {
      setBatches((prev) => prev
        .map((item) => item.id === batch.id ? { ...item, files: item.files.filter((f) => f.id !== file.id) } : item)
        .filter((item) => item.files.length > 0))
    } else {
      alert(`Ошибка при удалении файла: ${res.error}`)
    }
    setPendingAction(null)
  }

  const handlePushBatch = async (batch: ExportHistoryBatch) => {
    if (batch.isSynthetic) return
    if (!confirm(`Запушить товары выгрузки "${batch.name}" в каталог?`)) return

    setPendingAction(`push-${batch.id}`)
    const res = await pushBatchToCatalogAction(batch.id)
    if (res.success) {
      const pushed = res.data?.success || 0
      const failed = res.data?.failed || 0
      setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, status: 'Запушено в БД' } : item))
      alert(`Пуш завершен. Успешно: ${pushed}, ошибок: ${failed}`)
    } else {
      alert(`Ошибка пуша: ${res.error}`)
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

  const startAi = async (batch: ExportHistoryBatch, mode: 'sample' | 'full') => {
    setPendingAction(`ai-${batch.id}`)
    const result = await startBatchAiAction(batch.id, mode)
    if (result.success) {
      const data: any = result.data
      alert(data?.provider === 'cockpit' ? `В очередь отправлено: ${data.queued}` : `ИИ завершён. Успешно: ${data?.completed_count || 0}, ошибок: ${data?.failed_count || 0}`)
      await refresh()
    } else alert(`Ошибка ИИ: ${result.error}`)
    setPendingAction(null)
  }

  const rollback = async (batch: ExportHistoryBatch) => {
    const result = await getBatchSnapshotsAction(batch.id)
    if (!result.success || !result.data?.length) return alert('Снимков для отката нет')
    const list = result.data.map((snapshot: any, index: number) => `${index + 1}. ${snapshot.label} · ${formatDate(snapshot.created_at)} · ${snapshot.items_count} шт.`).join('\n')
    const selected = Number(prompt(`Выберите снимок для полного отката:\n${list}`))
    const snapshot = result.data[selected - 1]
    if (!snapshot || !confirm('Поздние снимки и AI-версии будут удалены. Продолжить?')) return
    const rollbackResult = await rollbackBatchAction(batch.id, snapshot.id)
    if (rollbackResult.success) await refresh()
    else alert(rollbackResult.error)
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

      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed text-left">
            <colgroup>
              <col className="w-[29%]" /><col className="w-[12%]" /><col className="w-[10%]" />
              <col className="w-[8%]" /><col className="w-[13%]" /><col className="w-[10%]" /><col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-700 bg-slate-950/60">
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Поставщик</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Папка</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Дата начала</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Товаров</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Статус</th>
                <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Период до</th>
                <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleBatches.map((batch) => {
                const isExpanded = expandedIds.has(batch.id)
                const isBusy = pendingAction?.endsWith(batch.id)

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
                            <div className="truncate text-xs text-slate-500">{batch.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <select value={batch.folder_id || ''} onChange={(event) => moveBatch(batch, event.target.value)} disabled={batch.isSynthetic} className="max-w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 disabled:opacity-40">
                          <option value="">Без папки</option>
                          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-300">{formatDate(batch.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-100">{batch.items_count} шт.</td>
                      <td className="px-4 py-3"><StatusBadge status={batch.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-300">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {batch.end_date && <Calendar className="h-3.5 w-3.5 text-slate-500" />}
                          {batch.end_date || '—'}
                        </span>
                      </td>
                      <td className="relative px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          {!batch.isSynthetic && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                openBatchProducts(batch)
                              }}
                              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
                              title="Открыть текущие товары партии из БД"
                            >
                              БД
                            </button>
                          )}
                          {!batch.isSynthetic && batch.status !== 'Запушено в БД' && batch.status !== 'Удалено из БД' && (
                            <button onClick={(event) => { event.stopPropagation(); startAi(batch, batch.ai_completed_count ? 'full' : 'sample') }} disabled={pendingAction === `ai-${batch.id}` || ['queued','running'].includes(batch.ai_run_status || '')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-50" title={batch.ai_completed_count ? 'Продолжить обработку остальных' : 'Проверить ИИ на 10 случайных товарах'}>
                              {pendingAction === `ai-${batch.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                              {batch.ai_completed_count ? 'Продолжить ИИ' : 'Тест ИИ · 10'}
                            </button>
                          )}
                          {!batch.isSynthetic && batch.supplier_id && (
                            <button onClick={(event) => { event.stopPropagation(); setPriceSupplier({ id: batch.supplier_id!, name: batch.supplier_name || 'Поставщик' }) }} className="rounded-lg p-2 text-amber-300 hover:bg-amber-500/10" title="Правила цен поставщика"><BadgeRussianRuble className="h-4 w-4" /></button>
                          )}
                          {!batch.isSynthetic && Boolean(batch.ai_completed_count) && (
                            <button onClick={(event) => { event.stopPropagation(); setReviewBatch(batch) }} className="rounded-lg p-2 text-violet-300 hover:bg-violet-500/10" title="Предложения ИИ"><Sparkles className="h-4 w-4" /></button>
                          )}
                          {!batch.isSynthetic && batch.status !== 'Запушено в БД' && batch.status !== 'Удалено из БД' && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                handlePushBatch(batch)
                              }}
                              disabled={pendingAction === `push-${batch.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-60"
                              title="Запушить товары в каталог"
                            >
                              {pendingAction === `push-${batch.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              Пуш
                            </button>
                          )}
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(openMenuId === batch.id ? null : batch.id)
                            }}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                            title="Действия"
                          >
                            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleBatch(batch.id)
                            }}
                            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
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
                            <button
                              onClick={() => rollback(batch)}
                              disabled={batch.isSynthetic}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-amber-300 transition-colors hover:bg-amber-500/10 disabled:text-slate-600"
                            >
                              <RotateCcw className="h-4 w-4" /> Полный откат
                            </button>
                            <button
                              onClick={() => handleDeleteFromDb(batch)}
                              disabled={batch.isSynthetic || batch.status === 'Удалено из БД'}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
                            >
                              <Database className="h-4 w-4" />
                              Удалить выгрузку из БД
                            </button>
                            <button
                              onClick={() => handleDeleteBatchFromAdmin(batch)}
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/10"
                            >
                              <ArchiveX className="h-4 w-4" />
                              Удалить из админки
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {isExpanded && batch.files.map((file) => (
                      <tr
                        key={file.id}
                        className="cursor-pointer border-b border-slate-800 bg-slate-900 transition-colors hover:bg-slate-800/60"
                        onClick={() => openFile(batch, file)}
                      >
                        <td className="px-6 py-4" colSpan={2}>
                          <div className="flex min-w-0 items-center gap-3 pl-4">
                            <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-slate-500" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-100">{fileName(file.result_path)}</div>
                              <div className="text-xs text-slate-600">Файл #{file.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">{formatDate(file.created_at)}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-slate-300">{file.items_count || 0} шт.</td>
                        <td className="px-6 py-4"><StatusBadge status={file.status} /></td>
                        <td className="px-6 py-4 text-sm text-slate-400">{file.end_date || '—'}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDeleteFileFromAdmin(batch, file)
                            }}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            title="Удалить файл из админки"
                          >
                            {pendingAction === `file-${file.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}

              {visibleBatches.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-slate-500">
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
        supplierName={modalState?.supplierName}
        supplierAvatar={modalState?.supplierAvatar}
        forceFileMode={modalState?.forceFileMode}
      />
      {priceSupplier && <SupplierPriceRulesDialog supplierId={priceSupplier.id} supplierName={priceSupplier.name} onClose={() => setPriceSupplier(null)} />}
      {reviewBatch && <BatchAiReviewDialog batchId={reviewBatch.id} batchName={reviewBatch.name} onClose={() => setReviewBatch(null)} />}
    </div>
  )
}

'use client'

import React, { useEffect, useState } from 'react'
import {
  ArchiveX,
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
  'Сырой CSV': 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  'Обработано скриптом': 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  'Обработано ИИ': 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  'Запушено': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
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
    <span className={`inline-flex min-w-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.failed}`}>
      {status === 'failed' ? 'Ошибка' : status}
    </span>
  )
}

export default function ExportHistoryList({ initialData }: { initialData: ExportHistoryBatch[] }) {
  const [batches, setBatches] = useState<ExportHistoryBatch[]>(initialData)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialData[0] ? [initialData[0].id] : []))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [modalState, setModalState] = useState<ModalState | null>(null)

  const refresh = async () => {
    setIsRefreshing(true)
    const res = await getExportHistoryAction()
    if (res.success) setBatches(res.data)
    setIsRefreshing(false)
  }

  useEffect(() => {
    const hasRunning = batches.some((batch) => batch.status === 'Запущено' || batch.files.some((file) => file.status === 'Запущено'))
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
      setBatches((prev) => prev.map((item) => item.id === batch.id ? { ...item, status: 'Запушено' } : item))
      alert(`Пуш завершен. Успешно: ${pushed}, ошибок: ${failed}`)
    } else {
      alert(`Ошибка пуша: ${res.error}`)
    }
    setPendingAction(null)
  }

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

      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-950/60">
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Поставщик</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Дата начала</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Товаров</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Статус</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Период до</th>
                <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">Действия</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const isExpanded = expandedIds.has(batch.id)
                const isBusy = pendingAction?.endsWith(batch.id)

                return (
                  <React.Fragment key={batch.id}>
                    <tr
                      className="cursor-pointer border-b border-slate-800 bg-slate-800/70 transition-colors hover:bg-slate-800"
                      onClick={() => toggleBatch(batch.id)}
                    >
                      <td className="px-6 py-5">
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
                      <td className="px-6 py-5 text-sm text-slate-300">{formatDate(batch.created_at)}</td>
                      <td className="px-6 py-5 text-sm font-semibold text-slate-100">{batch.items_count} шт.</td>
                      <td className="px-6 py-5"><StatusBadge status={batch.status} /></td>
                      <td className="px-6 py-5 text-sm text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          {batch.end_date && <Calendar className="h-3.5 w-3.5 text-slate-500" />}
                          {batch.end_date || '—'}
                        </span>
                      </td>
                      <td className="relative px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
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
                          {!batch.isSynthetic && batch.status !== 'Запушено' && batch.status !== 'Удалено из БД' && (
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
                        <td className="px-6 py-4">
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

              {batches.length === 0 && (
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
        supplierName={modalState?.supplierName}
        supplierAvatar={modalState?.supplierAvatar}
        forceFileMode={modalState?.forceFileMode}
      />
    </div>
  )
}

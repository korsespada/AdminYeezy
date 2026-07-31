'use client'

import React, { useEffect, useState } from 'react'
import { getTasksAction, deleteTaskAction } from '@/actions/suppliers'
import { Clock, CheckCircle2, XCircle, Loader2, Download, TableProperties, Calendar, Trash2, Eye } from 'lucide-react'
import Link from 'next/link'

import { useRouter } from 'next/navigation'
import CsvModal from '@/components/import/CsvModal'

interface ScrapingTask {
  id: number
  supplier_id: number
  supplier_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'Сырой CSV' | 'Сырой товар' | 'Обработано скриптом' | 'Обработано ИИ'
  end_date: string
  result_path: string
  error_message: string
  items_count?: number
  created_at: string
  updated_at: string
  batch_stage?: string
  batch_id?: string
  supplier_avatar?: string
}

export default function ScrapingTaskList({ initialData }: { initialData: ScrapingTask[] }) {
  const router = useRouter()
  const [tasks, setTasks] = useState<ScrapingTask[]>(initialData)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState("")
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [selectedSupplierName, setSelectedSupplierName] = useState<string | null>(null)
  const [selectedSupplierAvatar, setSelectedSupplierAvatar] = useState<string | null>(null)

  const openModal = (path: string, suppId: number, batchId?: string, suppName?: string, suppAvatar?: string) => {
    setSelectedPath(path)
    setSelectedSupplierId(suppId)
    setSelectedBatchId(batchId || null)
    setSelectedSupplierName(suppName || null)
    setSelectedSupplierAvatar(suppAvatar || null)
    setModalOpen(true)
  }

  const refreshTasks = async () => {
    setIsRefreshing(true)
    const res = await getTasksAction()
    if (res.success) {
      setTasks(res.data)
    }
    setIsRefreshing(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить эту запись из истории?')) return
    
    const res = await deleteTaskAction(id)
    if (res.success) {
      setTasks(prev => prev.filter(t => t.id !== id))
    } else {
      alert('Ошибка при удалении: ' + res.error)
    }
  }

  // Auto-refresh if there are running tasks
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'pending')
    if (hasRunning) {
      const interval = setInterval(refreshTasks, 3000)
      return () => clearInterval(interval)
    }
  }, [tasks])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'Сырой CSV':
      case 'Сырой товар':
      case 'Обработано скриптом':
      case 'Обработано ИИ':
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'running':
        return <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
      default:
        return <Clock className="w-5 h-5 text-slate-400" />
    }
  }

  const getStatusBadge = (task: ScrapingTask) => {
    // 0. Определяем статус на основе файла (для надежности)
    const isAiFile = task.result_path?.includes('task_ai_')
    const currentTaskStatus = isAiFile ? 'Обработано ИИ' : task.status

    // 1. Если это определенный статус файла, всегда показываем его, даже если партия уже в процессе
    if (currentTaskStatus === 'Сырой CSV' || currentTaskStatus === 'Сырой товар' || currentTaskStatus === 'Обработано скриптом') {
       const labels: Record<string, string> = {
         'Сырой CSV': 'СОБРАНО (RAW)',
         'Сырой товар': 'СЫРОЙ ТОВАР',
         'Обработано скриптом': 'ОБРАБОТАНО СКРИПТОМ'
       };
       const colors: Record<string, string> = {
         'Сырой CSV': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
         'Сырой товар': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
         'Обработано скриптом': 'bg-amber-500/10 text-amber-400 border-amber-500/20'
       };
       return (
         <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${colors[currentTaskStatus]}`}>
           {labels[currentTaskStatus]}
         </span>
       )
    }

    // 2. Проверяем стадию партии, если она привязана (для запушенных и т.д.)
    if (task.batch_stage) {
       const stageMap: Record<string, { label: string, color: string }> = {
         'SCRAPED': { label: 'СОБРАНО', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
         'SCRIPT_PROCESSED': { label: 'ОБРАБОТАНО СКРИПТОМ', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
         'AI_PROCESSED': { label: 'ОБРАБОТАНО ИИ', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
         'PUSHED': { label: 'ЗАПУШЕНО', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' }
       }
       const info = stageMap[task.batch_stage]
       if (info) {
          return (
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${info.color}`}>
              {info.label}
            </span>
          )
       }
    }

    // 3. Если стадии партии нет или это специфичный статус задачи
    const currentStatus = isAiFile ? 'Обработано ИИ' : task.status
    
    const colors: Record<string, string> = {
      'Сырой CSV': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      'Сырой товар': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      'Обработано скриптом': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      'Обработано ИИ': 'bg-violet-500/10 text-violet-400 border-violet-500/20',
      'completed': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      'failed': 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      'running': 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      'pending': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    }

    const labels: Record<string, string> = {
      'Сырой CSV': 'СОБРАНО (RAW)',
      'Сырой товар': 'СЫРОЙ ТОВАР',
      'Обработано скриптом': 'ОБРАБОТАНО СКРИПТОМ',
      'Обработано ИИ': 'ОБРАБОТАНО ИИ',
      'completed': 'СОБРАНО',
      'failed': 'ОШИБКА',
      'running': 'В ПРОЦЕССЕ',
      'pending': 'В ОЧЕРЕДИ',
    }

    return (
      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${colors[task.status] || colors.pending}`}>
        {labels[currentStatus] || currentStatus.toUpperCase()}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">История выгрузок</h2>
        <button
          onClick={refreshTasks}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors border border-slate-700"
        >
          <Loader2 className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-700">
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">ID</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Поставщик</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Дата начала</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Товаров</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Статус</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Период до</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {tasks.map(t => (
                <tr 
                  key={t.id} 
                  className={`hover:bg-slate-700/30 transition-colors group ${t.status !== 'running' && t.status !== 'pending' && t.status !== 'failed' ? 'cursor-pointer' : ''}`}
                  onClick={() => {
                    const isClickable = t.status !== 'running' && t.status !== 'pending' && t.status !== 'failed';
                    if (isClickable && t.result_path) {
                      openModal(t.result_path, t.supplier_id, t.batch_id, t.supplier_name, t.supplier_avatar)
                    }
                  }}
                >
                  <td className="px-6 py-4 text-sm text-slate-400 font-mono">#{t.id}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 border border-slate-600 flex items-center justify-center">
                        {t.supplier_avatar ? (
                          <img src={t.supplier_avatar} alt={t.supplier_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-slate-400">
                            {t.supplier_name?.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-white">{t.supplier_name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(t.created_at).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-6 py-4">
                    {t.result_path ? (
                      <span className="text-sm font-bold text-emerald-400">{t.items_count || 0} шт.</span>
                    ) : (
                      <span className="text-sm text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(t.status)}
                      {getStatusBadge(t)}
                    </div>
                    {t.error_message && (
                       <div className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate">{t.error_message}</div>
                    )}
                  </td>
                   <td className="px-6 py-4 text-sm text-slate-400">
                    {t.end_date ? (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {t.end_date}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                        {/* Кнопка удалена по просьбе пользователя */}
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(t.id)
                          }}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all"
                          title="Удалить из истории"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
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
         isOpen={modalOpen} 
         onClose={() => setModalOpen(false)} 
         localPath={selectedPath} 
         supplierId={selectedSupplierId} 
         batchId={selectedBatchId} 
         supplierName={selectedSupplierName}
         supplierAvatar={selectedSupplierAvatar}
      />
    </div>
  )
}

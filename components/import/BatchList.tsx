'use client'

import React, { useEffect, useState } from 'react'
import { getBatchesAction, deleteBatchAction } from '@/actions/suppliers'
import { RefreshCw, Trash2, Calendar, Package, User, Loader2, AlertCircle } from 'lucide-react'
import CsvModal from './CsvModal'

interface Batch {
  id: string
  supplier_id: number
  supplier_name: string
  name: string
  items_count: number
  stage: 'SCRAPED' | 'AI_PROCESSED' | 'PUSHED'
  created_at: string
  raw_path?: string
  ai_path?: string
  supplier_avatar?: string
}

export default function BatchList({ initialData }: { initialData: Batch[] }) {
  const [batches, setBatches] = useState<Batch[]>(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedRawPath, setSelectedRawPath] = useState("")
  const [selectedAiPath, setSelectedAiPath] = useState("")
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [selectedSupplierName, setSelectedSupplierName] = useState<string | null>(null)
  const [selectedSupplierAvatar, setSelectedSupplierAvatar] = useState<string | null>(null)

  const openModal = (batch: Batch) => {
    setSelectedRawPath(batch.raw_path || "")
    setSelectedAiPath(batch.ai_path || "")
    setSelectedSupplierId(batch.supplier_id)
    setSelectedBatchId(batch.id)
    setSelectedSupplierName(batch.supplier_name)
    setSelectedSupplierAvatar(batch.supplier_avatar || null)
    setModalOpen(true)
  }

  const getStatusInfo = (stage: string) => {
    switch (stage) {
      case 'SCRAPED': return { label: 'Этап 1: Собрано', color: 'bg-blue-500', step: 1 }
      case 'AI_PROCESSED': return { label: 'Этап 2: Обработано ИИ', color: 'bg-indigo-500', step: 2 }
      case 'PUSHED': return { label: 'Этап 3: В каталоге', color: 'bg-emerald-500', step: 3 }
      default: return { label: 'Собрано', color: 'bg-slate-500', step: 1 }
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Удалить локальные товары партии "${name}"? Основной каталог не будет затронут. Это действие нельзя отменить.`)) {
      return
    }

    setDeletingId(id)
    const res = await deleteBatchAction(id)
    if (res.success) {
      setBatches(prev => prev.filter(b => b.id !== id))
      const catalogMessage = res.catalogSkipped
        ? 'Основной каталог не затронут: партия не была опубликована.'
        : res.catalogDeletedCount !== undefined
        ? `Из каталога удалено: ${res.catalogDeletedCount}, архивировано: ${res.catalogArchivedCount || 0}, ошибок: ${res.catalogFailedCount || 0}${res.catalogProtectedCount ? `, защищено как общие: ${res.catalogProtectedCount}` : ''}`
        : 'Из каталога: не проверено'
      alert(`Локально удалено: ${res.deletedCount || 0}\n${catalogMessage}`)
    } else {
      alert(`Ошибка при удалении: ${res.error}`)
    }
    setDeletingId(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <RefreshCw className="w-6 h-6 text-orange-400" />
          Контент-центр: Выгрузки
        </h2>
        <p className="text-sm text-slate-400 max-w-md text-right">
          Управление версиями товаров: от сбора данных до публикации в магазин.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {batches.map(b => {
          const info = getStatusInfo(b.stage)
          return (
            <div 
              key={b.id} 
              className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg hover:border-slate-600 transition-all flex flex-col cursor-pointer"
              onClick={() => openModal(b)}
            >
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${info.color} text-white`}>
                    {info.label}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(b.id, b.name); }}
                    disabled={deletingId === b.id}
                    className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all disabled:opacity-50"
                    title="Удалить версию"
                  >
                    {deletingId === b.id ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5" />
                    )}
                  </button>
                </div>

                <h3 className="text-lg font-bold text-white mb-1 line-clamp-1">{b.name}</h3>
                <p className="text-xs text-slate-500 font-mono mb-4">ID: {b.id.slice(0, 8)}...</p>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <div className="w-5 h-5 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 border border-slate-600 flex items-center justify-center">
                        {b.supplier_avatar ? (
                          <img src={b.supplier_avatar} alt={b.supplier_name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500">
                            {b.supplier_name?.charAt(0).toUpperCase()}
                          </span>
                        )}
                    </div>
                    <span>{b.supplier_name || '—'}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Прогресс этапов</span>
                      <span>{info.step} / 3</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden flex">
                      <div className={`h-full ${info.color}`} style={{ width: `${(info.step / 3) * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="px-5 py-3 bg-slate-900/50 border-t border-slate-700 flex justify-between items-center">
                 <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Товаров</span>
                      <span className="text-sm font-bold text-white">{b.items_count}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase font-bold">Дата</span>
                      <span className="text-sm text-white">{new Date(b.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                 </div>
                 <div className="flex gap-1">
                    {[1, 2, 3].map(i => (
                      <div 
                        key={i} 
                        className={`w-2 h-2 rounded-full ${i <= info.step ? info.color : 'bg-slate-700'}`} 
                      />
                    ))}
                 </div>
              </div>
            </div>
          )
        })}
        
        {batches.length === 0 && (
          <div className="col-span-full py-20 text-center bg-slate-800/50 rounded-2xl border border-slate-700 border-dashed">
             <RefreshCw className="w-12 h-12 text-slate-600 mx-auto mb-4" />
             <h3 className="text-lg font-medium text-slate-400">Выгрузки пока не созданы</h3>
             <p className="text-sm text-slate-500 mt-2">Они появятся здесь после того, как вы выполните импорт с указанием «Названия партии».</p>
          </div>
        )}
      </div>

      <CsvModal 
         isOpen={modalOpen} 
         onClose={() => setModalOpen(false)} 
         rawPath={selectedRawPath}
         aiPath={selectedAiPath}
         supplierId={selectedSupplierId} 
         batchId={selectedBatchId} 
         supplierName={selectedSupplierName}
         supplierAvatar={selectedSupplierAvatar}
      />
    </div>
  )
}

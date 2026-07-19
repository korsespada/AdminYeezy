'use client'

import React, { useState } from 'react'
import { Plus, Edit2, Trash2, Play, ExternalLink, Calendar, Search, X, PlusCircle, RefreshCw, Image as ImageIcon, Star, HelpCircle } from 'lucide-react'
import { createSupplierAction, updateSupplierAction, deleteSupplierAction, startScrapingAction, fetchSupplierAvatarAction, toggleSupplierFavoriteAction } from '@/actions/suppliers'
import { useRouter } from 'next/navigation'
import { imagePresets, resizeImageUrl } from '@/lib/image'
import {
  SUPPLIER_ATTRIBUTE_DEFINITIONS,
  getSupplierAttributeLabel,
  normalizeSupplierAttributeCodes,
} from '@/lib/supplier-attributes'

interface Supplier {
  id: number
  name: string
  album_id: string
  group_id: string
  tag_id: string
  default_category: string
  default_subcategory: string
  default_brand: string
  default_category_name?: string | null
  default_subcategory_name?: string | null
  default_brand_name?: string | null
  default_attributes: string[]
  min_photos: number
  min_desc_len: number
  brand_tags: string
  default_price: number | null
  default_gender: string | null
  ai_photo_enabled: boolean
  ai_cache_enabled: boolean
  ai_deep_search_enabled: boolean
  ai_resize_enabled: boolean
  ai_instructions?: string | null
  avatar_url?: string | null
  cookie?: string | null
  post_process_script?: string | null
  post_process_enabled: boolean
  ai_photo_models?: string | null
  ai_photo_instructions?: string | null
  ai_parallel_enabled: boolean
  ai_parallel_count: number
  parse_tags_enabled: boolean
  is_favorite?: boolean
}

interface TagRow {
  type: 'tag' | 'group'
  label: string
  value: string
}

type CatalogLookup = {
  id: string
  name: string
  parent_id?: string | null
}

type SupplierCatalogLookups = {
  brands: CatalogLookup[]
  categories: CatalogLookup[]
  subcategories: CatalogLookup[]
}

export default function SupplierList({
  initialData,
  catalogLookups,
}: {
  initialData: Supplier[]
  catalogLookups: SupplierCatalogLookups
}) {
  const router = useRouter()
  const normalizedInitialData = React.useMemo(
    () => initialData.map((supplier) => ({
      ...supplier,
      default_attributes: normalizeSupplierAttributeCodes(supplier.default_attributes),
    })),
    [initialData],
  )
  const [suppliers, setSuppliers] = useState<Supplier[]>(normalizedInitialData)

  // Обновляем локальный список, когда приходят свежие данные с сервера
  React.useEffect(() => {
    setSuppliers(normalizedInitialData)
  }, [normalizedInitialData])

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [isScrapingModalOpen, setIsScrapingModalOpen] = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [endDate, setEndDate] = useState('')
  const [overrideValue, setOverrideValue] = useState('') // Format: "type:id"

  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)

  const toggleFavorite = async (id: number) => {
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, is_favorite: !s.is_favorite } : s))
    const res = await toggleSupplierFavoriteAction(id)
    if (!res.success) {
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, is_favorite: !s.is_favorite } : s))
      alert(res.error)
    } else {
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, is_favorite: res.data } : s))
    }
  }

  // Dynamic tags in modal
  const [modalTags, setModalTags] = useState<TagRow[]>([])

  const parseBrandTags = (tagsStr: string): TagRow[] => {
    if (!tagsStr) return []
    return tagsStr.split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('=') && line.includes(':'))
      .map(line => {
        const [typePart, rest] = line.split(':')
        const [label, value] = rest.split('=')
        return {
          type: typePart.trim() as 'tag' | 'group',
          label: label.trim(),
          value: value.trim()
        }
      })
  }

  const handleOpenModal = (supplier: Supplier | null = null) => {
    if (supplier) {
      setEditingSupplier(supplier)
      setModalTags(parseBrandTags(supplier.brand_tags))
    } else {
      setEditingSupplier({
        id: 0,
        name: '',
        album_id: '',
        group_id: '',
        tag_id: '',
        default_category: '',
        default_subcategory: '',
        default_brand: '',
        default_attributes: [],
        min_photos: 0,
        min_desc_len: 0,
        brand_tags: '',
        default_price: null,
        default_gender: '',
        ai_photo_enabled: false,
        ai_cache_enabled: false,
        ai_deep_search_enabled: false,
        ai_resize_enabled: true,
        ai_instructions: '',
        ai_photo_models: '',
        ai_photo_instructions: '',
        ai_parallel_enabled: false,
        ai_parallel_count: 5,
        parse_tags_enabled: false,
        post_process_enabled: false,
        is_favorite: false
      })
      setModalTags([])
    }
    setIsModalOpen(true)
  }

  const handleAddTagRow = () => {
    setModalTags([...modalTags, { type: 'tag', label: '', value: '' }])
  }

  const handleRemoveTagRow = (index: number) => {
    setModalTags(modalTags.filter((_, i) => i !== index))
  }

  const handleTagChange = (index: number, key: keyof TagRow, val: string) => {
    const newTags = [...modalTags]
    // @ts-ignore
    newTags[index][key] = val
    setModalTags(newTags)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    // Join tags back into string with format type:label=value
    const tagsStr = modalTags
      .filter(t => t.label.trim() && t.value.trim())
      .map(t => `${t.type}:${t.label.trim()}=${t.value.trim()}`)
      .join('\n')

    formData.set('brand_tags', tagsStr)
    
    // Explicitly set checkboxes from state/form to ensure they are captured correctly
    const aiPhotoValue = editingSupplier?.ai_photo_enabled ? 'on' : 'off'
    const aiCacheValue = editingSupplier?.ai_cache_enabled ? 'on' : 'off'
    const aiDeepSearchValue = editingSupplier?.ai_deep_search_enabled ? 'on' : 'off'
    const aiResizeValue = editingSupplier?.ai_resize_enabled ? 'on' : 'off'
    const parseTagsValue = editingSupplier?.parse_tags_enabled ? 'on' : 'off'
    const postProcessValue = editingSupplier?.post_process_enabled ? 'on' : 'off'
    
    formData.set('ai_photo_enabled', aiPhotoValue)
    formData.set('ai_cache_enabled', aiCacheValue)
    formData.set('ai_deep_search_enabled', aiDeepSearchValue)
    formData.set('ai_resize_enabled', aiResizeValue)
    formData.set('parse_tags_enabled', parseTagsValue)
    formData.set('post_process_enabled', postProcessValue)
    formData.set('default_attributes', JSON.stringify(editingSupplier?.default_attributes || []))

    let res
    if (editingSupplier && editingSupplier.id !== 0) {
      res = await updateSupplierAction(editingSupplier.id, formData)
    } else {
      res = await createSupplierAction(formData)
    }

    if (res.success) {
      setIsModalOpen(false)
      // Если это новый поставщик, запускаем получение аватарки
      if (editingSupplier?.id === 0 && res.data) {
        handleFetchAvatar(res.data)
      }
      router.refresh()
    } else {
      alert(res.error)
    }
  }

  const handleFetchAvatar = async (id: number) => {
    const res = await fetchSupplierAvatarAction(id)
    if (res.success) {
      setSuppliers(prev => prev.map(s => s.id === id ? { ...s, avatar_url: res.data } : s))
    } else {
      alert(res.error)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить этого поставщика?')) return
    const res = await deleteSupplierAction(id)
    if (res.success) {
      setSuppliers(prev => prev.filter(s => s.id !== id))
    } else {
      alert(res.error)
    }
  }

  const handleStartScrape = async () => {
    if (!selectedSupplierId) return

    let tag: string | undefined = undefined
    let group: string | undefined = undefined

    if (overrideValue) {
      const [type, id] = overrideValue.split(':')
      if (type === 'tag') tag = id
      if (type === 'group') group = id
    }

    const res = await startScrapingAction(selectedSupplierId, endDate, tag, group)
    if (res.success) {
      alert('Выгрузка запущена! Проверьте статус в разделе "Выгрузки".')
      setIsScrapingModalOpen(false)
    } else {
      alert(res.error)
    }
  }

  const [isFetchingAll, setIsFetchingAll] = useState(false)

  const handleFetchAllAvatars = async () => {
    if (!confirm('Запустить массовое обновление аватарок для всех поставщиков без фото? Это может занять некоторое время.')) return

    setIsFetchingAll(true)
    const withoutAvatars = suppliers.filter(s => !s.avatar_url)

    for (const s of withoutAvatars) {
      const res = await fetchSupplierAvatarAction(s.id)
      if (res.success) {
        setSuppliers(prev => prev.map(item => item.id === s.id ? { ...item, avatar_url: res.data } : item))
      }
    }

    setIsFetchingAll(false)
    alert('Обновление завершено!')
  }

  const getOptimizedAvatarUrl = (url: string | null | undefined) => resizeImageUrl(url, imagePresets.avatar)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          Управление поставщиками
          <span className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-sm font-medium text-slate-400">
            {suppliers.length}
          </span>
        </h2>
        <div className="flex gap-3">
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors border ${showFavoritesOnly ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
          >
            <Star className={`w-5 h-5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
            Избранные
          </button>
          <button
            onClick={handleFetchAllAvatars}
            disabled={isFetchingAll}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${isFetchingAll ? 'animate-spin' : ''}`} />
            Обновить аватарки
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            Добавить поставщика
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suppliers.filter(s => showFavoritesOnly ? s.is_favorite : true).map(s => {
          const brandTags = parseBrandTags(s.brand_tags)
          const isFav = Boolean(s.is_favorite)
          return (
            <div key={s.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-lg group flex flex-col h-full">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-4 gap-3">
                  <div className="flex gap-4 flex-1 overflow-hidden">
                    <div className="relative group/avatar shrink-0">
                      {s.avatar_url ? (
                        <img
                          src={getOptimizedAvatarUrl(s.avatar_url)}
                          alt={s.name}
                          className="w-14 h-14 rounded-full object-cover border-2 border-slate-700 shadow-inner group-hover/avatar:border-indigo-500 transition-all"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center border-2 border-slate-600 shadow-inner">
                          <ImageIcon className="w-6 h-6 text-slate-500" />
                        </div>
                      )}
                      <button
                        onClick={() => handleFetchAvatar(s.id)}
                        className="absolute -bottom-1 -right-1 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg scale-0 group-hover/avatar:scale-100 transition-all duration-200 focus:outline-none"
                        title="Обновить аватарку"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors truncate">{s.name}</h3>
                      <p className="text-[11px] text-slate-500 font-mono mt-1 truncate" title={`Album ID: ${s.album_id}`}>Album ID: {s.album_id}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => toggleFavorite(s.id)}
                      className={`p-2 rounded-lg transition-all ${isFav ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10' : 'text-slate-400 hover:text-yellow-400 hover:bg-yellow-400/10'}`}
                      title="В избранное"
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleOpenModal(s)}
                      className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  {(s.min_photos > 0 || s.min_desc_len > 0) && (
                    <div className="flex gap-2 items-center">
                      {s.min_photos > 0 && (
                        <div className="px-2 py-1 bg-slate-900/80 border border-slate-700/50 rounded text-[10px] font-bold flex items-center shadow-sm">
                          <span className="text-slate-500 mr-1.5 text-[9px] uppercase tracking-wider">мин. фото:</span>
                          <span className="text-emerald-400">{s.min_photos}</span>
                        </div>
                      )}
                      {s.min_desc_len > 0 && (
                        <div className="px-2 py-1 bg-slate-900/80 border border-slate-700/50 rounded text-[10px] font-bold flex items-center shadow-sm">
                          <span className="text-slate-500 mr-1.5 text-[9px] uppercase tracking-wider">мин. символов:</span>
                          <span className="text-indigo-400">{s.min_desc_len}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {brandTags.length > 0 && (
                    <div className="pt-2 border-t border-slate-700/50">
                      <div className="text-[10px] uppercase font-bold text-slate-500 mb-1.5 flex justify-between">
                        <span>Тэги брендов</span>
                        <span>{brandTags.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {brandTags.slice(0, 5).map(bt => (
                          <div key={bt.value} className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-400">
                            {bt.label}
                          </div>
                        ))}
                        {brandTags.length > 5 && <div className="text-[10px] text-slate-500 p-0.5">+{brandTags.length - 5}</div>}
                      </div>
                    </div>
                  )}

                  {(s.default_category || s.default_subcategory || s.default_brand) && (
                    <div className="rounded-lg border border-indigo-500/15 bg-indigo-500/5 px-2.5 py-2 text-[10px] text-indigo-300">
                      <div className="mb-1 uppercase tracking-wider text-slate-500">Значения по умолчанию</div>
                      <div className="truncate" title={`${s.default_brand_name || 'Бренд не выбран'} / ${s.default_category_name || 'Категория не выбрана'} / ${s.default_subcategory_name || 'Подкатегория не выбрана'}`}>
                        {s.default_brand_name || 'Бренд не выбран'} · {s.default_category_name || 'Категория не выбрана'}
                        {s.default_subcategory_name ? ` · ${s.default_subcategory_name}` : ''}
                      </div>
                    </div>
                  )}
                  {s.default_attributes?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.default_attributes.map((code) => (
                        <span key={code} className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                          {getSupplierAttributeLabel(code)}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <ExternalLink className="w-4 h-4 text-slate-500" />
                    <a
                      href={`https://www.szwego.com/static/index.html#shop_detail/${s.album_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-emerald-400 underline decoration-dotted"
                    >
                      Открыть альбом
                    </a>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedSupplierId(s.id);
                  setIsScrapingModalOpen(true);
                  setOverrideValue(''); // Reset to default
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-700 hover:bg-indigo-600 text-white rounded-lg transition-all mt-4"
              >
                <Play className="w-4 h-4" />
                Запустить выгрузку
              </button>
            </div>
          )
        })}
      </div>

      {/* Supplier Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <form onSubmit={handleSubmit} className="flex flex-col h-full bg-slate-800">
              <div className="p-6 pb-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-800">
                <div className="flex items-center gap-4">
                  {editingSupplier?.avatar_url && (
                    <img
                      src={getOptimizedAvatarUrl(editingSupplier.avatar_url)}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover border border-slate-700"
                    />
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-white">
                      {editingSupplier && editingSupplier.id !== 0 ? 'Настройки поставщика' : 'Новый поставщик'}
                    </h3>
                    {editingSupplier && <p className="text-xs text-slate-500 mt-0.5">{editingSupplier.name}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                >
                  <X />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
                {/* 1. Basic Info */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Основная информация</h4>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Название (для админки)</label>
                      <input name="name" defaultValue={editingSupplier?.name} required className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Album ID (Szwego)</label>
                      <input name="album_id" defaultValue={editingSupplier?.album_id} required className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white font-mono text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Avatar URL (опционально)</label>
                      <input name="avatar_url" defaultValue={editingSupplier?.avatar_url || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-xs outline-none focus:border-emerald-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Мин. фото</label>
                        <input type="number" name="min_photos" defaultValue={editingSupplier?.min_photos} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white outline-none focus:border-emerald-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Мин. символов опис.</label>
                        <input type="number" name="min_desc_len" defaultValue={editingSupplier?.min_desc_len} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white outline-none focus:border-emerald-500" />
                      </div>
                    </div>

                  </div>

                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Значения по умолчанию</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Пол (gender)</label>
                        <select
                          name="default_gender"
                          value={editingSupplier?.default_gender || ''}
                          onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, default_gender: event.target.value })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-indigo-500"
                        >
                          <option value="">Не задан</option>
                          <option value="female">Для женщин</option>
                          <option value="male">Для мужчин</option>
                          <option value="unisex">Унисекс</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Цена по умолч.</label>
                        <input type="number" name="default_price" defaultValue={editingSupplier?.default_price || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-indigo-500" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Категория</label>
                        <select
                          name="default_category"
                          value={editingSupplier?.default_category || ''}
                          onChange={(event) => {
                            if (!editingSupplier) return
                            const selected = catalogLookups.categories.find((item) => item.id === event.target.value)
                            setEditingSupplier({
                              ...editingSupplier,
                              default_category: event.target.value,
                              default_category_name: selected?.name || null,
                              default_subcategory: '',
                              default_subcategory_name: null,
                            })
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-indigo-500"
                        >
                          <option value="">Не выбрана</option>
                          {editingSupplier?.default_category && !catalogLookups.categories.some((item) => item.id === editingSupplier.default_category) && (
                            <option value={editingSupplier.default_category}>
                              {editingSupplier.default_category_name || 'Категория не сопоставлена'}
                            </option>
                          )}
                          {catalogLookups.categories.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Подкатегория</label>
                        <select
                          name="default_subcategory"
                          value={editingSupplier?.default_subcategory || ''}
                          onChange={(event) => {
                            if (!editingSupplier) return
                            const selected = catalogLookups.subcategories.find((item) => item.id === event.target.value)
                            setEditingSupplier({
                              ...editingSupplier,
                              default_subcategory: event.target.value,
                              default_subcategory_name: selected?.name || null,
                            })
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-indigo-500"
                        >
                          <option value="">Не выбрана</option>
                          {editingSupplier?.default_subcategory && !catalogLookups.subcategories.some((item) => item.id === editingSupplier.default_subcategory) && (
                            <option value={editingSupplier.default_subcategory}>
                              {editingSupplier.default_subcategory_name || 'Подкатегория не сопоставлена'}
                            </option>
                          )}
                          {catalogLookups.subcategories
                            .filter((item) => !editingSupplier?.default_category || item.parent_id === editingSupplier.default_category)
                            .map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Бренд</label>
                        <select
                          name="default_brand"
                          value={editingSupplier?.default_brand || ''}
                          onChange={(event) => {
                            if (!editingSupplier) return
                            const selected = catalogLookups.brands.find((item) => item.id === event.target.value)
                            setEditingSupplier({
                              ...editingSupplier,
                              default_brand: event.target.value,
                              default_brand_name: selected?.name || null,
                            })
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-indigo-500"
                        >
                          <option value="">Не выбран</option>
                          {editingSupplier?.default_brand && !catalogLookups.brands.some((item) => item.id === editingSupplier.default_brand) && (
                            <option value={editingSupplier.default_brand}>
                              {editingSupplier.default_brand_name || 'Бренд не сопоставлен'}
                            </option>
                          )}
                          {catalogLookups.brands.map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                      <div className="mb-1 text-xs font-semibold text-slate-200">Атрибуты поставщика</div>
                      <p className="mb-3 text-[11px] leading-4 text-slate-500">
                        ИИ будет целенаправленно искать выбранные характеристики. Пустые значения автоматически не создаются.
                      </p>
                      <div className="max-h-48 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                        {Object.entries(
                          SUPPLIER_ATTRIBUTE_DEFINITIONS.reduce<Record<string, typeof SUPPLIER_ATTRIBUTE_DEFINITIONS>>((groups, item) => {
                            groups[item.group] ||= []
                            groups[item.group].push(item)
                            return groups
                          }, {}),
                        ).map(([group, items]) => (
                          <div key={group}>
                            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{group}</div>
                            <div className="grid grid-cols-2 gap-1.5">
                              {items.map((attribute) => {
                                const checked = editingSupplier?.default_attributes?.includes(attribute.code) || false
                                return (
                                  <label
                                    key={attribute.code}
                                    title={attribute.description}
                                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                      checked
                                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                                        : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) => {
                                        if (!editingSupplier) return
                                        const selected = new Set(editingSupplier.default_attributes || [])
                                        if (event.target.checked) selected.add(attribute.code)
                                        else selected.delete(attribute.code)
                                        setEditingSupplier({ ...editingSupplier, default_attributes: [...selected] })
                                      }}
                                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                                    />
                                    {attribute.label}
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer group" title="Включает распознавание бренда и типа товара по фотографиям">
                        <input
                          type="checkbox"
                          name="ai_photo_enabled"
                          checked={editingSupplier?.ai_photo_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_photo_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          AI Photo <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>
                      
                      <label className="flex items-center gap-2 cursor-pointer group" title="Кэширует результаты работы ИИ для ускорения повторных выгрузок">
                        <input
                          type="checkbox"
                          name="ai_cache_enabled"
                          checked={editingSupplier?.ai_cache_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_cache_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          AI Cache <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group" title="Глубокий поиск по фото: если на первых кадрах нет логотипа, ИИ посмотрит следующие фото">
                        <input
                          type="checkbox"
                          name="ai_deep_search_enabled"
                          checked={editingSupplier?.ai_deep_search_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_deep_search_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          AI Deep Search <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group" title="Автоматически сжимает фото перед отправкой в ИИ для экономии токенов">
                        <input
                          type="checkbox"
                          name="ai_resize_enabled"
                          checked={editingSupplier?.ai_resize_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_resize_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          AI Resize <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>
                      
                      <label className="flex items-center gap-2 cursor-pointer group" title="Извлекать теги из Szwego и добавлять их в описание товара">
                        <input
                          type="checkbox"
                          name="parse_tags_enabled"
                          checked={editingSupplier?.parse_tags_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, parse_tags_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          Парсинг тегов <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* 1.5 AI Instructions & Post Process Script */}
                <div className="space-y-6 pt-4 border-t border-slate-700">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Инструкции для ИИ</h4>
                    <textarea 
                      name="ai_instructions" 
                      defaultValue={editingSupplier?.ai_instructions || ''} 
                      placeholder="Например: Ты — эксперт по обуви. Пиши описание короткими фразами. Не используй китайские иероглифы."
                      className="w-full min-h-[120px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 custom-scrollbar resize-y"
                    />
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Пост-обработка скриптом</h4>
                    <p className="text-xs text-slate-400 mb-2">Укажите название скрипта в папке scripts/parser/.</p>
                    <div className="flex items-center gap-2">
                      <input
                        name="post_process_script"
                        defaultValue={editingSupplier?.post_process_script || ''}
                        placeholder="Например: fix_descriptions.py"
                        className="min-w-0 flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500"
                      />
                      <label className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200" title="После успешного парсинга автоматически запустить этот скрипт для новой партии">
                        <input
                          type="checkbox"
                          name="post_process_enabled"
                          checked={editingSupplier?.post_process_enabled || false}
                          onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, post_process_enabled: event.target.checked })}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
                        />
                        Автоматически
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">Выкл. по умолчанию: можно продолжать запускать скрипт вручную.</p>
                  </div>

                  {/* Parallel Processing Block */}
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50 space-y-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Play size={18} className="rotate-[-90deg]" />
                        <h4 className="text-xs font-bold uppercase tracking-widest">Многопоточность (Ускорение)</h4>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          name="ai_parallel_enabled"
                          className="sr-only peer"
                          defaultChecked={editingSupplier?.ai_parallel_enabled}
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wider">Кол-во потоков (одновременных запросов)</p>
                      <input
                        type="number"
                        name="ai_parallel_count"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500"
                        defaultValue={editingSupplier?.ai_parallel_count || 5}
                        min="1"
                        max="50"
                      />
                      <p className="mt-1.5 text-[10px] text-slate-500 italic">
                        * Рекомендуется: 5-10. Больше может вызвать ошибки API.
                      </p>
                    </div>
                  </div>

                  {editingSupplier?.ai_photo_enabled && (
                    <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Определение по фото (ИИ)</h4>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-2">Укажите список моделей для распознавания объектов на фото (через запятую или в формате JSON)</p>
                        <textarea 
                          name="ai_photo_models" 
                          defaultValue={editingSupplier?.ai_photo_models || ''} 
                          placeholder="Например: gemini-2.0-flash, gpt-4o-mini"
                          className="w-full min-h-[80px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 custom-scrollbar resize-y"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-2">Инструкции (промпт) специально для определения по фото</p>
                        <textarea 
                          name="ai_photo_instructions" 
                          defaultValue={editingSupplier?.ai_photo_instructions || ''} 
                          placeholder="Например: Определи модель кроссовок на фото. Ответь только названием модели."
                          className="w-full min-h-[100px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 custom-scrollbar resize-y"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Brand Tags Selection */}
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Тэги групп и подгрупп</h4>
                      <p className="text-[10px] text-slate-500 mt-1">Если выбрано в списке при запуске, основные ID (ниже) будут проигнорированы.</p>
                    </div>
                    <button type="button" onClick={handleAddTagRow} className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-400 transition-colors py-1 px-2 hover:bg-emerald-500/10 rounded-lg">
                      <PlusCircle size={16} />
                      Добавить строку
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                    {modalTags.map((tag, idx) => (
                      <div key={idx} className="flex gap-2 items-center group/row">
                        <div className="w-32">
                          <select
                            value={tag.type}
                            onChange={(e) => handleTagChange(idx, 'type', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-indigo-500"
                          >
                            <option value="tag">Тэг (Tag)</option>
                            <option value="group">Группа (Group)</option>
                          </select>
                        </div>
                        <div className="flex-1">
                          <input
                            placeholder="Название (Balenciaga)"
                            value={tag.label}
                            onChange={(e) => handleTagChange(idx, 'label', e.target.value)}
                            className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-1.5 text-sm text-white focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <input
                            placeholder="ID"
                            value={tag.value}
                            onChange={(e) => handleTagChange(idx, 'value', e.target.value)}
                            className="w-full bg-slate-900/50 border border-slate-700 rounded px-3 py-1.5 text-sm text-white font-mono focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <button type="button" onClick={() => handleRemoveTagRow(idx)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100">
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    {modalTags.length === 0 && (
                      <div className="text-center py-6 border border-slate-700 border-dashed rounded-xl text-slate-500 text-xs text-balance">
                        Список тэгов пуст. Используется основной альбом.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-900/50 border-t border-slate-700 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2 text-slate-400 hover:text-white transition-colors">Отмена</button>
                <button type="submit" className="px-8 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/20 active:scale-95 transition-all">Сохранить всё</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scraping Modal */}
      {isScrapingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-white mb-2">Запуск выгрузки</h3>
              <p className="text-sm text-slate-400 mb-6">Выберите параметры выгрузки из альбома.</p>

              <div className="space-y-4">
                {/* Unified Selector */}
                {selectedSupplierId && suppliers.find(s => s.id === selectedSupplierId)?.brand_tags && (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Выберите Бренд / Категорию (ID)</label>
                    <select
                      value={overrideValue}
                      onChange={(e) => setOverrideValue(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:border-indigo-500"
                    >
                      <option value="">По умолчанию (весь альбом)</option>
                      {parseBrandTags(suppliers.find(s => s.id === selectedSupplierId)!.brand_tags).map(bt => (
                        <option key={`${bt.type}:${bt.value}`} value={`${bt.type}:${bt.value}`}>
                          {bt.type === 'tag' ? '🏷️ Тэг' : '📁 Груп.'} | {bt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Остановиться на дате</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 w-5 h-5 text-slate-500" />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() - 7);
                    setEndDate(d.toISOString().split('T')[0]);
                  }} className="text-xs px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">7 дней</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 1);
                    setEndDate(d.toISOString().split('T')[0]);
                  }} className="text-xs px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">1 месяц</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 2);
                    setEndDate(d.toISOString().split('T')[0]);
                  }} className="text-xs px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">2 месяца</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 3);
                    setEndDate(d.toISOString().split('T')[0]);
                  }} className="text-xs px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">3 месяца</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 4);
                    setEndDate(d.toISOString().split('T')[0]);
                  }} className="text-xs px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">4 месяца</button>
                  <button onClick={() => setEndDate('')} className="text-xs px-2 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors">Все время</button>
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-900/50 flex justify-end gap-3">
              <button
                onClick={() => setIsScrapingModalOpen(false)}
                className="px-4 py-2 text-slate-400 hover:text-white"
              >
                Отмена
              </button>
              <button
                onClick={handleStartScrape}
                className="px-8 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all"
              >
                Поехали!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

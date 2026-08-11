'use client'

import React, { useState } from 'react'
import { Plus, Trash2, Play, ExternalLink, Calendar, X, PlusCircle, RefreshCw, Image as ImageIcon, Star, HelpCircle } from 'lucide-react'
import { createSupplierAction, updateSupplierAction, deleteSupplierAction, startScrapingAction, fetchSupplierAvatarAction, toggleSupplierFavoriteAction } from '@/actions/suppliers'
import { useRouter, useSearchParams } from 'next/navigation'
import { imagePresets, resizeImageUrl } from '@/lib/image'
import { normalizeSupplierAttributeCodes } from '@/lib/supplier-attributes'
import {
  getCatalogAttributeDefinitionsForCategory,
} from '@/lib/catalog-attribute-schema'

type SupplierAiProcessingOptions = {
  colorFamilyByArticle: boolean
  articleExample: string
  splitAlbumColors: boolean
  reorderFirstPhoto: boolean
  skipModelOnlyAlbum: boolean
  suggestSubcategories: boolean
  suggestAttributes: boolean
}

const DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS: SupplierAiProcessingOptions = {
  colorFamilyByArticle: false,
  articleExample: '',
  splitAlbumColors: false,
  reorderFirstPhoto: false,
  skipModelOnlyAlbum: false,
  suggestSubcategories: false,
  suggestAttributes: false,
}

interface Supplier {
  id: number
  name: string
  album_id: string
  szwego_parse_mode: 'images' | 'all'
  group_id: string
  tag_id: string
  default_category: string
  default_subcategory: string
  default_brand: string
  allowed_category_ids: string[]
  allowed_subcategory_ids: string[]
  allowed_brand_ids: string[]
  allowed_category_names?: string[]
  allowed_subcategory_names?: string[]
  allowed_brand_names?: string[]
  default_category_name?: string | null
  default_subcategory_name?: string | null
  default_brand_name?: string | null
  default_attributes: string[]
  min_photos: number
  max_on_model_media: number
  min_desc_len: number
  brand_tags: string
  default_price: number | null
  default_gender: string | null
  ai_photo_enabled: boolean
  ai_cache_enabled: boolean
  ai_deep_search_enabled: boolean
  ai_resize_enabled: boolean
  ai_instructions?: string | null
  ai_processing_options?: SupplierAiProcessingOptions | null
  avatar_url?: string | null
  cookie?: string | null
  post_process_script?: string | null
  post_process_enabled: boolean
  ai_photo_models?: string | null
  ai_parallel_enabled: boolean
  ai_parallel_count: number
  parse_tags_enabled: boolean
  is_favorite?: boolean
}

function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ id: string; name: string }>
}) {
  return (
    <label className="space-y-1 text-xs text-slate-500">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500">
        <option value="">Все</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}

function CompactBadge({ tone, children }: { tone: 'indigo' | 'cyan' | 'slate' | 'emerald'; children: React.ReactNode }) {
  const styles = {
    indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200',
    cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
    slate: 'border-slate-600 bg-slate-900 text-slate-300',
    emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  }
  return <span className={`max-w-full truncate whitespace-nowrap rounded-md border px-2 py-1 text-[10px] ${styles[tone]}`}>{children}</span>
}

function MultiSelect({ label, values, options, emptyLabel, onChange }: {
  label: string
  values: string[]
  options: Array<{ id: string; name: string }>
  emptyLabel: string
  onChange: (values: string[]) => void
}) {
  const selectedNames = options.filter((option) => values.includes(option.id)).map((option) => option.name)
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white outline-none hover:border-indigo-500">
        <span className="mb-1 block text-[10px] text-slate-500">{label}</span>
        <span className="block truncate">{selectedNames.length ? selectedNames.join(', ') : emptyLabel}</span>
      </summary>
      <div className="absolute z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-lg border border-slate-600 bg-slate-950 p-2 shadow-2xl custom-scrollbar">
        {options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(event) => onChange(event.target.checked ? [...values, option.id] : values.filter((id) => id !== option.id))}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-500"
            />
            {option.name}
          </label>
        ))}
      </div>
    </details>
  )
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
  const searchParams = useSearchParams()
  const openedSupplierFromQuery = React.useRef<number | null>(null)
  const normalizedInitialData = React.useMemo(
    () => initialData.map((supplier) => ({
      ...supplier,
      default_attributes: normalizeSupplierAttributeCodes(supplier.default_attributes),
      ai_processing_options: {
        ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS,
        ...(supplier.ai_processing_options || {}),
      },
      allowed_category_ids: supplier.allowed_category_ids?.length ? supplier.allowed_category_ids : supplier.default_category ? [supplier.default_category] : [],
      allowed_subcategory_ids: supplier.allowed_subcategory_ids?.length ? supplier.allowed_subcategory_ids : supplier.default_subcategory ? [supplier.default_subcategory] : [],
      allowed_brand_ids: supplier.allowed_brand_ids?.length ? supplier.allowed_brand_ids : supplier.default_brand ? [supplier.default_brand] : [],
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
  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [genderFilter, setGenderFilter] = useState('')

  const selectedSupplierCategoryName = React.useMemo(() => {
    if (!editingSupplier) return ''
    const categoryId = editingSupplier.allowed_category_ids?.[0] || editingSupplier.default_category
    return catalogLookups.categories.find((item) => item.id === categoryId)?.name
      || editingSupplier.default_category_name
      || ''
  }, [catalogLookups.categories, editingSupplier])

  const selectedSupplierSubcategoryName = React.useMemo(() => {
    if (!editingSupplier) return ''
    const subcategoryId = editingSupplier.allowed_subcategory_ids?.[0] || editingSupplier.default_subcategory
    return catalogLookups.subcategories.find((item) => item.id === subcategoryId)?.name
      || editingSupplier.default_subcategory_name
      || ''
  }, [catalogLookups.subcategories, editingSupplier])

  const automaticSupplierAttributes = React.useMemo(
    () => getCatalogAttributeDefinitionsForCategory(selectedSupplierCategoryName, selectedSupplierSubcategoryName),
    [selectedSupplierCategoryName, selectedSupplierSubcategoryName],
  )

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
        szwego_parse_mode: 'images',
        group_id: '',
        tag_id: '',
        default_category: '',
        default_subcategory: '',
        default_brand: '',
        allowed_category_ids: [],
        allowed_subcategory_ids: [],
        allowed_brand_ids: [],
        default_attributes: [],
        min_photos: 0,
        max_on_model_media: 5,
        min_desc_len: 0,
        brand_tags: '',
        default_price: null,
        default_gender: '',
        ai_photo_enabled: false,
        ai_cache_enabled: false,
        ai_deep_search_enabled: false,
        ai_resize_enabled: true,
        ai_instructions: '',
        ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS },
        ai_photo_models: '',
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

  React.useEffect(() => {
    const supplierId = Number(searchParams.get('supplier'))
    if (!supplierId || openedSupplierFromQuery.current === supplierId) return
    const supplier = normalizedInitialData.find((item) => item.id === supplierId)
    if (!supplier) return
    openedSupplierFromQuery.current = supplierId
    handleOpenModal(supplier)
    // Открываем указанного поставщика один раз при переходе из выгрузки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, normalizedInitialData])

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
    formData.set('allowed_category_ids', JSON.stringify(editingSupplier?.allowed_category_ids || []))
    formData.set('allowed_subcategory_ids', JSON.stringify(editingSupplier?.allowed_subcategory_ids || []))
    formData.set('allowed_brand_ids', JSON.stringify(editingSupplier?.allowed_brand_ids || []))
    formData.set('ai_processing_options', JSON.stringify(editingSupplier?.ai_processing_options || DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS))

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

  const favoriteCount = suppliers.filter((supplier) => supplier.is_favorite).length
  const visibleSuppliers = suppliers.filter((supplier) => {
    if (showFavoritesOnly && !supplier.is_favorite) return false
    if (categoryFilter && !supplier.allowed_category_ids.includes(categoryFilter)) return false
    if (brandFilter && !supplier.allowed_brand_ids.includes(brandFilter)) return false
    if (genderFilter && supplier.default_gender !== genderFilter) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <h2 className="flex items-center gap-3 text-2xl font-bold text-white">
          Управление поставщиками
          <span className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-sm font-medium text-slate-400">
            {visibleSuppliers.length === suppliers.length ? suppliers.length : `${visibleSuppliers.length} из ${suppliers.length}`}
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors ${showFavoritesOnly ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
          >
            <Star className={`w-5 h-5 ${showFavoritesOnly ? 'fill-current' : ''}`} />
            Избранные <span className="rounded-full bg-black/20 px-1.5 text-xs">{favoriteCount}</span>
          </button>
          <button
            onClick={handleFetchAllAvatars}
            disabled={isFetchingAll}
            className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${isFetchingAll ? 'animate-spin' : ''}`} />
            Обновить аватарки
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="w-5 h-5" />
            Добавить поставщика
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 sm:grid-cols-3">
        <FilterSelect label="Категория" value={categoryFilter} onChange={setCategoryFilter} options={catalogLookups.categories} />
        <FilterSelect label="Бренд" value={brandFilter} onChange={setBrandFilter} options={catalogLookups.brands} />
        <FilterSelect label="Гендер" value={genderFilter} onChange={setGenderFilter} options={[
          { id: 'female', name: 'Для женщин' }, { id: 'male', name: 'Для мужчин' }, { id: 'unisex', name: 'Унисекс' },
        ]} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleSuppliers.map(s => {
          const isFav = Boolean(s.is_favorite)
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => handleOpenModal(s)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleOpenModal(s) }}
              className="group flex cursor-pointer flex-col rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-lg transition hover:border-indigo-500/60 hover:bg-slate-800/90"
            >
              <div className="flex items-start gap-3">
                <div className="relative group/avatar shrink-0">
                      {s.avatar_url ? (
                        <img
                          src={getOptimizedAvatarUrl(s.avatar_url)}
                          alt={s.name}
                          className="h-12 w-12 rounded-full border-2 border-slate-700 object-cover shadow-inner transition-all group-hover/avatar:border-indigo-500"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-600 bg-slate-700 shadow-inner">
                          <ImageIcon className="w-6 h-6 text-slate-500" />
                        </div>
                      )}
                      <button
                        onClick={(event) => { event.stopPropagation(); handleFetchAvatar(s.id) }}
                        className="absolute -bottom-1 -right-1 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg scale-0 group-hover/avatar:scale-100 transition-all duration-200 focus:outline-none"
                        title="Обновить аватарку"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold text-white transition-colors group-hover:text-indigo-400">{s.name}</h3>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={`Album ID: ${s.album_id}`}>{s.album_id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={(event) => { event.stopPropagation(); toggleFavorite(s.id) }}
                      className={`rounded-lg p-1.5 transition-all ${isFav ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10' : 'text-slate-400 hover:text-yellow-400 hover:bg-yellow-400/10'}`}
                      title="В избранное"
                    >
                      <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={(event) => { event.stopPropagation(); handleDelete(s.id) }}
                      className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-red-400/10 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                </div>
              </div>

              <div className="mt-3 flex min-h-12 flex-wrap content-start gap-1.5">
                {(s.allowed_brand_names?.length ? s.allowed_brand_names : ['AI определяет']).slice(0, 2).map((name) => <CompactBadge key={`brand-${name}`} tone="indigo">{name}</CompactBadge>)}
                {(s.allowed_category_names || []).slice(0, 2).map((name) => <CompactBadge key={`category-${name}`} tone="cyan">{name}</CompactBadge>)}
                {(s.allowed_subcategory_names || []).slice(0, 2).map((name) => <CompactBadge key={`subcategory-${name}`} tone="slate">{name}</CompactBadge>)}
                {s.ai_photo_enabled && <CompactBadge tone="emerald">Фото 3×3</CompactBadge>}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-700/70 pt-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <a
                      href={`https://www.szwego.com/static/index.html#shop_detail/${s.album_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="truncate underline decoration-dotted hover:text-emerald-400"
                    >
                      Открыть альбом
                    </a>
                </div>
                <button
                onClick={(event) => {
                  event.stopPropagation()
                  setSelectedSupplierId(s.id);
                  setIsScrapingModalOpen(true);
                  setOverrideValue(''); // Reset to default
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-white transition hover:bg-indigo-600"
              >
                <Play className="h-3.5 w-3.5" /> Запустить
              </button>
              </div>
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
                      <label className="block text-sm text-slate-400 mb-1">Источник Szwego</label>
                      <select
                        name="szwego_parse_mode"
                        value={editingSupplier?.szwego_parse_mode || 'images'}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, szwego_parse_mode: event.target.value as 'images' | 'all' })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm outline-none focus:border-emerald-500"
                      >
                        <option value="images">Альбомы / изображения (по умолчанию)</option>
                        <option value="all">全部 / единая лента</option>
                      </select>
                      <p className="mt-1 text-xs text-slate-500">Единая лента сохраняет текстовые публикации, одиночные фото и размерные сетки для постобработки.</p>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">Avatar URL (опционально)</label>
                      <input name="avatar_url" defaultValue={editingSupplier?.avatar_url || ''} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-xs outline-none focus:border-emerald-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Мин. фото</label>
                        <input
                          type="number"
                          name="min_photos"
                          defaultValue={editingSupplier?.min_photos}
                          disabled={editingSupplier?.szwego_parse_mode === 'all'}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Мин. символов опис.</label>
                        <input
                          type="number"
                          name="min_desc_len"
                          defaultValue={editingSupplier?.min_desc_len}
                          disabled={editingSupplier?.szwego_parse_mode === 'all'}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </div>
                    </div>
                    {editingSupplier?.szwego_parse_mode === 'all' && (
                      <>
                        <input type="hidden" name="min_photos" value={editingSupplier.min_photos ?? 0} />
                        <input type="hidden" name="min_desc_len" value={editingSupplier.min_desc_len ?? 0} />
                        <p className="text-xs text-slate-500">В единой ленте эти ограничения не применяются.</p>
                      </>
                    )}
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
                      <MultiSelect
                        label="Категории"
                        values={editingSupplier?.allowed_category_ids || []}
                        options={catalogLookups.categories}
                        emptyLabel="AI определяет"
                        onChange={(values) => editingSupplier && setEditingSupplier({
                          ...editingSupplier,
                          allowed_category_ids: values,
                          allowed_subcategory_ids: editingSupplier.allowed_subcategory_ids.filter((id) => {
                            const item = catalogLookups.subcategories.find((subcategory) => subcategory.id === id)
                            return !values.length || !item?.parent_id || values.includes(item.parent_id)
                          }),
                        })}
                      />
                      <MultiSelect
                        label="Подкатегории"
                        values={editingSupplier?.allowed_subcategory_ids || []}
                        options={catalogLookups.subcategories.filter((item) => !editingSupplier?.allowed_category_ids.length || !item.parent_id || editingSupplier.allowed_category_ids.includes(item.parent_id))}
                        emptyLabel="AI определяет"
                        onChange={(values) => editingSupplier && setEditingSupplier({ ...editingSupplier, allowed_subcategory_ids: values })}
                      />
                      <MultiSelect
                        label="Бренды"
                        values={editingSupplier?.allowed_brand_ids || []}
                        options={catalogLookups.brands}
                        emptyLabel="AI определяет"
                        onChange={(values) => editingSupplier && setEditingSupplier({ ...editingSupplier, allowed_brand_ids: values })}
                      />
                    </div>
                    <p className="text-[10px] leading-4 text-slate-500">Пустой список не ограничивает AI. Если выбраны варианты, AI принимает решение только внутри них.</p>
                    <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-slate-200">Атрибуты поставщика</div>
                          <p className="mt-1 text-[11px] leading-4 text-slate-500">
                            По умолчанию берутся из категории. ИИ пропускает характеристики, которых нет в источнике.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => editingSupplier && setEditingSupplier({ ...editingSupplier, default_attributes: [] })}
                          className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold ${
                            editingSupplier?.default_attributes?.length
                              ? 'border-slate-700 text-slate-400 hover:text-white'
                              : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                          }`}
                        >
                          Автоматически
                        </button>
                      </div>

                      {!selectedSupplierCategoryName ? (
                        <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/20 p-2 text-[11px] text-amber-200/80">
                          Сначала выберите категорию поставщика.
                        </div>
                      ) : (
                        <>
                          <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {selectedSupplierCategoryName}{selectedSupplierSubcategoryName ? ` · ${selectedSupplierSubcategoryName}` : ''}
                          </div>
                          <div className="mt-2 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto pr-1 custom-scrollbar">
                            {automaticSupplierAttributes.map((attribute) => {
                              const automatic = !editingSupplier?.default_attributes?.length
                              const checked = automatic || editingSupplier?.default_attributes?.includes(attribute.code) || false
                              return (
                                <label
                                  key={attribute.code}
                                  title={attribute.parser_rules.join('; ')}
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
                                      const selected = new Set(
                                        automatic
                                          ? automaticSupplierAttributes.map((item) => item.code)
                                          : editingSupplier.default_attributes || [],
                                      )
                                      if (event.target.checked) selected.add(attribute.code)
                                      else selected.delete(attribute.code)
                                      setEditingSupplier({ ...editingSupplier, default_attributes: [...selected] })
                                    }}
                                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                                  />
                                  <span>
                                    {attribute.label}
                                    {attribute.use_as_variant_dimension && <small className="ml-1 text-indigo-300">вариант</small>}
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer group" title="Передавать AI все фото товара листами 3×3. Если выключено, обработка идёт только по тексту.">
                        <input
                          type="checkbox"
                          name="ai_photo_enabled"
                          checked={editingSupplier?.ai_photo_enabled || false}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_photo_enabled: e.target.checked, ai_deep_search_enabled: e.target.checked ? editingSupplier.ai_deep_search_enabled : false })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          Фото 3×3 <HelpCircle size={12} className="text-slate-500" />
                        </span>
                      </label>
                      
                      <label className={`flex items-center gap-2 group ${editingSupplier?.ai_photo_enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`} title="При низкой уверенности AI запросит до трёх выбранных фотографий в оригинальном размере, чтобы прочитать бренд или модель.">
                        <input
                          type="checkbox"
                          name="ai_deep_search_enabled"
                          checked={editingSupplier?.ai_deep_search_enabled || false}
                          disabled={!editingSupplier?.ai_photo_enabled}
                          onChange={(e) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_deep_search_enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
                        />
                        <span className="text-xs text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                          Уточнение по оригиналу <HelpCircle size={12} className="text-slate-500" />
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
                      placeholder="Только особенности источника: как объединять альбомы, где бывает реклама, какие обозначения использует поставщик, где искать бренд или модель. Общие требования к названию, описанию и SEO уже заданы системным промптом."
                      className="w-full min-h-[120px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 custom-scrollbar resize-y"
                    />
                    <p className="mt-2 text-[11px] text-slate-500">Не дублируйте здесь общий стиль и JSON-схему. Эти инструкции добавляются к системному промпту только для данного поставщика.</p>
                  </div>

                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-4">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-violet-200">Постоянные настройки AI-обработки</h4>
                      <p className="mt-1 text-[11px] text-slate-500">Применяются автоматически к тесту 10 товаров и к полной обработке всех выгрузок этого поставщика.</p>
                    </div>
                    <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3 space-y-3">
                      <div>
                        <h5 className="text-xs font-semibold text-slate-200">Предлагать</h5>
                        <p className="mt-1 text-[11px] text-slate-500">Выключено по умолчанию: AI не создаёт новые предложения, но продолжает выбирать существующие значения.</p>
                      </div>
                      <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={editingSupplier?.ai_processing_options?.suggestSubcategories || false}
                          onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, suggestSubcategories: event.target.checked } })}
                          className="mt-0.5 h-4 w-4 accent-violet-500"
                        />
                        <span><b className="block text-slate-100">Подкатегории</b><small className="text-xs text-slate-500">Разрешить предложения новых подкатегорий для ручного решения.</small></span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={editingSupplier?.ai_processing_options?.suggestAttributes || false}
                          onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, suggestAttributes: event.target.checked } })}
                          className="mt-0.5 h-4 w-4 accent-violet-500"
                        />
                        <span><b className="block text-slate-100">Атрибуты</b><small className="text-xs text-slate-500">Разрешить предложения новых кодов и значений атрибутов.</small></span>
                      </label>
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={editingSupplier?.ai_processing_options?.colorFamilyByArticle || false}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, colorFamilyByArticle: event.target.checked } })}
                        className="mt-0.5 h-4 w-4 accent-violet-500"
                      />
                      <span><b className="block text-slate-100">Группировать цветовое семейство по артикулу</b><small className="text-xs text-slate-500">ИИ отделит цвет от общей основы артикула и запишет семью.</small></span>
                    </label>
                    <div className="ml-7">
                      <label className="text-[11px] text-slate-500">Пример артикула с цветом</label>
                      <input
                        value={editingSupplier?.ai_processing_options?.articleExample || ''}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, articleExample: event.target.value } })}
                        placeholder="Например: SP001 blue"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                      />
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={editingSupplier?.ai_processing_options?.splitAlbumColors || false}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, splitAlbumColors: event.target.checked } })}
                        className="mt-0.5 h-4 w-4 accent-violet-500"
                      />
                      <span><b className="block text-slate-100">Разделять разные цвета внутри одного альбома</b><small className="text-xs text-slate-500">Один AI-запрос создаёт отдельные карточки и связывает их в одну семью.</small></span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={editingSupplier?.ai_processing_options?.reorderFirstPhoto || false}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, reorderFirstPhoto: event.target.checked } })}
                        className="mt-0.5 h-4 w-4 accent-violet-500"
                      />
                      <span><b className="block text-slate-100">Поставить лучший кадр первым</b><small className="text-xs text-slate-500">Меняется только первое фото, порядок остальных сохраняется.</small></span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={editingSupplier?.ai_processing_options?.skipModelOnlyAlbum || false}
                        onChange={(event) => editingSupplier && setEditingSupplier({ ...editingSupplier, ai_processing_options: { ...DEFAULT_SUPPLIER_AI_PROCESSING_OPTIONS, ...editingSupplier.ai_processing_options, skipModelOnlyAlbum: event.target.checked } })}
                        className="mt-0.5 h-4 w-4 accent-violet-500"
                      />
                      <span><b className="block text-slate-100">Исключать альбом только с фото моделей</b><small className="text-xs text-slate-500">Товар убирается из текущей версии, исходник остаётся в снимке для отката.</small></span>
                    </label>
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

                  <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Play size={18} className="rotate-[-90deg]" />
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-widest">Параллельная AI-обработка</h4>
                          <p className="mt-1 text-[10px] normal-case tracking-normal text-slate-500">Количество потоков задаётся глобально в «Настройках ИИ».</p>
                        </div>
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
                  </div>

                  {editingSupplier?.ai_photo_enabled && (
                    <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Фото 3×3</h4>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-2">Дополнительные ориентиры по моделям товаров, а не список AI-моделей</p>
                        <textarea 
                          name="ai_photo_models" 
                          defaultValue={editingSupplier?.ai_photo_models || ''} 
                          placeholder="Например: Classic Flap, Chanel 22, Boy Chanel"
                          className="w-full min-h-[80px] bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 custom-scrollbar resize-y"
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

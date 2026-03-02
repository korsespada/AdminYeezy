'use client'

import { useState, useEffect, useTransition } from 'react'
import Image from 'next/image'
import { type Product, type Brand, type Category, type Subcategory } from '@/lib/types'
import { createProductAction, updateProductAction } from '@/actions/products'
import { X, Upload, Trash2, GripVertical, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'
import BrandSelect from './BrandSelect'

const getOptimizedPhotoUrl = (url: string) => {
  if (typeof url === 'string' && url.includes('szwego.com')) {
    const IMG_SUFFIX = '?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg';
    if (!url.includes('?imageMogr2')) {
      return url + IMG_SUFFIX;
    }
  }
  return url;
}

interface ProductFormProps {
  product?: Product | null
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
  isOpen: boolean
  onClose: () => void
}

export default function ProductForm({ product, brands, categories, subcategories, isOpen, onClose }: ProductFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [productId, setProductId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [gender, setGender] = useState('')
  const [photoUrlsToAdd, setPhotoUrlsToAdd] = useState('')
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  const handleDownload = async (url: string, index: number) => {
    try {
      const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`)

      if (!response.ok) {
        throw new Error('Failed to fetch from proxy')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      const extension = (url.split('.').pop() || '').split('?')[0] || 'jpg'
      const cleanExtension = extension.replace(/[^a-zA-Z0-9]/g, '') || 'jpg'
      const baseName = productId || name.substring(0, 10).trim() || 'product'
      a.download = `${baseName}_photo_${index + 1}.${cleanExtension}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      console.error('Download error:', e)
      window.open(url, '_blank')
    }
  }

  const handleDownloadAll = async () => {
    setIsDownloading(true)
    try {
      for (let i = 0; i < existingPhotos.length; i++) {
        await handleDownload(existingPhotos[i], i)
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    } finally {
      setIsDownloading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setProductId(product.productId || '')
        setName(product.name)
        setDescription(product.description || '')
        setPrice(Number(product.price).toString())
        setStatus(product.status)

        // Handle brand as array or single value
        const b = product.brand || product.expand?.brand
        if (Array.isArray(b)) {
          if (b.length > 0 && typeof b[0] === 'object') {
            setBrandIds((b as Brand[]).map(x => x.id))
          } else {
            setBrandIds(b as string[])
          }
        } else if (typeof b === 'string' && b) {
          setBrandIds([b])
        } else if (b && typeof b === 'object' && 'id' in b) {
          setBrandIds([(b as Brand).id])
        } else {
          setBrandIds([])
        }

        setCategory(product.category || product.expand?.category?.id || '')
        setSubcategory(product.subcategory || product.expand?.subcategory?.id || '')
        setGender(product.gender || '')
        setPhotoUrlsToAdd('')

        // Set existing photos (they are external URLs, not PocketBase files)
        if (product.photos && product.photos.length > 0) {
          let photoUrls: any = product.photos

          // If photos is stored as JSON string, parse it
          if (typeof photoUrls === 'string' && photoUrls.startsWith('[')) {
            try {
              photoUrls = JSON.parse(photoUrls)
            } catch (e) {
              console.error('Failed to parse photos:', e)
              photoUrls = []
            }
          }

          setExistingPhotos(Array.isArray(photoUrls) ? photoUrls : [])
        } else {
          setExistingPhotos([])
        }
      } else {
        // Reset for new product
        setProductId('')
        setName('')
        setDescription('')
        setPrice('')
        setStatus('active')
        setBrandIds([])
        setCategory(categories[0]?.id || '')
        setSubcategory('')
        setGender('')
        setPhotoUrlsToAdd('')
        setExistingPhotos([])
      }
      setError('')
    }
  }, [isOpen, product, brands, categories])

  const handleAddUrls = () => {
    const urls = photoUrlsToAdd
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0)

    if (urls.length > 0) {
      setExistingPhotos(prev => [...prev, ...urls])
      setPhotoUrlsToAdd('')
      setIsPhotoModalOpen(false)
    }
  }

  const removeExistingPhoto = (index: number) => {
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers for existing photos
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newPhotos = [...existingPhotos]
    const draggedPhoto = newPhotos[draggedIndex]
    newPhotos.splice(draggedIndex, 1)
    newPhotos.splice(index, 0, draggedPhoto)

    setExistingPhotos(newPhotos)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!productId.trim()) {
      setError('Product ID is required')
      return
    }
    if (!name.trim()) {
      setError('Product name is required')
      return
    }
    if (brandIds.length === 0) {
      setError('At least one brand is required')
      return
    }
    if (!category) {
      setError('Category is required')
      return
    }

    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Price must be a positive number')
      return
    }

    const formData = new FormData()
    formData.append('productId', productId.trim())
    formData.append('name', name.trim())
    formData.append('description', description.trim())
    formData.append('price', priceNum.toString())
    formData.append('status', status)

    // Append each brand ID
    brandIds.forEach(id => {
      formData.append('brand', id)
    })

    formData.append('category', category)
    formData.append('subcategory', subcategory)
    formData.append('gender', gender)

    // Add existing photos in new order (as JSON) - this now includes newly added URLs
    if (existingPhotos.length > 0) {
      formData.append('existingPhotos', JSON.stringify(existingPhotos))
    }

    startTransition(async () => {
      try {
        let result
        if (product) {
          result = await updateProductAction(product.id, formData)
        } else {
          result = await createProductAction(formData)
        }

        if (result.success) {
          router.refresh()
          onClose()
        } else {
          setError(result.error || 'Failed to save product')
        }
      } catch (err) {
        setError('An unexpected error occurred')
      }
    })
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white dark:bg-gray-800 shadow-2xl transform transition-transform duration-300 ease-in-out overflow-y-auto">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {product ? 'Изменить товар' : 'Новый товар'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 p-6 space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Photos Upload */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Фотографии товара
                </label>
                <div className="flex gap-2 ml-auto">
                  {existingPhotos.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadAll}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors border border-green-200 dark:border-green-800/50"
                      disabled={isPending || isDownloading}
                    >
                      <Download size={16} />
                      {isDownloading ? 'Скачивание...' : 'Скачать все фото'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-2 h-fit text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors border border-blue-200 dark:border-blue-800/50"
                    disabled={isPending}
                  >
                    <Upload size={16} />
                    Добавить фото по ссылкам
                  </button>
                </div>
              </div>

              {/* Existing Photos with Drag and Drop */}
              {existingPhotos.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Текущие фото (перетащите для изменения порядка):</p>
                  <div className="grid grid-cols-3 gap-2">
                    {existingPhotos.map((url, index) => (
                      <div
                        key={index}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`relative aspect-square group cursor-move ${draggedIndex === index ? 'opacity-50' : ''
                          }`}
                      >
                        <Image
                          src={getOptimizedPhotoUrl(url)}
                          alt={`Photo ${index + 1}`}
                          fill
                          sizes="(max-width: 768px) 33vw, 200px"
                          loading={index < 3 ? 'eager' : 'lazy'}
                          className="object-cover rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm"
                          unoptimized
                        />
                        <div className="absolute top-1 left-1 p-1 bg-gray-800/70 text-white rounded">
                          <GripVertical size={14} />
                        </div>
                        <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => removeExistingPhoto(index)}
                            className="p-1 bg-red-500 text-white rounded-full shadow hover:bg-red-600 transition-colors"
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              handleDownload(url, index);
                            }}
                            className="p-1 bg-blue-500 text-white rounded-full shadow hover:bg-blue-600 transition-colors"
                            title="Скачать исходное фото"
                          >
                            <Download size={14} />
                          </button>
                        </div>
                        <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-gray-800/70 text-white text-xs rounded">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Photos (Removed, as we now use URL input directly to existing photos list) */}
            </div>

            {/* Product ID */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Product ID *
              </label>
              <input
                type="text"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="например SKU-12345"
                required
                disabled={isPending}
              />
            </div>

            {/* Name */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Название товара *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="например Chanel Комплект"
                required
                disabled={isPending}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Описание
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="Описание товара..."
                disabled={isPending}
              />
            </div>

            {/* Brand */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Бренды *
              </label>
              <BrandSelect
                brands={brands}
                selectedBrandIds={brandIds}
                onChange={setBrandIds}
                disabled={isPending}
              />
              {brandIds.length === 0 && (
                <p className="text-xs text-red-500">Пожалуйста, выберите хотя бы один бренд.</p>
              )}
            </div>

            {/* Category & Subcategory Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Category */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Категория *
                </label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setSubcategory('')
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  required
                  disabled={isPending}
                >
                  <option value="">Выберите категорию...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subcategory */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Подкатегория
                </label>
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  disabled={isPending || !category}
                >
                  <option value="">Выберите подкатегорию...</option>
                  {subcategories
                    .filter((s) => s.category === category)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Gender, Price & Status Row */}
            <div className="grid grid-cols-3 gap-4">
              {/* Gender */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Для кого
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  disabled={isPending}
                >
                  <option value="">Не указано</option>
                  <option value="Для мужчин">Для мужчин</option>
                  <option value="Для женщин">Для женщин</option>
                </select>
              </div>

              {/* Price */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Цена (₽) *
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="0.00"
                  required
                  disabled={isPending}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Статус
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  disabled={isPending}
                >
                  <option value="active">Активный</option>
                  <option value="inactive">Неактивный</option>
                </select>
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 sticky bottom-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? 'Сохранение...' : product ? 'Обновить' : 'Создать'}
            </button>
          </div>
        </div>
      </div>

      {/* Photo URL Modal */}
      {isPhotoModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={() => setIsPhotoModalOpen(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Добавить фото по ссылкам
              </h3>
              <button
                onClick={() => setIsPhotoModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Вставьте ссылки на фотографии товара. Каждая ссылка должна быть с новой строки.
              </p>
              <textarea
                value={photoUrlsToAdd}
                onChange={(e) => setPhotoUrlsToAdd(e.target.value)}
                placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-900 dark:text-white font-mono text-sm resize-y min-h-[150px]"
                rows={6}
                disabled={isPending}
                autoFocus
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsPhotoModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleAddUrls}
                disabled={!photoUrlsToAdd.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Upload size={16} />
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

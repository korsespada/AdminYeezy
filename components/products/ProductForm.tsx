'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import Image from 'next/image'
import { type Product, type ProductMedia, type Brand, type Category, type Subcategory } from '@/lib/types'
import { createProductAction, updateProductAction } from '@/actions/products'
import { Upload, Trash2, GripVertical, Download } from 'lucide-react'
import { useRouter } from 'next/navigation'
import BrandSelect from '@/components/inventory/BrandSelect'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { normalizeDescription } from '@/components/products/ProductDescription'
import { imagePresets, resizeImageUrl } from '@/lib/image'
import { isPriceOnRequest } from '@/lib/product-pricing'
import CatalogAttributeFields from '@/components/catalog-attributes/CatalogAttributeFields'
import { normalizeCatalogAttributes } from '@/lib/catalog-attribute-values'

interface ProductFormProps {
  product?: Product | null
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
  isOpen: boolean
  onClose: () => void
  onSave?: (updatedProduct: Product) => void
}

export default function ProductForm({ product, brands, categories, subcategories, isOpen, onClose, onSave }: ProductFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [productId, setProductId] = useState('')
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<Product['status']>('active')
  const [fulfillmentMode, setFulfillmentMode] = useState<Product['fulfillment_mode']>('requires_confirmation')
  const [availabilityConfidence, setAvailabilityConfidence] = useState<Product['availability_confidence']>('unknown')
  const [indexingStatus, setIndexingStatus] = useState<Product['indexing_status']>('indexable')
  const [productionMinDays, setProductionMinDays] = useState('')
  const [productionMaxDays, setProductionMaxDays] = useState('')
  const [officeDeliveryMinDays, setOfficeDeliveryMinDays] = useState('')
  const [officeDeliveryMaxDays, setOfficeDeliveryMaxDays] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [h1, setH1] = useState('')
  const [canonicalUrl, setCanonicalUrl] = useState('')
  const [catalogAttributes, setCatalogAttributes] = useState<Record<string, any>>({})
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [gender, setGender] = useState('')
  const [photoUrlsToAdd, setPhotoUrlsToAdd] = useState('')
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [existingMedia, setExistingMedia] = useState<ProductMedia[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  const selectedCategoryName = useMemo(
    () => categories.find((item) => item.id === category)?.name || '',
    [categories, category],
  )
  const selectedSubcategoryName = useMemo(
    () => subcategories.find((item) => item.id === subcategory)?.name || '',
    [subcategories, subcategory],
  )

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
        setSku(product.sku || product.productId || '')
        setName(product.name)
        setDescription(normalizeDescription(product.description))
        setPrice(Number(product.price).toString())
        setStatus(product.status || 'active')
        setFulfillmentMode(product.fulfillment_mode || 'requires_confirmation')
        setAvailabilityConfidence(product.availability_confidence || 'unknown')
        setIndexingStatus(product.indexing_status || 'indexable')
        setProductionMinDays(product.production_min_days == null ? '' : String(product.production_min_days))
        setProductionMaxDays(product.production_max_days == null ? '' : String(product.production_max_days))
        setOfficeDeliveryMinDays(product.office_delivery_min_days == null ? '' : String(product.office_delivery_min_days))
        setOfficeDeliveryMaxDays(product.office_delivery_max_days == null ? '' : String(product.office_delivery_max_days))
        // Keep existing SEO values visible, and use the product content as a
        // useful fallback when older records do not have dedicated SEO fields.
        const productDescription = normalizeDescription(product.description)
        setSeoTitle(product.seo_title || product.name || '')
        setSeoDescription(product.seo_description || productDescription)
        setH1(product.h1 || product.name || '')
        setCanonicalUrl(product.canonical_url || '')
        setCatalogAttributes(product.catalog_attributes || product.attributes || {})
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
        const media = product.media && product.media.length > 0
          ? product.media
          : (product.photos || []).map((url, index) => ({
            original_url: String(url),
            thumb_url: String(url),
            preview_url: String(url),
            og_image_url: String(url),
            alt_text: product.name || '',
            sort_order: index,
            processing_status: 'processed' as const,
          }))
        setExistingMedia(media)

        if (media.length > 0 || (product.photos && product.photos.length > 0)) {
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

          setExistingPhotos(media.length > 0
            ? media.map((item) => item.preview_url || item.original_url).filter(Boolean)
            : (Array.isArray(photoUrls) ? photoUrls : []))
        } else {
          setExistingPhotos([])
          setExistingMedia([])
        }
      } else {
        // Reset for new product
        setProductId('')
        setSku('')
        setName('')
        setDescription('')
        setPrice('')
        setStatus('active')
        setFulfillmentMode('requires_confirmation')
        setAvailabilityConfidence('unknown')
        setIndexingStatus('indexable')
        setProductionMinDays('')
        setProductionMaxDays('')
        setOfficeDeliveryMinDays('')
        setOfficeDeliveryMaxDays('')
        setSeoTitle('')
        setSeoDescription('')
        setH1('')
        setCanonicalUrl('')
        setCatalogAttributes({})
        setBrandIds([])
        setCategory(categories[0]?.id || '')
        setSubcategory('')
        setGender('')
        setPhotoUrlsToAdd('')
        setExistingPhotos([])
        setExistingMedia([])
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

  const buildMediaPayload = () => {
    return existingPhotos.map((url, index) => {
      const media = existingMedia.find((item) =>
        item.original_url === url ||
        item.preview_url === url ||
        item.thumb_url === url ||
        item.og_image_url === url
      )
      return {
        original_url: media?.original_url || url,
        thumb_url: media?.thumb_url || media?.preview_url || media?.original_url || url,
        preview_url: media?.preview_url || media?.original_url || url,
        og_image_url: media?.og_image_url || media?.preview_url || media?.original_url || url,
        alt_text: media?.alt_text || name.trim(),
        sort_order: index,
        processing_status: media?.processing_status || 'processed',
      }
    })
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
    formData.append('sku', sku.trim())
    formData.append('name', name.trim())
    formData.append('description', description.trim())
    formData.append('price', priceNum.toString())
    formData.append('status', status === 'inactive' ? 'hidden' : status)
    formData.append('currency', 'RUB')
    formData.append('fulfillment_mode', fulfillmentMode || 'requires_confirmation')
    formData.append('availability_confidence', availabilityConfidence || 'unknown')
    formData.append('indexing_status', indexingStatus || 'indexable')
    formData.append('production_min_days', productionMinDays)
    formData.append('production_max_days', productionMaxDays)
    formData.append('office_delivery_min_days', officeDeliveryMinDays)
    formData.append('office_delivery_max_days', officeDeliveryMaxDays)
    formData.append('seo_title', seoTitle.trim())
    formData.append('seo_description', seoDescription.trim())
    formData.append('h1', h1.trim())
    formData.append('canonical_url', canonicalUrl.trim())
    const normalizedCatalogAttributes = normalizeCatalogAttributes(catalogAttributes, {
      categoryName: selectedCategoryName,
      subcategoryName: selectedSubcategoryName,
      preserveUnknown: true,
    })
    formData.append('catalog_attributes', JSON.stringify(normalizedCatalogAttributes))
    const priceOnRequest = isPriceOnRequest(priceNum)
    formData.append('price_on_request', priceOnRequest ? 'true' : 'false')
    formData.append('productMetadata', JSON.stringify(product?.metadata || {}))

    // Append each brand ID
    brandIds.forEach(id => {
      formData.append('brand', id)
    })

    formData.append('category', category)
    formData.append('subcategory', subcategory)
    formData.append('gender', gender)

    // Always send media, including an empty array when all photos were removed.
    const mediaPayload = buildMediaPayload()
    formData.append('media', JSON.stringify(mediaPayload))

    if (product) {
      if (onSave) {
        // Optimistically update the list and release the editor immediately.
        onSave({
          ...product,
          productId: productId.trim(),
          external_id: productId.trim(),
          sku: sku.trim(),
          name: name.trim(),
          description: description.trim(),
          price: parseFloat(price),
          status,
          fulfillment_mode: fulfillmentMode,
          availability_confidence: availabilityConfidence,
          indexing_status: indexingStatus,
          production_min_days: productionMinDays ? Number(productionMinDays) : null,
          production_max_days: productionMaxDays ? Number(productionMaxDays) : null,
          office_delivery_min_days: officeDeliveryMinDays ? Number(officeDeliveryMinDays) : null,
          office_delivery_max_days: officeDeliveryMaxDays ? Number(officeDeliveryMaxDays) : null,
          seo_title: seoTitle.trim(),
          seo_description: seoDescription.trim(),
          h1: h1.trim(),
          canonical_url: canonicalUrl.trim(),
          catalog_attributes: normalizedCatalogAttributes,
          attributes: normalizedCatalogAttributes,
          price_on_request: priceOnRequest,
          metadata: {
            ...(product.metadata || {}),
            gender,
            price_on_request: priceOnRequest,
          },
          gender,
          category,
          subcategory,
          photos: existingPhotos,
          media: mediaPayload,
        })
      }
      onClose()

      updateProductAction(product.id, formData)
        .then((result) => {
          if (!result.success) {
            window.alert(result.error || 'Не удалось сохранить товар')
          }
        })
        .catch(() => {
          window.alert('Не удалось сохранить товар')
        })
      return
    }

    startTransition(async () => {
      try {
        const result = await createProductAction(formData)

        if (result.success) {
          onClose()
          // Только при создании нового товара нужен рефреш (чтобы новый появился в списке)
          router.refresh()
        } else {
          setError(result.error || 'Failed to save product')
        }
      } catch {
        setError('An unexpected error occurred')
      }
    })
  }

  if (!isOpen) return null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) onClose()
    }}>
      <SheetContent side="right" className="flex w-full max-w-2xl flex-col overflow-y-auto bg-gray-800 p-0 sm:max-w-2xl">
          <SheetHeader className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900 px-5 py-3">
            <SheetTitle>
              {product ? 'Изменить товар' : 'Новый товар'}
            </SheetTitle>
          </SheetHeader>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 p-5 space-y-4">
            {error && (
              <Alert variant="destructive" className="border-red-800 bg-red-900/20 text-red-400">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Photos Upload */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Фотографии товара
                </label>
                <div className="flex gap-2 ml-auto">
                  {existingPhotos.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDownloadAll}
                      className="border-green-800/50 bg-green-900/20 text-green-400 hover:bg-green-900/30 hover:text-green-300"
                      disabled={isPending || isDownloading}
                    >
                      <Download size={16} />
                      {isDownloading ? 'Скачивание...' : 'Скачать все фото'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="h-fit border-blue-800/50 bg-blue-900/20 text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
                    disabled={isPending}
                  >
                    <Upload size={16} />
                    Добавить фото по ссылкам
                  </Button>
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
                          src={resizeImageUrl(url, imagePresets.productForm)}
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
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            onClick={() => removeExistingPhoto(index)}
                            className="h-7 w-7 rounded-full shadow"
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            onClick={(e) => {
                              e.preventDefault();
                              handleDownload(url, index);
                            }}
                            className="h-7 w-7 rounded-full shadow"
                            title="Скачать исходное фото"
                          >
                            <Download size={14} />
                          </Button>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  SKU
                </label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="SKU товара"
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Статус
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Product['status'])}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                  disabled={isPending}
                >
                  <option value="draft">Черновик</option>
                  <option value="active">Активен</option>
                  <option value="hidden">Скрыт</option>
                  <option value="archived">Архив</option>
                </select>
              </div>
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
                rows={4}
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

            {/* Gender & Price Row */}
            <div className="grid grid-cols-2 gap-4">
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
                  <option value="Унисекс">Унисекс</option>
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
            </div>

            <div className="border-t border-gray-700 pt-4">
              <CatalogAttributeFields
                value={catalogAttributes}
                onChange={setCatalogAttributes}
                categoryName={selectedCategoryName}
                subcategoryName={selectedSubcategoryName}
              />
            </div>

            <div className="space-y-4 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    SEO title
                  </label>
                  <input type="text" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} disabled={isPending} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white" />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    H1
                  </label>
                  <input type="text" value={h1} onChange={(e) => setH1(e.target.value)} disabled={isPending} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  SEO description
                </label>
                <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} disabled={isPending} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white" />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Canonical URL
                </label>
                <input type="url" value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} disabled={isPending} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white" />
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="sticky bottom-0 flex justify-end space-x-3 border-t border-gray-700 bg-gray-900 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? 'Сохранение...' : product ? 'Обновить' : 'Создать'}
            </Button>
          </div>
      </SheetContent>

      {/* Photo URL Modal */}
      <Dialog open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen}>
          <DialogContent className="bg-gray-800 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Добавить фото по ссылкам</DialogTitle>
              <DialogDescription>
                Вставьте ссылки на фотографии товара. Каждая ссылка должна быть с новой строки.
              </DialogDescription>
            </DialogHeader>
              <Textarea
                value={photoUrlsToAdd}
                onChange={(e) => setPhotoUrlsToAdd(e.target.value)}
                placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
                className="min-h-[150px] resize-y bg-gray-900 font-mono text-sm"
                rows={6}
                disabled={isPending}
                autoFocus
              />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPhotoModalOpen(false)}
                className="border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={handleAddUrls}
                disabled={!photoUrlsToAdd.trim()}
              >
                <Upload size={16} />
                Добавить
              </Button>
            </DialogFooter>
          </DialogContent>
      </Dialog>
    </Sheet>
  )
}

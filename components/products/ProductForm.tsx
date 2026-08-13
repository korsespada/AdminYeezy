'use client'

import { useState, useEffect, useMemo, useRef, useTransition } from 'react'
import Image from 'next/image'
import { type Product, type ProductMedia, type Brand, type Category, type Subcategory } from '@/lib/types'
import type { RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'
import { createProductAction, updateProductAction } from '@/actions/products'
import { updateChromoffListingAction } from '@/actions/chromoff'
import { Download, ExternalLink, Palette, Settings2, Upload } from 'lucide-react'
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { normalizeDescription } from '@/components/products/ProductDescription'
import ProductPhotoGallery from '@/components/products/ProductPhotoGallery'
import MeasurementTemplatePicker from '@/components/import/MeasurementTemplatePicker'
import { isPriceOnRequest } from '@/lib/product-pricing'
import CatalogAttributeFields from '@/components/catalog-attributes/CatalogAttributeFields'
import MeasurementImageRecognizer from '@/components/catalog-attributes/MeasurementImageRecognizer'
import { normalizeCatalogAttributes } from '@/lib/catalog-attribute-values'
import { applyMeasurementTableAttributes } from '@/lib/measurement-templates'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'

interface ProductFormProps {
  product?: Product | null
  brands: Brand[]
  categories: Category[]
  subcategories: Subcategory[]
  attributeDefinitions?: CatalogAttributeDefinition[]
  isOpen: boolean
  onClose: () => void
  onSave?: (updatedProduct: Product) => void
  chromoffListing?: RailsChromoffListing | null
  chromoffCategories?: RailsChromoffCategory[]
}

function formatPublishedAt(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function formatSupplierPublishedOn(value: unknown) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : ''
}

export default function ProductForm({
  product,
  brands,
  categories,
  subcategories,
  attributeDefinitions,
  isOpen,
  onClose,
  onSave,
  chromoffListing = null,
  chromoffCategories = [],
}: ProductFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')

  const [productId, setProductId] = useState('')
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<Product['status']>('active')
  const [fulfillmentMode, setFulfillmentMode] = useState<Product['fulfillment_mode']>('made_to_order')
  const [availabilityConfidence, setAvailabilityConfidence] = useState<Product['availability_confidence']>('unknown')
  const [indexingStatus, setIndexingStatus] = useState<Product['indexing_status']>('indexable')
  const [productionMinDays, setProductionMinDays] = useState('')
  const [productionMaxDays, setProductionMaxDays] = useState('')
  const [officeDeliveryMinDays, setOfficeDeliveryMinDays] = useState('')
  const [officeDeliveryMaxDays, setOfficeDeliveryMaxDays] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [h1, setH1] = useState('')
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
  const [videoUrl, setVideoUrl] = useState('')
  const [videoPosterUrl, setVideoPosterUrl] = useState('')
  const [chromoffCategoryId, setChromoffCategoryId] = useState('')
  const [chromoffPublished, setChromoffPublished] = useState(false)
  const [chromoffLegacySlug, setChromoffLegacySlug] = useState('')
  const [chromoffH1, setChromoffH1] = useState('')
  const [chromoffSeoTitle, setChromoffSeoTitle] = useState('')
  const [chromoffSeoDescription, setChromoffSeoDescription] = useState('')

  const selectedCategoryName = useMemo(
    () => categories.find((item) => item.id === category)?.name || '',
    [categories, category],
  )
  const selectedSubcategoryName = useMemo(
    () => subcategories.find((item) => item.id === subcategory)?.name || '',
    [subcategories, subcategory],
  )
  const measurementSupplierId = useMemo(() => {
    const sourceId = product?.metadata?.source_supplier_id || product?.supplier?.id
    const parsed = Number(sourceId)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }, [product?.metadata?.source_supplier_id, product?.supplier?.id])

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
        setSku(product.sku && product.sku !== product.productId ? product.sku : '')
        setName(product.name)
        setDescription(normalizeDescription(product.description))
        setPrice(Number(product.price).toString())
        setStatus(product.status || 'active')
        setFulfillmentMode('made_to_order')
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
        setVideoUrl(product.video_url || '')
        setVideoPosterUrl(product.video_poster_url || '')
        setChromoffCategoryId(chromoffListing?.chromoff_category?.id || '')
        setChromoffPublished(Boolean(chromoffListing?.published ?? chromoffListing?.chromoff_published))
        setChromoffLegacySlug(chromoffListing?.legacy_slug || product.slug || '')
        setChromoffH1(chromoffListing?.h1 || product.h1 || product.name || '')
        setChromoffSeoTitle(chromoffListing?.seo_title || product.seo_title || product.name || '')
        setChromoffSeoDescription(chromoffListing?.seo_description || product.seo_description || productDescription)

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
        setProductId(createManualProductId())
        setSku('')
        setName('')
        setDescription('')
        setPrice('')
        setStatus('active')
        setFulfillmentMode('made_to_order')
        setAvailabilityConfidence('unknown')
        setIndexingStatus('indexable')
        setProductionMinDays('')
        setProductionMaxDays('')
        setOfficeDeliveryMinDays('')
        setOfficeDeliveryMaxDays('')
        setSeoTitle('')
        setSeoDescription('')
        setH1('')
        setCatalogAttributes({})
        setBrandIds([])
        setCategory(categories[0]?.id || '')
        setSubcategory('')
        setGender('')
        setPhotoUrlsToAdd('')
        setVideoUrl('')
        setVideoPosterUrl('')
        setChromoffCategoryId('')
        setChromoffPublished(false)
        setChromoffLegacySlug('')
        setChromoffH1('')
        setChromoffSeoTitle('')
        setChromoffSeoDescription('')
        setExistingPhotos([])
        setExistingMedia([])
      }
      setError('')
    }
  }, [isOpen, product, brands, categories, chromoffListing])

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
    formData.append('fulfillment_mode', 'made_to_order')
    formData.append('availability_confidence', availabilityConfidence || 'unknown')
    formData.append('indexing_status', indexingStatus || 'indexable')
    formData.append('production_min_days', productionMinDays)
    formData.append('production_max_days', productionMaxDays)
    formData.append('office_delivery_min_days', officeDeliveryMinDays)
    formData.append('office_delivery_max_days', officeDeliveryMaxDays)
    formData.append('seo_title', seoTitle.trim())
    formData.append('seo_description', seoDescription.trim())
    formData.append('h1', h1.trim())
    formData.append('video_url', videoUrl.trim())
    formData.append('video_poster_url', videoPosterUrl.trim())
    const normalizedCatalogAttributes = normalizeCatalogAttributes(catalogAttributes, {
      categoryName: selectedCategoryName,
      subcategoryName: selectedSubcategoryName,
      preserveUnknown: true,
      definitions: attributeDefinitions,
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
      const chromoffFormData = chromoffListing ? new FormData() : null
      if (chromoffFormData && chromoffListing) {
        chromoffFormData.append('id', chromoffListing.id)
        chromoffFormData.append('published', String(chromoffPublished))
        chromoffFormData.append('chromoff_category_id', chromoffCategoryId)
        chromoffFormData.append('legacy_slug', chromoffLegacySlug.trim())
        chromoffFormData.append('chromoff_h1', chromoffH1.trim())
        chromoffFormData.append('chromoff_seo_title', chromoffSeoTitle.trim())
        chromoffFormData.append('chromoff_seo_description', chromoffSeoDescription.trim())
      }
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
          fulfillment_mode: 'made_to_order',
          availability_confidence: availabilityConfidence,
          indexing_status: indexingStatus,
          production_min_days: productionMinDays ? Number(productionMinDays) : null,
          production_max_days: productionMaxDays ? Number(productionMaxDays) : null,
          office_delivery_min_days: officeDeliveryMinDays ? Number(officeDeliveryMinDays) : null,
          office_delivery_max_days: officeDeliveryMaxDays ? Number(officeDeliveryMaxDays) : null,
          seo_title: seoTitle.trim(),
          seo_description: seoDescription.trim(),
          h1: h1.trim(),
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
          video_url: videoUrl.trim() || null,
          video_poster_url: videoPosterUrl.trim() || null,
        })
      }
      onClose()

      const productPromise = updateProductAction(product.id, formData)
      const chromoffPromise = chromoffFormData
        ? updateChromoffListingAction(chromoffFormData)
        : Promise.resolve({ success: true, message: '' })
      Promise.all([productPromise, chromoffPromise])
        .then(([productResult, chromoffResult]) => {
          if (!productResult.success) {
            window.alert(productResult.error || 'Не удалось сохранить товар')
          } else if (!chromoffResult.success) {
            window.alert(chromoffResult.message || 'Не удалось сохранить настройки Chromoff')
          }
          router.refresh()
        })
        .catch(() => window.alert('Не удалось сохранить товар'))
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

  useEffect(() => {
    if (!isOpen) return

    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isPhotoModalOpen) return

        event.preventDefault()
        onClose()
        return
      }

      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
      if (!isSaveShortcut) return

      event.preventDefault()
      if (event.repeat || isPending || isPhotoModalOpen) return

      formRef.current?.requestSubmit()
    }

    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [isOpen, isPending, isPhotoModalOpen, onClose])

  if (!isOpen) return null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) onClose()
    }}>
      <SheetContent side="right" className="flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-gray-800 p-0 lg:max-w-2xl">
          <SheetHeader className="flex shrink-0 flex-row items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-4 py-3 pr-12 sm:px-5">
            <SheetTitle>{product ? 'Изменить товар' : 'Новый товар'}</SheetTitle>
            <SheetDescription className="sr-only">
              Редактирование данных, цены и фотографий товара
            </SheetDescription>
            {product?.slug && (
              <Button asChild type="button" variant="outline" size="sm" className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700">
                <a
                  href={`${process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://yeezyunique.ru'}/product/${product.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Открыть на сайте
                </a>
              </Button>
            )}
          </SheetHeader>

          {/* Form */}
          <form ref={formRef} onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-6 sm:p-5">
            {error && (
              <Alert variant="destructive" className="border-red-800 bg-red-900/20 text-red-400">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Photos Upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Фотографии товара
                </label>
                <div className="flex gap-2 ml-auto">
                  {existingPhotos.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadAll}
                      className="border-green-800/50 bg-green-900/20 text-green-400 hover:bg-green-900/30 hover:text-green-300"
                      disabled={isPending || isDownloading}
                    >
                      <Download size={16} />
                      {isDownloading ? 'Скачивание...' : 'Скачать'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="h-fit border-blue-800/50 bg-blue-900/20 text-blue-400 hover:bg-blue-900/30 hover:text-blue-300"
                    disabled={isPending}
                  >
                    <Upload size={16} />
                    Добавить фото
                  </Button>
                </div>
              </div>

              {/* Existing Photos with Drag and Drop */}
              {existingPhotos.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1.5 text-xs text-gray-500">Перетащите фото, чтобы изменить порядок:</p>
                  <ProductPhotoGallery
                    photos={existingPhotos}
                    onChange={setExistingPhotos}
                    onRemove={removeExistingPhoto}
                    onDownload={handleDownload}
                  />
                </div>
              )}

              {/* New Photos (Removed, as we now use URL input directly to existing photos list) */}
            </div>

            {/* Video */}
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/35 p-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Видео товара</label>
                <p className="mt-1 text-xs text-gray-500">Видео хранится отдельно от фотографий и показывается последней миниатюрой на сайте.</p>
              </div>
              {videoUrl && (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={videoPosterUrl || existingPhotos[0] || undefined}
                  className="max-h-64 w-full rounded-md bg-black object-contain"
                >
                  <source src={videoUrl} type="video/mp4" />
                </video>
              )}
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="https://.../video.mp4"
                disabled={isPending}
              />
              <input
                type="url"
                value={videoPosterUrl}
                onChange={(e) => setVideoPosterUrl(e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                placeholder="URL постера (необязательно)"
                disabled={isPending}
              />
              {(videoUrl || videoPosterUrl) && (
                <Button type="button" variant="outline" size="sm" onClick={() => { setVideoUrl(''); setVideoPosterUrl('') }} className="w-fit border-red-800/50 bg-red-900/20 text-red-400 hover:bg-red-900/30" disabled={isPending}>
                  Удалить видео
                </Button>
              )}
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
              <div className="mb-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-indigo-100">Распознать таблицу замеров</div>
                    <p className="mt-1 text-[11px] text-slate-400">Загрузите, вставьте из буфера или скопируйте фото таблицы — ИИ перенесёт размеры и значения ниже.</p>
                  </div>
                </div>
                <MeasurementImageRecognizer
                  disabled={isPending}
                  onRecognized={(measurements) => setCatalogAttributes((current) => applyMeasurementTableAttributes(current, measurements))}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-indigo-500/15 pt-3">
                  <span className="text-[11px] text-slate-400">Или выбрать шаблон поставщика</span>
                  <MeasurementTemplatePicker
                    key={`${product?.id || 'new'}-${measurementSupplierId || 'none'}`}
                    supplierId={measurementSupplierId}
                    onApply={(measurements) => setCatalogAttributes((current) => applyMeasurementTableAttributes(current, measurements))}
                  />
                </div>
              </div>
              <CatalogAttributeFields
                value={catalogAttributes}
                onChange={setCatalogAttributes}
                categoryName={selectedCategoryName}
                subcategoryName={selectedSubcategoryName}
                registryDefinitions={attributeDefinitions}
              />
            </div>

            {product?.color_variants && product.color_variants.length > 1 && (
              <section className="space-y-3 rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-violet-300" />
                  <h3 className="text-sm font-semibold text-violet-100">
                    Цветовые варианты ({product.color_variants.length})
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {product.color_variants.map((variant) => (
                    <a
                      key={variant.id}
                      href={`${process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://yeezyunique.ru'}/product/${variant.slug || product.slug || ''}`}
                      target="_blank"
                      rel="noreferrer"
                      className={`overflow-hidden rounded-lg border text-left transition hover:border-violet-400 ${variant.current ? 'border-violet-400 bg-violet-500/15' : 'border-slate-700 bg-slate-900/60'}`}
                    >
                      <div className="relative aspect-[4/3] bg-slate-950">
                        {variant.image_url ? (
                          <Image src={variant.image_url} alt={variant.color || variant.name || ''} fill unoptimized className="object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-slate-600">Нет фото</div>
                        )}
                      </div>
                      <div className="space-y-0.5 p-2">
                        <div className="truncate text-xs font-semibold text-slate-200">{variant.color || 'Цвет не указан'}</div>
                        <div className="line-clamp-2 text-[10px] text-slate-500">{variant.name || 'Открыть товар'}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {product?.supplier && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Поставщик</p>
                  <p className="mt-1 text-sm font-medium text-slate-200">{product.supplier.name}</p>
                </div>
                {product.supplier.avatar_url ? (
                  <Image src={product.supplier.avatar_url} alt="" width={36} height={36} unoptimized className="h-9 w-9 rounded-full border border-slate-600 object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-slate-300">
                    {product.supplier.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            )}

            <details className="rounded-lg border border-slate-700 bg-slate-900/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-300">
                <Settings2 className="h-3.5 w-3.5" />
                Технические данные
              </summary>
              <div className="grid gap-4 border-t border-slate-700 p-3 md:grid-cols-2">
                {product && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-400">Артикул</label>
                    <input
                      type="text"
                      value={product.seo_article || 'Не присвоен'}
                      readOnly
                      aria-label="Артикул"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
                    />
                    <p className="text-[10px] text-slate-600">Формируется автоматически. Изменение запрещено.</p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-500">External ID</label>
                  <input
                    type="text"
                    value={productId}
                    readOnly
                    aria-label="External ID"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-500"
                  />
                  <p className="text-[10px] text-slate-600">Системный идентификатор. Изменение запрещено.</p>
                </div>
                {(product?.published_at || product?.metadata?.source_published_at) && <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">Последний пуш</label>
                  <input
                    type="text"
                    value={formatPublishedAt(product.published_at || product.metadata?.source_published_at)}
                    readOnly
                    aria-label="Последний пуш"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <p className="text-[10px] text-slate-600">Время последней публикации товара в каталог.</p>
                </div>}
                {product?.metadata?.supplier_published_on && <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">Выложен у поставщика</label>
                  <input
                    type="text"
                    value={formatSupplierPublishedOn(product.metadata.supplier_published_on)}
                    readOnly
                    aria-label="Выложен у поставщика"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <p className="text-[10px] text-slate-600">Дата публикации в альбоме поставщика.</p>
                </div>}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">SKU</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(event) => setSku(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
                    placeholder="Отдельный товарный артикул"
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-400">Статус</label>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as Product['status'])}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
                    disabled={isPending}
                  >
                    <option value="draft">Черновик</option>
                    <option value="active">Активен</option>
                    <option value="hidden">Скрыт</option>
                    <option value="archived">Архив</option>
                  </select>
                </div>
              </div>
            </details>

            {chromoffListing && (
              <section className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                <div>
                  <h3 className="text-sm font-semibold text-violet-100">Chromoff</h3>
                  <p className="mt-1 text-xs text-slate-400">Поля этой секции относятся только к витрине chromoff.store.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">Категория Chromoff</label>
                    <select
                      value={chromoffCategoryId}
                      onChange={(event) => setChromoffCategoryId(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500"
                      disabled={isPending}
                    >
                      <option value="">Без категории</option>
                      {chromoffCategories.map((item) => (
                        <option key={item.id} value={item.id}>{item.parent_id ? '↳ ' : ''}{item.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">Публикация</label>
                    <select
                      value={chromoffPublished ? 'published' : 'hidden'}
                      onChange={(event) => setChromoffPublished(event.target.value === 'published')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500"
                      disabled={isPending}
                    >
                      <option value="published">Опубликован на Chromoff</option>
                      <option value="hidden">Скрыт с Chromoff</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Chromoff slug</label>
                  <input value={chromoffLegacySlug} onChange={(event) => setChromoffLegacySlug(event.target.value)} disabled={isPending} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">Chromoff H1</label>
                    <input value={chromoffH1} onChange={(event) => setChromoffH1(event.target.value)} disabled={isPending} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">Chromoff SEO title</label>
                    <input value={chromoffSeoTitle} onChange={(event) => setChromoffSeoTitle(event.target.value)} disabled={isPending} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Chromoff SEO description</label>
                  <textarea value={chromoffSeoDescription} onChange={(event) => setChromoffSeoDescription(event.target.value)} rows={3} disabled={isPending} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500" />
                </div>
              </section>
            )}

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
            </div>
          </form>

          {/* Footer */}
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-700 bg-gray-900 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:space-x-3 sm:px-5 sm:pb-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="w-full border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white sm:w-auto"
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={isPending}
              title="Сохранить (Ctrl+S)"
              className="w-full sm:w-auto"
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

function createManualProductId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `manual-${crypto.randomUUID()}`
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

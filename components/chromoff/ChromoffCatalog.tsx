'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { CheckSquare, Filter, FolderTree, LayoutGrid, Plus, RotateCcw, Square, Trash2, Upload, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Brand, Category, Product, Subcategory } from '@/lib/types'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'
import type { RailsChromoffCandidate, RailsChromoffCategory, RailsChromoffListing } from '@/lib/rails-admin'
import { getProductAction } from '@/actions/products'
import { bulkUpdateProductsAction, type BulkProductUpdates } from '@/actions/bulk-update'
import { createChromoffListingAction, deleteChromoffListingAction, deleteChromoffListingsAction, importChromoffCatalogAction, previewChromoffImportAction, setChromoffListingPublishedAction, setChromoffListingsPublishedAction, setChromoffListingsSupplierAction } from '@/actions/chromoff'
import ProductCard from '@/components/products/ProductCard'
import ProductForm from '@/components/products/ProductForm'
import ChromoffSidebar, { type ChromoffSupplierOption } from '@/components/chromoff/ChromoffSidebar'
import { isPriceOnRequest } from '@/lib/product-pricing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface ChromoffCatalogProps {
  categories: RailsChromoffCategory[]
  listings: RailsChromoffListing[]
  candidates: RailsChromoffCandidate[]
  catalogCategories: Category[]
  catalogSubcategories: Subcategory[]
  brands: Brand[]
  attributeDefinitions?: CatalogAttributeDefinition[]
  suppliers: ChromoffSupplierOption[]
  assignableSuppliers: ChromoffSupplierOption[]
  totalItems: number
  totalPages: number
  page: number
  perPage: number
}

function listingProductId(listing: RailsChromoffListing) {
  return String(listing.product_id || listing.id || '').trim()
}

function listingToProduct(listing: RailsChromoffListing): Product {
  const productId = listingProductId(listing) || listing.id
  const photos = (listing.images || (listing.image_url ? [listing.image_url] : [])).filter(Boolean).map(String)
  const rawGender = String(listing.gender || '')
  const gender = rawGender === 'male' ? 'Для мужчин' : rawGender === 'female' ? 'Для женщин' : rawGender === 'unisex' ? 'Унисекс' : rawGender
  const product: Product = {
    id: productId,
    productId: listing.external_id || productId,
    external_id: listing.external_id || '',
    sku: listing.sku || '',
    seo_article: listing.seo_article || '',
    slug: listing.slug || listing.legacy_slug || '',
    name: listing.name || '',
    description: listing.description || '',
    price: Number(listing.price_cents || 0) / 100,
    price_cents: Number(listing.price_cents || 0),
    price_on_request: Boolean(listing.price_on_request) || Number(listing.price_cents || 0) <= 0,
    status: ['draft', 'active', 'hidden', 'archived'].includes(String(listing.status)) ? listing.status as Product['status'] : 'hidden',
    brand: listing.brand?.id || '',
    category: listing.category?.parent_id ? String(listing.category.parent_id) : String(listing.category?.id || ''),
    subcategory: listing.category?.parent_id ? String(listing.category.id) : '',
    photos,
    media: photos.map((url, index) => ({ original_url: url, preview_url: url, thumb_url: url, og_image_url: url, alt_text: listing.name || '', sort_order: index, processing_status: 'processed' as const })),
    video_url: listing.video_url || null,
    video_poster_url: listing.video_poster_url || null,
    supplier: listing.supplier || null,
    photos_processed: true,
    gender,
    thumb: listing.image_url || photos[0] || '',
    fulfillment_mode: 'made_to_order',
    availability_confidence: 'unknown',
    indexing_status: 'indexable',
    currency: 'RUB',
    seo_title: listing.seo_title || '',
    seo_description: listing.seo_description || '',
    h1: listing.h1 || '',
    metadata: listing.metadata || {},
    catalog_attributes: listing.catalog_attributes || {},
    attributes: listing.catalog_attributes || {},
    color_variants: listing.color_variants || [],
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'products',
  }
  return {
    ...product,
    id: listingProductId(listing) || product.id,
    metadata: {
      ...(product.metadata || {}),
      chromoff_listing_id: listing.id,
      chromoff_category_status: listing.chromoff_category_status || '',
    },
  }
}

function categoryStatus(listing: RailsChromoffListing) {
  return listing.chromoff_category?.name || String(listing.metadata?.chromoff_category_name || '').trim() || 'Не назначен'
}

function aiStatusLabel(listing: RailsChromoffListing) {
  switch (listing.chromoff_category_status) {
    case 'ai_assigned': return 'AI назначил'
    case 'mapped': return 'Сопоставлено'
    case 'manual': return 'Вручную'
    default: return 'Нужна проверка'
  }
}

function seoLabel(listing: RailsChromoffListing) {
  return listing.h1 && listing.seo_title && listing.seo_description ? 'SEO заполнено' : 'SEO требует внимания'
}

function formatPrice(priceCents: number) {
  if (priceCents <= 0) return 'Цена по запросу'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(priceCents / 100)
}

function buildPageUrl(searchParams: URLSearchParams, page: number) {
  const next = new URLSearchParams(searchParams)
  if (page > 1) next.set('page', String(page))
  else next.delete('page')
  return next.toString() ? `/admin/chromoff?${next}` : '/admin/chromoff'
}

export default function ChromoffCatalog({
  categories,
  listings: initialListings,
  candidates,
  catalogCategories,
  catalogSubcategories,
  brands,
  attributeDefinitions,
  suppliers,
  assignableSuppliers,
  totalItems,
  totalPages,
  page,
  perPage,
}: ChromoffCatalogProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [listings, setListings] = useState(initialListings)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingListing, setEditingListing] = useState<RailsChromoffListing | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [importMessage, setImportMessage] = useState('')
  const [addMessage, setAddMessage] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedSubcategory, setSelectedSubcategory] = useState('')
  const [selectedGender, setSelectedGender] = useState('')
  const [selectedPrice, setSelectedPrice] = useState('')
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isBulkPublishing, setIsBulkPublishing] = useState(false)
  const [isBulkSupplierUpdating, setIsBulkSupplierUpdating] = useState(false)
  const [selectedPublication, setSelectedPublication] = useState<'published' | 'hidden' | ''>('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [gridColumns, setGridColumns] = useState(4)

  useEffect(() => {
    setListings(initialListings)
    setSelectedIds([])
  }, [initialListings])

  const products = useMemo(() => listings.map(listingToProduct), [listings])
  const hasBulkUpdates = Boolean(selectedCategory || selectedSubcategory || selectedGender || selectedPrice.trim())
  const isCompactGrid = gridColumns >= 5
  const gridClassName = gridColumns === 4 ? 'lg:grid-cols-4' : gridColumns === 5 ? 'lg:grid-cols-5' : gridColumns === 6 ? 'lg:grid-cols-6' : gridColumns === 7 ? 'lg:grid-cols-7' : gridColumns === 8 ? 'lg:grid-cols-8' : gridColumns === 9 ? 'lg:grid-cols-9' : 'lg:grid-cols-10'

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('chromoffGridColumns'))
    if (Number.isInteger(saved) && saved >= 4 && saved <= 10) setGridColumns(saved)
  }, [])

  const changeGridColumns = (value: number) => {
    setGridColumns(value)
    window.localStorage.setItem('chromoffGridColumns', String(value))
  }

  const changePageSize = (value: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('perPage', String(value))
    next.delete('page')
    router.push(`/admin/chromoff?${next}`)
  }

  const updateListingFromProduct = (updatedProduct: Product) => {
    setListings((current) => current.map((listing) => listingProductId(listing) === updatedProduct.id
      ? { ...listing, name: updatedProduct.name, description: updatedProduct.description, price_cents: Math.round(updatedProduct.price * 100), status: updatedProduct.status, gender: updatedProduct.gender, category: listing.category }
      : listing))
  }

  const openEditor = async (listing: RailsChromoffListing) => {
    const product = listingToProduct(listing)
    setEditingListing(listing)
    setEditingProduct(product)
    const result = await getProductAction(product.id)
    if (result.success && result.data) {
      setEditingProduct({ ...(result.data as Product), id: product.id })
    }
  }

  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const togglePublished = (listing: RailsChromoffListing) => {
    const nextPublished = !Boolean(listing.published)
    const formData = new FormData()
    formData.append('id', listing.id)
    formData.append('published', String(nextPublished))
    startTransition(async () => {
      const result = await setChromoffListingPublishedAction(formData)
      if (result.success) setListings((current) => current.map((item) => item.id === listing.id ? { ...item, published: nextPublished, chromoff_published: nextPublished } : item))
      else window.alert(result.message)
    })
  }

  const handleDelete = async (id: string) => {
    const listing = listings.find((item) => listingProductId(item) === id)
    if (!listing || !confirm('Удалить этот товар из Chromoff?')) return
    const result = await deleteChromoffListingAction(listing.id)
    if (result.success) setListings((current) => current.filter((item) => item.id !== listing.id))
    else window.alert(result.message || 'Не удалось удалить товар из Chromoff')
  }

  const handleBulkUpdate = async () => {
    if (!hasBulkUpdates) return
    const price = Number(selectedPrice)
    if (selectedPrice.trim() && (!Number.isFinite(price) || price < 0)) return window.alert('Введите корректную цену')
    if (!confirm(`Обновить ${selectedIds.length} товаров?`)) return
    setIsBulkUpdating(true)
    const updates: BulkProductUpdates = {}
    if (selectedCategory) updates.category = selectedCategory
    if (selectedSubcategory) updates.subcategory = selectedSubcategory
    if (selectedGender) updates.gender = selectedGender
    if (selectedPrice.trim()) updates.price = price
    const result = await bulkUpdateProductsAction(selectedIds, updates)
    if (!result.success) window.alert(result.error || 'Не удалось обновить товары')
    else {
      setListings((current) => current.map((listing) => {
        if (!selectedIds.includes(listingProductId(listing))) return listing
        return {
          ...listing,
          ...(selectedCategory ? { category: { ...(listing.category || { id: selectedCategory, name: '', slug: '' }), id: selectedCategory } } : {}),
          ...(selectedPrice.trim() ? { price_cents: Math.round(price * 100), price_on_request: isPriceOnRequest(price) } : {}),
          ...(selectedGender ? { gender: selectedGender } : {}),
        }
      }))
      setSelectedIds([])
      setSelectedCategory('')
      setSelectedSubcategory('')
      setSelectedGender('')
      setSelectedPrice('')
      router.refresh()
    }
    setIsBulkUpdating(false)
  }

  const handleBulkDelete = async () => {
    const selectedListingIds = listings
      .filter((listing) => selectedIds.includes(listingProductId(listing)))
      .map((listing) => listing.id)
    if (!selectedListingIds.length || !confirm(`Удалить ${selectedListingIds.length} товаров из Chromoff?`)) return
    setIsBulkDeleting(true)
    const result = await deleteChromoffListingsAction(selectedListingIds)
    if (result.success) {
      setListings((current) => current.filter((listing) => !selectedListingIds.includes(listing.id)))
      setSelectedIds([])
    } else window.alert(result.message || 'Не удалось удалить товары из Chromoff')
    setIsBulkDeleting(false)
  }

  const handleBulkPublication = () => {
    if (!selectedPublication) return
    const selectedListingIds = listings.filter((listing) => selectedIds.includes(listingProductId(listing))).map((listing) => listing.id)
    if (!selectedListingIds.length) return
    const published = selectedPublication === 'published'
    if (!confirm(`${published ? 'Опубликовать' : 'Скрыть'} ${selectedListingIds.length} товаров на Chromoff?`)) return
    setIsBulkPublishing(true)
    startTransition(async () => {
      const result = await setChromoffListingsPublishedAction(selectedListingIds, published)
      if (result.success) {
        setListings((current) => current.map((listing) => selectedListingIds.includes(listing.id) ? { ...listing, published, chromoff_published: published } : listing))
        setSelectedIds([])
        setSelectedPublication('')
      } else window.alert(result.message)
      setIsBulkPublishing(false)
    })
  }

  const handleBulkSupplier = () => {
    if (!selectedSupplier) return
    const selectedListingIds = listings.filter((listing) => selectedIds.includes(listingProductId(listing))).map((listing) => listing.id)
    if (!selectedListingIds.length) return
    const supplier = selectedSupplier === '__none__'
      ? { id: '__none__', name: 'Без поставщика', count: 0 }
      : assignableSuppliers.find((item) => item.id === selectedSupplier)
    if (!supplier) return
    if (!confirm(`Изменить поставщика у ${selectedListingIds.length} товаров?`)) return
    setIsBulkSupplierUpdating(true)
    startTransition(async () => {
      const result = await setChromoffListingsSupplierAction(selectedListingIds, supplier.id, supplier.id === '__none__' ? undefined : supplier.name)
      if (result.success) {
        const isAuto = ['_Z4krSCEyDqn5hvTYMJDEp4rykS4WwC0I', '_d_MrS1r4uCqp1cjuoVnfj6jJ42_p9R9NgeH-vag', '_Z6wrSBWbbi48HUyk59lk5c4PXN9NKqUQ'].includes(supplier.id)
        setListings((current) => current.map((listing) => selectedListingIds.includes(listing.id) ? {
          ...listing,
          source_supplier_id: supplier.id === '__none__' ? null : supplier.id,
          source_supplier_name: supplier.id === '__none__' ? null : supplier.name,
          sync_mode: isAuto ? 'auto' : 'manual',
        } : listing))
        setSelectedIds([])
        setSelectedSupplier('')
        router.refresh()
      } else window.alert(result.message)
      setIsBulkSupplierUpdating(false)
    })
  }

  const previewImport = () => startTransition(async () => {
    const result = await previewChromoffImportAction()
    setImportMessage(result.success ? `Проверено: ${Number(result.result?.products_received || 0).toLocaleString('ru-RU')} товаров.` : result.message || '')
  })

  const importCatalog = () => startTransition(async () => {
    const result = await importChromoffCatalogAction()
    setImportMessage(result.success ? `Импортировано: ${Number(result.imported || 0).toLocaleString('ru-RU')} товаров.` : result.message || '')
    if (result.success) router.refresh()
  })

  return (
    <div className="min-h-screen bg-slate-900 font-sans text-slate-200 lg:flex">
      <ChromoffSidebar categories={catalogCategories} subcategories={catalogSubcategories} chromoffCategories={categories} suppliers={suppliers} count={totalItems} isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} isNavigationPending={isPending} />
      <main className={`min-w-0 flex-1 px-4 py-5 sm:p-6 ${selectedIds.length ? 'pb-48 lg:pb-28' : ''}`}>
        <div className="mx-auto max-w-[1600px]">
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-slate-100">Chromoff</h1><Badge className="bg-violet-500/15 text-violet-200 hover:bg-violet-500/15">chromoff.store</Badge></div><p className="mt-1 text-sm text-slate-400">Каталог общего товара с отдельной публикацией, категорией и SEO Chromoff</p></div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button type="button" variant="outline" onClick={() => setIsSidebarOpen(true)} className="h-11 flex-1 border-slate-700 bg-slate-800 text-slate-200 lg:hidden"><Filter className="h-4 w-4" />Фильтры</Button>
              <Button type="button" variant="outline" onClick={() => setIsImportOpen(true)} className="h-11 border-slate-700 bg-slate-800 text-slate-200"><Upload className="h-4 w-4" />Импорт</Button>
              <Button asChild type="button" variant="outline" className="h-11 border-slate-700 bg-slate-800 text-slate-200"><Link href="/admin/chromoff/categories"><FolderTree className="h-4 w-4" />Категории</Link></Button>
              <Button type="button" onClick={() => setIsAddOpen(true)} className="h-11"><Plus className="h-4 w-4" />Добавить</Button>
            </div>
          </header>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2.5">
            <Button type="button" variant="ghost" onClick={() => setSelectedIds(selectedIds.length === products.length ? [] : products.map((product) => product.id))} className="h-auto px-1 text-sm text-slate-400 hover:bg-transparent hover:text-violet-300">
              {selectedIds.length === products.length && products.length > 0 ? <CheckSquare className="h-5 w-5 text-violet-400" /> : <Square className="h-5 w-5" />}
              {selectedIds.length === products.length && products.length > 0 ? 'Снять всё' : 'Выбрать все на странице'}
            </Button>
            <div className="flex items-center gap-2"><label className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-400 xl:flex"><span className="whitespace-nowrap">В ряд: {gridColumns}</span><input type="range" min="4" max="10" step="1" value={gridColumns} onChange={(event) => changeGridColumns(Number(event.target.value))} className="h-1.5 w-24 cursor-pointer accent-violet-500" aria-label="Количество карточек в ряду" /></label><label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-400"><span className="whitespace-nowrap">На странице</span><select value={perPage} onChange={(event) => changePageSize(Number(event.target.value))} className="bg-transparent text-slate-200 outline-none"><option value="40">40</option><option value="100">100</option><option value="500">500</option></select></label><div className="flex items-center gap-2 text-sm text-slate-400"><LayoutGrid className="h-4 w-4 text-violet-300" />{totalItems.toLocaleString('ru-RU')} товаров · страница {page} из {Math.max(totalPages, 1)}</div></div>
          </div>

          {products.length > 0 ? <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${gridClassName}`}>
            {products.map((product, index) => {
              const listing = listings[index]
              return <ProductCard
                key={listing.id}
                product={product}
                brands={brands}
                categories={catalogCategories}
                subcategories={catalogSubcategories}
                onEdit={() => openEditor(listing)}
                onDelete={handleDelete}
                onUpdate={updateListingFromProduct}
                selected={selectedIds.includes(product.id)}
                onToggleSelect={toggleSelected}
                variantCount={product.color_variants?.length || 0}
                variantColors={Array.from(new Set((product.color_variants || []).map((variant) => variant.color).filter((value): value is string => Boolean(value))))}
                showAttributeSummary={!isCompactGrid}
                showDescription={!isCompactGrid}
                extraBadges={<><Badge className={listing.published ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15' : 'bg-slate-700 text-slate-300 hover:bg-slate-700'}>{listing.published ? 'Опубликован' : 'Скрыт'}</Badge><Badge variant="outline" className="border-violet-500/30 text-violet-300">{listing.sync_mode === 'auto' ? 'Автосинхронизация' : 'Ручной товар'}</Badge><Badge variant="outline" className={listing.chromoff_category_status === 'needs_review' || !listing.chromoff_category ? 'border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-400'}>{aiStatusLabel(listing)}</Badge></>}
                extraFooter={isCompactGrid ? undefined : <div className="space-y-2"><div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span className="truncate">{categoryStatus(listing)}</span><span className={seoLabel(listing) === 'SEO заполнено' ? 'text-emerald-400' : 'text-amber-400'}>{seoLabel(listing)}</span></div><Button type="button" size="sm" variant={listing.published ? 'outline' : 'default'} onClick={(event) => { event.stopPropagation(); togglePublished(listing) }} disabled={isPending} className="h-8 w-full">{listing.published ? 'Скрыть с Chromoff' : 'Опубликовать на Chromoff'}</Button></div>}
              />
            })}
          </div> : <div className="rounded-xl border border-dashed border-slate-700 py-20 text-center"><RotateCcw className="mx-auto h-8 w-8 text-slate-600" /><h2 className="mt-3 text-lg font-medium text-slate-200">Ничего не найдено</h2><p className="mt-1 text-sm text-slate-500">Измените фильтры в боковой панели.</p></div>}

          {totalPages > 1 && <nav className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Страницы Chromoff"><Button asChild variant="outline" size="sm" className={page === 1 ? 'pointer-events-none opacity-50' : ''}><a href={buildPageUrl(searchParams, Math.max(1, page - 1))}>Назад</a></Button>{Array.from({ length: totalPages }, (_, index) => index + 1).filter((itemPage) => itemPage >= page - 2 && itemPage <= page + 2).map((itemPage) => <Button key={itemPage} asChild size="sm" variant={itemPage === page ? 'default' : 'outline'}><a href={buildPageUrl(searchParams, itemPage)}>{itemPage}</a></Button>)}<Button asChild variant="outline" size="sm" className={page === totalPages ? 'pointer-events-none opacity-50' : ''}><a href={buildPageUrl(searchParams, Math.min(totalPages, page + 1))}>Вперёд</a></Button></nav>}
        </div>
      </main>

      <ProductForm product={editingProduct} brands={brands} categories={catalogCategories} subcategories={catalogSubcategories} attributeDefinitions={attributeDefinitions} isOpen={Boolean(editingProduct && editingListing)} chromoffListing={editingListing} chromoffCategories={categories} onClose={() => { setEditingListing(null); setEditingProduct(null) }} onSave={updateListingFromProduct} />

      <div className={`fixed bottom-0 left-0 right-0 z-40 border-t border-slate-700 bg-slate-800 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 transition-transform lg:left-72 ${selectedIds.length ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:flex-row lg:items-center"><div className="flex items-center justify-between gap-2 text-sm text-slate-300 lg:shrink-0"><Badge>{selectedIds.length}</Badge><span>выбрано</span><Button type="button" variant="ghost" size="icon" onClick={() => setSelectedIds([])} className="h-8 w-8 text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></Button></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-1 lg:justify-end">
          <Select value={selectedPublication || '__unchanged__'} onValueChange={(value) => setSelectedPublication(value === '__unchanged__' ? '' : value as 'published' | 'hidden')}><SelectTrigger className="h-10 bg-slate-700 text-slate-200"><SelectValue placeholder="Публикация Chromoff" /></SelectTrigger><SelectContent><SelectItem value="__unchanged__">Chromoff: без изменений</SelectItem><SelectItem value="published">Опубликовать</SelectItem><SelectItem value="hidden">Скрыть</SelectItem></SelectContent></Select>
          <Button type="button" variant="secondary" onClick={handleBulkPublication} disabled={!selectedPublication || isBulkPublishing || isPending} className="h-10">{isBulkPublishing ? 'Публикация…' : 'Применить Chromoff'}</Button>
          <Select value={selectedSupplier || '__unchanged__'} onValueChange={(value) => setSelectedSupplier(value === '__unchanged__' ? '' : value)}><SelectTrigger className="h-10 bg-slate-700 text-slate-200"><SelectValue placeholder="Поставщик Chromoff" /></SelectTrigger><SelectContent><SelectItem value="__unchanged__">Поставщик: без изменений</SelectItem>{assignableSuppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}<SelectItem value="__none__">Без поставщика</SelectItem></SelectContent></Select>
          <Button type="button" variant="secondary" onClick={handleBulkSupplier} disabled={!selectedSupplier || isBulkSupplierUpdating || isPending} className="h-10">{isBulkSupplierUpdating ? 'Поставщик…' : 'Применить поставщика'}</Button>
          <Select value={selectedGender || '__unchanged__'} onValueChange={(value) => setSelectedGender(value === '__unchanged__' ? '' : value)}><SelectTrigger className="h-10 bg-slate-700 text-slate-200"><SelectValue placeholder="Пол" /></SelectTrigger><SelectContent><SelectItem value="__unchanged__">Пол: без изменений</SelectItem><SelectItem value="Для мужчин">Для мужчин</SelectItem><SelectItem value="Для женщин">Для женщин</SelectItem><SelectItem value="Унисекс">Унисекс</SelectItem></SelectContent></Select>
          <Select value={selectedCategory || '__unchanged__'} onValueChange={(value) => { setSelectedCategory(value === '__unchanged__' ? '' : value); setSelectedSubcategory('') }}><SelectTrigger className="h-10 bg-slate-700 text-slate-200"><SelectValue placeholder="Категория" /></SelectTrigger><SelectContent><SelectItem value="__unchanged__">Категория: без изменений</SelectItem>{catalogCategories.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
          <Select value={selectedSubcategory || '__unchanged__'} onValueChange={(value) => setSelectedSubcategory(value === '__unchanged__' ? '' : value)} disabled={!selectedCategory}><SelectTrigger className="h-10 bg-slate-700 text-slate-200"><SelectValue placeholder="Подкатегория" /></SelectTrigger><SelectContent><SelectItem value="__unchanged__">Подкатегория: без изменений</SelectItem><SelectItem value="__none__">Сбросить подкатегорию</SelectItem>{catalogSubcategories.filter((item) => item.category === selectedCategory).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
          <Input type="number" min="0" value={selectedPrice} onChange={(event) => setSelectedPrice(event.target.value)} placeholder="Цена, ₽" className="h-10 bg-slate-700 text-slate-200" />
          <Button type="button" onClick={handleBulkUpdate} disabled={!hasBulkUpdates || isBulkUpdating || isBulkDeleting} className="h-10">{isBulkUpdating ? 'Обновление…' : 'Применить'}</Button><Button type="button" variant="destructive" size="icon" onClick={handleBulkDelete} disabled={isBulkUpdating || isBulkDeleting} className="h-10 w-10" title="Удалить из Chromoff"><Trash2 className="h-4 w-4" /></Button>
        </div></div>
      </div>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}><DialogContent className="border-slate-700 bg-slate-800 text-slate-100"><DialogHeader><DialogTitle>Импорт каталога Chromoff</DialogTitle><DialogDescription className="text-slate-400">Сначала выполните проверку, затем запустите импорт из старого источника.</DialogDescription></DialogHeader><div className="flex flex-col gap-3 sm:flex-row"><Button type="button" variant="outline" onClick={previewImport} disabled={isPending} className="border-slate-600 bg-slate-700 text-slate-200">{isPending ? 'Проверяем…' : 'Проверить импорт'}</Button><Button type="button" onClick={importCatalog} disabled={isPending}>{isPending ? 'Импортируем…' : 'Импортировать каталог'}</Button></div>{importMessage && <p className="text-sm text-slate-300" role="status">{importMessage}</p>}<DialogFooter><Button type="button" variant="ghost" onClick={() => setIsImportOpen(false)}>Закрыть</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}><DialogContent className="border-slate-700 bg-slate-800 text-slate-100"><DialogHeader><DialogTitle>Добавить товар в Chromoff</DialogTitle><DialogDescription className="text-slate-400">Выберите существующий общий товар и подраздел Chromoff.</DialogDescription></DialogHeader><form action={(formData) => startTransition(async () => { const result = await createChromoffListingAction(formData); setAddMessage(result.message); if (result.success) router.refresh() })} className="space-y-3"><select name="product_id" required className="h-11 w-full rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-slate-200"><option value="">Выберите товар</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {formatPrice(candidate.price_cents)}</option>)}</select><select name="chromoff_category_id" required className="h-11 w-full rounded-md border border-slate-600 bg-slate-700 px-3 text-sm text-slate-200"><option value="">Выберите категорию Chromoff</option>{categories.filter((item) => item.parent_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="hidden" name="published" value="true" /><Button type="submit" disabled={isPending} className="w-full">{isPending ? 'Добавляем…' : 'Добавить и опубликовать'}</Button>{addMessage && <p className="text-sm text-slate-300" role="status">{addMessage}</p>}</form></DialogContent></Dialog>
    </div>
  )
}

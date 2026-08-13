'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type Product, type Brand, type Category, type Subcategory, type ProductFilterFacets } from '@/lib/types'
import { deleteProductAction } from '@/actions/products'
import { bulkUpdateProductsAction, bulkDeleteProductsAction, type BulkProductUpdates } from '@/actions/bulk-update'
import ProductForm from '@/components/products/ProductForm'
import { LayoutGrid, List, Search, Plus, CheckSquare, Square, Trash2, X } from 'lucide-react'
import Sidebar from '@/components/ui/Sidebar'
import ProductCard from '@/components/products/ProductCard'
import ProductTableView from '@/components/products/ProductTableView'
import CategoryBrowser from '@/components/products/CategoryBrowser'
import MeasurementTemplateBulkPicker from '@/components/products/MeasurementTemplateBulkPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'
import { isPriceOnRequest } from '@/lib/product-pricing'
import { applyMeasurementTableAttributes, type MeasurementTemplate } from '@/lib/measurement-templates'

interface ProductListProps {
  initialData: Product[]
  brands: Brand[]
  allBrands?: Brand[] // Complete list of brands for editing
  categories: Category[]
  subcategories: Subcategory[]
  attributeDefinitions?: CatalogAttributeDefinition[]
  activeSubcategoryIds?: string[]
  filterFacets?: ProductFilterFacets
  totalItems: number
  showCategoryBrowser?: boolean
  pagination?: React.ReactNode
}

export default function ProductList({
  initialData,
  brands,
  allBrands = [],
  categories,
  subcategories,
  attributeDefinitions,
  activeSubcategoryIds = [],
  filterFacets,
  totalItems,
  showCategoryBrowser = false,
  pagination,
}: ProductListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const routeKey = searchParams.toString()

  const [products, setProducts] = useState<Product[]>(initialData)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  // Use allBrands if provided, otherwise fallback to filtered brands (though suboptimal for editing)
  const editingBrands = allBrands.length > 0 ? allBrands : brands

  // Selection state
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedSubcategory, setSelectedSubcategory] = useState('')
  const [selectedGender, setSelectedGender] = useState('')
  const [selectedPrice, setSelectedPrice] = useState('')
  const [selectedMeasurementTemplate, setSelectedMeasurementTemplate] = useState<MeasurementTemplate | null>(null)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isNavigationPending, startNavigationTransition] = useTransition()

  // Update local state when initialData changes (e.g. after search/filter)
  useEffect(() => {
    setProducts(initialData)
    setSelectedProductIds([])
  }, [initialData, routeKey])

  // Load view mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('productViewMode') as 'grid' | 'list'
    if (saved === 'grid' || saved === 'list') {
      setViewMode(saved)
    }
  }, [])

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    localStorage.setItem('productViewMode', mode)
  }

  const handleCreate = () => {
    setEditingProduct(null)
    setIsModalOpen(true)
  }

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product)
    setIsModalOpen(true)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Переместить этот товар в корзину?')) return

    try {
      const result = await deleteProductAction(id)
      if (result.success) {
        setProducts(prev => prev.filter(p => p.id !== id))
      } else {
        alert(result.error || 'Ошибка при переносе товара в корзину')
      }
    } catch {
      alert('Ошибка при переносе товара в корзину')
    }
  }, [])

  const handleProductUpdate = useCallback((updatedProduct: Product) => {
    setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p))
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedProductIds(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    )
  }, [])

  const handleNavigation = useCallback((url: string) => {
    setSelectedProductIds([])
    startNavigationTransition(() => {
      router.push(url)
    })
  }, [router])

  const handleCategorySelect = useCallback((categoryId: string) => {
    const params = new URLSearchParams(routeKey)
    params.set('category', categoryId)
    params.delete('page')
    params.delete('subcategory')
    params.delete('attributeKey')
    params.delete('attributeValue')
    handleNavigation(`/admin?${params.toString()}`)
  }, [handleNavigation, routeKey])

  const handleBrandSelect = useCallback((brandId: string) => {
    const params = new URLSearchParams(routeKey)
    params.set('brand', brandId)
    params.delete('page')
    handleNavigation(`/admin?${params.toString()}`)
  }, [handleNavigation, routeKey])

  const hasBulkUpdates = Boolean(
    selectedCategory || selectedSubcategory || selectedGender || selectedPrice.trim() || selectedMeasurementTemplate,
  )

  const handleBulkUpdate = async () => {
    if (!hasBulkUpdates) return

    const hasPriceUpdate = selectedPrice.trim() !== ''
    const price = Number(selectedPrice)
    if (hasPriceUpdate && (!Number.isFinite(price) || price < 0)) {
      alert('Введите корректную цену')
      return
    }
    if (!confirm(`Обновить ${selectedProductIds.length} товаров?`)) return

    setIsBulkUpdating(true)
    const updates: BulkProductUpdates = {}
    if (selectedCategory) updates.category = selectedCategory
    if (selectedSubcategory) updates.subcategory = selectedSubcategory
    if (selectedGender) updates.gender = selectedGender
    if (hasPriceUpdate) updates.price = price
    if (selectedMeasurementTemplate) updates.measurementTemplate = selectedMeasurementTemplate.measurements

    const result = await bulkUpdateProductsAction(selectedProductIds, updates)
    if (!result.success) {
      alert(result.error || 'Не удалось обновить товары')
      setIsBulkUpdating(false)
      return
    }

    setProducts((currentProducts) => currentProducts.map((product) => {
      if (!selectedProductIds.includes(product.id)) return product

      const priceOnRequest = hasPriceUpdate ? isPriceOnRequest(price) : product.price_on_request
      const catalogAttributes = selectedMeasurementTemplate
        ? applyMeasurementTableAttributes(product.catalog_attributes || product.attributes || {}, selectedMeasurementTemplate.measurements)
        : product.catalog_attributes
      return {
        ...product,
        ...(selectedCategory ? { category: selectedCategory } : {}),
        ...(selectedSubcategory ? { subcategory: selectedSubcategory === '__none__' ? '' : selectedSubcategory } : {}),
        ...(selectedGender ? { gender: selectedGender } : {}),
        ...(hasPriceUpdate ? {
          price,
          price_cents: Math.round(price * 100),
          price_on_request: priceOnRequest,
          metadata: {
            ...(product.metadata || {}),
            price_on_request: priceOnRequest,
          },
        } : {}),
        ...(selectedMeasurementTemplate ? {
          catalog_attributes: catalogAttributes,
          attributes: catalogAttributes,
        } : {}),
        expand: {
          ...product.expand,
          ...(selectedCategory ? { category: undefined } : {}),
          ...(selectedSubcategory ? { subcategory: undefined } : {}),
        },
      }
    }))
    setIsBulkUpdating(false)
    setSelectedProductIds([])
    setSelectedSubcategory('')
    setSelectedCategory('')
    setSelectedGender('')
    setSelectedPrice('')
    setSelectedMeasurementTemplate(null)
    router.refresh()
  }

  const handleBulkDelete = async () => {
    if (!confirm(`Переместить ${selectedProductIds.length} товаров в корзину?`)) return

    setIsBulkDeleting(true)
    const result = await bulkDeleteProductsAction(selectedProductIds)
    if (result.success) {
      setProducts((currentProducts) => currentProducts.filter((product) => !selectedProductIds.includes(product.id)))
      setSelectedProductIds([])
    } else {
      alert(result.error || 'Ошибка при переносе товаров в корзину')
    }
    setIsBulkDeleting(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col lg:flex-row font-sans text-slate-200">

      {/* Sidebar Filters */}
      <Sidebar
        brands={brands}
        categories={categories}
        subcategories={subcategories}
        attributeDefinitions={attributeDefinitions}
        activeSubcategoryIds={activeSubcategoryIds}
        filterFacets={filterFacets}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        count={totalItems}
        isNavigationPending={isNavigationPending}
        onNavigate={handleNavigation}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Scrollable Content */}
        <div className={`flex-1 p-6 scroll-smooth ${selectedProductIds.length > 0 ? 'pb-24' : ''}`}>
          <div className="mx-auto max-w-[1600px]">

            {/* Page Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-100">Товары</h2>
                <p className="text-slate-400 text-sm mt-1">Управление каталогом</p>
              </div>

              <div className="flex items-center gap-3">
                {!showCategoryBrowser && (
                  <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-sm shrink-0">
                    <Button
                      type="button"
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => handleViewModeChange('grid')}
                      className={viewMode === 'grid' ? 'h-8 w-8' : 'h-8 w-8 text-slate-400 hover:text-slate-200'}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="icon"
                      onClick={() => handleViewModeChange('list')}
                      className={viewMode === 'list' ? 'h-8 w-8' : 'h-8 w-8 text-slate-400 hover:text-slate-200'}
                    >
                      <List className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={handleCreate}
                  className="shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить</span>
                </Button>
              </div>
            </div>

            {/* Content Display */}
            {isNavigationPending ? (
              <ProductSearchSkeleton viewMode={viewMode} />
            ) : showCategoryBrowser ? (
              <CategoryBrowser
                categories={categories}
                subcategories={subcategories}
                brands={brands}
                filterFacets={filterFacets}
                onCategorySelect={handleCategorySelect}
                onBrandSelect={handleBrandSelect}
              />
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Search className="w-10 h-10 text-slate-600" />
                </div>
                <h3 className="text-lg font-medium text-slate-200">Ничего не найдено</h3>
                <p className="text-slate-500 max-w-xs mx-auto mt-1">Попробуйте изменить параметры поиска или сбросить фильтры в боковой панели.</p>
              </div>
            ) : (
              <>
                {viewMode === 'grid' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          if (selectedProductIds.length === products.length) {
                            setSelectedProductIds([])
                          } else {
                            setSelectedProductIds(products.map(p => p.id))
                          }
                        }}
                        className="h-auto px-0 text-sm font-medium text-slate-400 hover:bg-transparent hover:text-indigo-400"
                      >
                        {selectedProductIds.length === products.length && products.length > 0 ? (
                          <CheckSquare className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                        <span>{selectedProductIds.length === products.length ? 'Снять всё' : 'Выбрать все на странице'}</span>
                      </Button>
                    </div>
                    <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                      {products.map(product => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onUpdate={handleProductUpdate}
                          selected={selectedProductIds.includes(product.id)}
                          onToggleSelect={handleToggleSelect}
                          categories={categories}
                          subcategories={subcategories}
                          variantCount={product.color_variants?.length || 0}
                          variantColors={Array.from(new Set(
                            (product.color_variants || [])
                              .map((variant) => variant.color)
                              .filter((color): color is string => Boolean(color)),
                          ))}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <ProductTableView
                    products={products}
                    selectedIds={selectedProductIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={() => {
                      if (selectedProductIds.length === products.length) {
                        setSelectedProductIds([])
                      } else {
                        setSelectedProductIds(products.map(p => p.id))
                      }
                    }}
                    onUpdateProduct={handleProductUpdate}
                  />
                )}
              </>
            )}

            {/* Pagination injection */}
            {!isNavigationPending && !showCategoryBrowser && pagination}
          </div>
        </div>
      </main>

      {/* Product Form Modal */}
      <ProductForm
        product={editingProduct}
        brands={editingBrands}
        categories={categories}
        subcategories={subcategories}
        attributeDefinitions={attributeDefinitions}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingProduct(null)
        }}
        onSave={handleProductUpdate}
      />

      {/* Bulk Action Toolbar */}
      <div className={`fixed bottom-0 left-0 right-0 z-40 overflow-x-auto border-t border-slate-700 bg-slate-800 px-3 py-2 shadow-2xl shadow-black/40 transition-transform duration-300 lg:left-72 ${selectedProductIds.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="mx-auto flex min-w-max max-w-[1600px] items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
            <Badge>{selectedProductIds.length}</Badge>
            <span>выбрано</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelectedProductIds([])}
              className="h-8 w-8 text-slate-500 hover:text-slate-300"
              aria-label="Снять выделение"
              title="Снять выделение"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="h-7 w-px shrink-0 bg-slate-700" />

          <div className="flex flex-1 items-center justify-end gap-2">
            {/* Gender Select */}
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-500">Пол</span>
              <Select
                value={selectedGender || '__unchanged__'}
                onValueChange={(value) => setSelectedGender(value === '__unchanged__' ? '' : value)}
              >
                <SelectTrigger aria-label="Пол для выбранных товаров" className="h-9 w-36 bg-slate-700 px-2 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unchanged__">Без изменений</SelectItem>
                  <SelectItem value="Для мужчин">Для мужчин</SelectItem>
                  <SelectItem value="Для женщин">Для женщин</SelectItem>
                  <SelectItem value="Унисекс">Унисекс</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Category Select */}
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-500">Кат.</span>
              <Select
                value={selectedCategory || '__unchanged__'}
                onValueChange={(value) => {
                  setSelectedCategory(value === '__unchanged__' ? '' : value)
                  setSelectedSubcategory('') // Reset subcategory when category changes
                }}
              >
                <SelectTrigger aria-label="Категория для выбранных товаров" className="h-9 w-44 bg-slate-700 px-2 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="__unchanged__">Без изменений</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subcategory Select */}
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-500">Подкат.</span>
              <Select
                value={selectedSubcategory || '__unchanged__'}
                onValueChange={(value) => setSelectedSubcategory(value === '__unchanged__' ? '' : value)}
                disabled={!selectedCategory}
              >
                <SelectTrigger aria-label="Подкатегория для выбранных товаров" className="h-9 w-48 bg-slate-700 px-2 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="__unchanged__">Без изменений</SelectItem>
                <SelectItem value="__none__">Без подкатегории (сбросить)</SelectItem>
                {subcategories
                  .filter(s => s.category === selectedCategory)
                  .map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                }
                </SelectContent>
              </Select>
            </div>

            <Input
              type="number"
              value={selectedPrice}
              onChange={(event) => setSelectedPrice(event.target.value)}
              min="0"
              step="1"
              inputMode="decimal"
              aria-label="Цена для выбранных товаров"
              placeholder="Цена, ₽"
              className="h-9 w-28 shrink-0 border-slate-600 bg-slate-700 px-2 text-sm text-slate-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              disabled={isBulkUpdating || isBulkDeleting}
            />

            <MeasurementTemplateBulkPicker
              value={selectedMeasurementTemplate}
              onChange={setSelectedMeasurementTemplate}
              disabled={isBulkUpdating || isBulkDeleting}
            />

            <Button
              type="button"
              onClick={handleBulkUpdate}
              disabled={!hasBulkUpdates || isBulkUpdating || isBulkDeleting}
              className="h-9 shrink-0 whitespace-nowrap px-4"
            >
              {isBulkUpdating ? 'Обновление...' : 'Применить'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={handleBulkDelete}
              disabled={isBulkUpdating || isBulkDeleting}
              className="h-9 w-9 shrink-0"
              aria-label="Переместить выбранные товары в корзину"
              title="В корзину"
            >
              <Trash2 className={`h-4 w-4 ${isBulkDeleting ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProductSearchSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  const items = Array.from({ length: viewMode === 'grid' ? 10 : 7 })

  return (
    <div role="status" aria-live="polite" aria-label="Поиск товаров" className="space-y-4">
      <div className="flex items-center gap-3 px-1 text-sm font-medium text-indigo-300">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        Собираем подходящие товары...
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((_, index) => (
            <div
              key={index}
              className="animate-pulse overflow-hidden rounded-xl border border-slate-700 bg-slate-800"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div className="aspect-[4/3] bg-slate-700/80" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-1/3 rounded-full bg-slate-700" />
                <div className="h-5 w-4/5 rounded-full bg-slate-700" />
                <div className="h-3 w-full rounded-full bg-slate-700/80" />
                <div className="h-3 w-2/3 rounded-full bg-slate-700/80" />
                <div className="h-5 w-2/5 rounded-full bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="grid grid-cols-[48px_96px_1fr_140px] gap-4 border-b border-slate-700 px-4 py-3">
            <div className="h-4 rounded bg-slate-700" />
            <div className="h-4 rounded bg-slate-700" />
            <div className="h-4 w-1/3 rounded bg-slate-700" />
            <div className="h-4 rounded bg-slate-700" />
          </div>
          {items.map((_, index) => (
            <div
              key={index}
              className="grid animate-pulse grid-cols-[48px_96px_1fr_140px] items-center gap-4 border-b border-slate-700/70 px-4 py-3 last:border-b-0"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div className="h-5 w-5 rounded bg-slate-700" />
              <div className="h-16 w-16 rounded-lg bg-slate-700/80" />
              <div className="space-y-2">
                <div className="h-4 w-2/3 rounded-full bg-slate-700" />
                <div className="h-3 w-1/3 rounded-full bg-slate-700/80" />
              </div>
              <div className="h-4 w-20 rounded-full bg-slate-700" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

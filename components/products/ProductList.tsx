'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type Product, type Brand, type Category, type Subcategory } from '@/lib/types'
import { deleteProductAction } from '@/actions/products'
import { bulkUpdateProductsAction, bulkDeleteProductsAction } from '@/actions/bulk-update'
import ProductForm from '@/components/products/ProductForm'
import { LayoutGrid, List, Search, Plus, Menu, X, CheckSquare, Square, LogOut, FileSpreadsheet, BarChart3, Users, RefreshCw } from 'lucide-react'
import Sidebar from '@/components/ui/Sidebar'
import AdminHeader from '@/components/ui/AdminHeader'
import ProductCard from '@/components/products/ProductCard'
import ProductTableView from '@/components/products/ProductTableView'
import Link from 'next/link'
import { logoutAction } from '@/actions/auth'

interface ProductListProps {
  initialData: Product[]
  brands: Brand[]
  allBrands?: Brand[] // Complete list of brands for editing
  categories: Category[]
  subcategories: Subcategory[]
  activeSubcategoryIds?: string[]
  totalItems: number
  pagination?: React.ReactNode
}

export default function ProductList({ initialData, brands, allBrands = [], categories, subcategories, activeSubcategoryIds = [], totalItems, pagination }: ProductListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

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
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  // Update local state when initialData changes (e.g. after search/filter)
  useEffect(() => {
    setProducts(initialData)
  }, [initialData])

  // Auto-select category if all selected products share the same one
  const autoCategory = useMemo(() => {
    if (selectedProductIds.length === 0) return ''
    const selectedProducts = products.filter(p => selectedProductIds.includes(p.id))
    const uniqueCategories = [...new Set(selectedProducts.map(p => p.category).filter(Boolean))]
    return uniqueCategories.length === 1 ? uniqueCategories[0] : ''
  }, [selectedProductIds, products])

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
    if (!confirm('Вы уверены, что хотите удалить этот товар?')) return

    try {
      const result = await deleteProductAction(id)
      if (result.success) {
        setProducts(prev => prev.filter(p => p.id !== id))
      } else {
        alert(result.error || 'Ошибка при удалении товара')
      }
    } catch (error) {
      alert('Ошибка при удалении товара')
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


  return (
    <div className="min-h-screen bg-slate-900 flex flex-col lg:flex-row font-sans text-slate-200">

      {/* Sidebar Filters */}
      <Sidebar
        brands={brands}
        categories={categories}
        subcategories={subcategories}
        activeSubcategoryIds={activeSubcategoryIds}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        count={totalItems}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Scrollable Content */}
        <div className="flex-1 p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto">

            {/* Page Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="text-2xl font-bold text-slate-100">Товары</h2>
                <p className="text-slate-400 text-sm mt-1">Управление каталогом</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-sm shrink-0">
                  <button
                    onClick={() => handleViewModeChange('grid')}
                    className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleViewModeChange('list')}
                    className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={handleCreate}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all active:scale-95 shrink-0 font-medium"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить</span>
                </button>
              </div>
            </div>

            {/* Content Display */}
            {products.length === 0 ? (
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
                      <button
                        onClick={() => {
                          if (selectedProductIds.length === products.length) {
                            setSelectedProductIds([])
                          } else {
                            setSelectedProductIds(products.map(p => p.id))
                          }
                        }}
                        className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-indigo-400 transition-colors"
                      >
                        {selectedProductIds.length === products.length && products.length > 0 ? (
                          <CheckSquare className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                        <span>{selectedProductIds.length === products.length ? 'Снять всё' : 'Выбрать все на странице'}</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
                      {products.map(product => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onUpdate={handleProductUpdate}
                          selected={selectedProductIds.includes(product.id)}
                          onToggleSelect={handleToggleSelect}
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
            {pagination}
          </div>
        </div>
      </main>

      {/* Product Form Modal */}
      <ProductForm
        product={editingProduct}
        brands={editingBrands}
        categories={categories}
        subcategories={subcategories}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingProduct(null)
        }}
        onSave={handleProductUpdate}
      />

      {/* Bulk Action Toolbar */}
      <div className={`fixed bottom-0 left-0 lg:left-72 right-0 bg-slate-800 border-t border-slate-700 p-4 transform transition-transform duration-300 z-40 ${selectedProductIds.length > 0 ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <span className="bg-indigo-600 text-white px-2 py-0.5 rounded text-xs font-bold">{selectedProductIds.length}</span>
            <span>выбрано</span>
            <button
              onClick={() => setSelectedProductIds([])}
              className="text-slate-500 hover:text-slate-300 ml-2"
            >
              Сбросить
            </button>
          </div>

          <div className="flex flex-1 w-full sm:w-auto items-center gap-4 justify-end">
            {/* Gender Select */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-sm text-slate-400 whitespace-nowrap">Гендер:</span>
              <select
                value={selectedGender}
                onChange={(e) => setSelectedGender(e.target.value)}
                className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2"
              >
                <option value="">Без изменений</option>
                <option value="Для мужчин">Для мужчин</option>
                <option value="Для женщин">Для женщин</option>
                <option value="Унисекс">Унисекс</option>
              </select>
            </div>

            {/* Category Select */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-sm text-slate-400 whitespace-nowrap">Категория:</span>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value)
                  setSelectedSubcategory('') // Reset subcategory when category changes
                }}
                className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2"
              >
                <option value="">Выберите категорию...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Subcategory Select */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-sm text-slate-400 whitespace-nowrap">Подкатегория:</span>
              <select
                value={selectedSubcategory}
                onChange={(e) => setSelectedSubcategory(e.target.value)}
                disabled={!selectedCategory}
                className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Без изменений</option>
                <option value="__none__">Без подкатегории (сбросить)</option>
                {subcategories
                  .filter(s => s.category === selectedCategory)
                  .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                }
              </select>
            </div>

            <button
              onClick={async () => {
                if (!selectedCategory && !selectedSubcategory && !selectedGender) return
                if (confirm(`Обновить ${selectedProductIds.length} товаров?`)) {
                  setIsBulkUpdating(true)
                  const updates: any = {}
                  if (selectedCategory) updates.category = selectedCategory
                  if (selectedSubcategory) updates.subcategory = selectedSubcategory
                  if (selectedGender) updates.gender = selectedGender

                  const res = await bulkUpdateProductsAction(selectedProductIds, updates)
                  if (res.success) {
                    setIsBulkUpdating(false)
                    setSelectedProductIds([])
                    setSelectedSubcategory('')
                    setSelectedCategory('')
                    setSelectedGender('')
                    router.refresh()
                  } else {
                    alert('Error updating products')
                    setIsBulkUpdating(false)
                  }
                }
              }}
              disabled={(!selectedCategory && !selectedSubcategory && !selectedGender) || isBulkUpdating || isBulkDeleting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isBulkUpdating ? 'Обновление...' : 'Применить'}
            </button>
            <button
              onClick={async () => {
                if (confirm(`Вы уверены, что хотите удалить ${selectedProductIds.length} товаров? Это действие нельзя отменить.`)) {
                  setIsBulkDeleting(true)
                  const res = await bulkDeleteProductsAction(selectedProductIds)
                  if (res.success) {
                    // Update local state by removing deleted products
                    setProducts(prev => prev.filter(p => !selectedProductIds.includes(p.id)))
                    setIsBulkDeleting(false)
                    setSelectedProductIds([])
                  } else {
                    alert('Ошибка при удалении товаров')
                    setIsBulkDeleting(false)
                  }
                }
              }}
              disabled={isBulkUpdating || isBulkDeleting}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isBulkDeleting ? 'Удаление...' : 'Удалить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

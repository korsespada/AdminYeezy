'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type Product, type Brand, type Category } from '@/lib/types'
import { deleteProductAction, updateProductAction } from '@/actions/products'
import ProductForm from './ProductForm'
import { Plus, Search, LayoutGrid, List, Trash2 } from 'lucide-react'

interface ProductListProps {
  initialData: Product[]
  brands: Brand[]
  categories: Category[]
}

export default function ProductList({ initialData, brands, categories }: ProductListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>(initialData)
  
  // Applied filters (from URL)
  const [appliedSearch, setAppliedSearch] = useState(searchParams.get('search') || '')
  const [appliedBrand, setAppliedBrand] = useState(searchParams.get('brand') || '')
  const [appliedCategory, setAppliedCategory] = useState(searchParams.get('category') || '')
  
  // Local filter state (not yet applied)
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '')
  const [selectedBrand, setSelectedBrand] = useState(searchParams.get('brand') || '')
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '')
  
  const [brandSearchTerm, setBrandSearchTerm] = useState('')
  const [categorySearchTerm, setCategorySearchTerm] = useState('')
  const [showBrandDropdown, setShowBrandDropdown] = useState(false)
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  
  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ productId: string; field: 'name' | 'price' } | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Load view mode from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem('productViewMode')
    if (saved === 'grid' || saved === 'table') {
      setViewMode(saved)
    }
  }, [])

  // Filter brands and categories based on search
  const filteredBrands = brands.filter(brand =>
    brand.name.toLowerCase().includes(brandSearchTerm.toLowerCase())
  )

  const filteredCategories = categories.filter(category =>
    category.name.toLowerCase().includes(categorySearchTerm.toLowerCase())
  )

  // Get selected brand/category name
  const selectedBrandName = brands.find(b => b.id === selectedBrand)?.name || ''
  const selectedCategoryName = categories.find(c => c.id === selectedCategory)?.name || ''

  const handleBrandSelect = (value: string) => {
    setSelectedBrand(value)
    setShowBrandDropdown(false)
    setBrandSearchTerm('')
  }

  const handleCategorySelect = (value: string) => {
    setSelectedCategory(value)
    setShowCategoryDropdown(false)
    setCategorySearchTerm('')
  }

  const applyFilters = () => {
    console.log('Applying filters:', { searchTerm, selectedBrand, selectedCategory })
    
    const params = new URLSearchParams()
    
    if (searchTerm) {
      params.set('search', searchTerm)
    }
    
    if (selectedBrand) {
      params.set('brand', selectedBrand)
    }
    
    if (selectedCategory) {
      params.set('category', selectedCategory)
    }
    
    const url = params.toString() ? `/admin?${params.toString()}` : '/admin'
    console.log('Navigating to:', url)
    
    // Use window.location to force full page reload
    window.location.href = url
  }

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applyFilters()
    }
  }

  const clearFilters = () => {
    setSearchTerm('')
    setSelectedBrand('')
    setSelectedCategory('')
    setBrandSearchTerm('')
    setCategorySearchTerm('')
    window.location.href = '/admin'
  }

  const hasActiveFilters = appliedSearch || appliedBrand || appliedCategory

  const handleViewModeChange = (mode: 'table' | 'grid') => {
    setViewMode(mode)
    localStorage.setItem('productViewMode', mode)
  }

  const handleCreate = () => {
    setEditingProduct(null)
    setIsModalOpen(true)
  }

  const handleEdit = (product: Product) => {
    setEditingProduct(product)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      return
    }

    try {
      const result = await deleteProductAction(id)
      if (result.success) {
        setProducts(products.filter(p => p.id !== id))
        setDeleteConfirm(null)
      }
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  const startEditing = (productId: string, field: 'name' | 'price', currentValue: string | number) => {
    setEditingCell({ productId, field })
    setEditingValue(currentValue.toString())
  }

  const saveInlineEdit = async (productId: string, field: 'name' | 'price', value: string) => {
    const product = products.find(p => p.id === productId)
    if (!product) return

    const newValue = field === 'price' ? parseFloat(value) : value

    if (field === 'price' && (isNaN(newValue as number) || (newValue as number) < 0)) {
      alert('Price must be a positive number')
      setEditingCell(null)
      setEditingValue('')
      return
    }

    if (field === 'name' && !value.trim()) {
      alert('Name cannot be empty')
      setEditingCell(null)
      setEditingValue('')
      return
    }

    const formData = new FormData()
    formData.append('productId', product.productId)
    formData.append('name', field === 'name' ? value.trim() : product.name)
    formData.append('description', product.description || '')
    formData.append('price', field === 'price' ? newValue.toString() : product.price.toString())
    formData.append('status', product.status)
    formData.append('brand', product.brand)
    formData.append('category', product.category)

    if (product.photos && product.photos.length > 0) {
      formData.append('existingPhotos', JSON.stringify(product.photos))
    }

    try {
      const result = await updateProductAction(product.id, formData)
      if (result.success) {
        setProducts(products.map(p => 
          p.id === product.id 
            ? { ...p, [field]: newValue }
            : p
        ))
        setEditingCell(null)
        setEditingValue('')
      } else {
        console.error('Update failed:', result.error)
        alert(result.error || 'Failed to update product')
        setEditingCell(null)
        setEditingValue('')
      }
    } catch (error) {
      console.error('Update error:', error)
      alert('An error occurred while updating')
      setEditingCell(null)
      setEditingValue('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent, productId: string, field: 'name' | 'price') => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      saveInlineEdit(productId, field, editingValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setEditingCell(null)
      setEditingValue('')
    }
  }

  const handleBlur = (productId: string, field: 'name' | 'price') => {
    // Save current values before they change
    const currentValue = editingValue
    const currentCell = editingCell
    
    setTimeout(() => {
      // Only save if we're still editing the same cell
      if (currentCell && currentCell.productId === productId && currentCell.field === field) {
        saveInlineEdit(productId, field, currentValue)
      }
    }, 150)
  }

  const getPhotoUrl = (product: Product) => {
    if (!product.photos || product.photos.length === 0) return null
    
    // photos is an array of full URLs (not PocketBase files)
    let photoUrl = product.photos[0]
    
    // If photos is stored as JSON string, parse it
    if (typeof photoUrl === 'string') {
      // Check if it's a JSON array string
      if (photoUrl.startsWith('[')) {
        try {
          const photosArray = JSON.parse(photoUrl)
          photoUrl = photosArray[0]
        } catch (e) {
          console.error('Failed to parse photos JSON:', e)
        }
      }
      // If it's already a URL, return it
      return photoUrl
    }
    
    return photoUrl
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-4">
        {/* Search and Filters Row */}
        <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Brand Filter */}
          <div className="relative min-w-[180px]">
            <input
              type="text"
              placeholder={selectedBrandName || "All Brands"}
              value={brandSearchTerm}
              onChange={(e) => setBrandSearchTerm(e.target.value)}
              onFocus={() => setShowBrandDropdown(true)}
              onBlur={() => setTimeout(() => setShowBrandDropdown(false), 200)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
            />
            {showBrandDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                <div
                  onClick={() => handleBrandSelect('')}
                  className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm"
                >
                  All Brands
                </div>
                {filteredBrands.map((brand) => (
                  <div
                    key={brand.id}
                    onClick={() => handleBrandSelect(brand.id)}
                    className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm ${
                      selectedBrand === brand.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    {brand.name}
                  </div>
                ))}
                {filteredBrands.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">No brands found</div>
                )}
              </div>
            )}
          </div>

          {/* Category Filter */}
          <div className="relative min-w-[180px]">
            <input
              type="text"
              placeholder={selectedCategoryName || "All Categories"}
              value={categorySearchTerm}
              onChange={(e) => setCategorySearchTerm(e.target.value)}
              onFocus={() => setShowCategoryDropdown(true)}
              onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 200)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
            />
            {showCategoryDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                <div
                  onClick={() => handleCategorySelect('')}
                  className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm"
                >
                  All Categories
                </div>
                {filteredCategories.map((category) => (
                  <div
                    key={category.id}
                    onClick={() => handleCategorySelect(category.id)}
                    className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm ${
                      selectedCategory === category.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    {category.name}
                  </div>
                ))}
                {filteredCategories.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">No categories found</div>
                )}
              </div>
            )}
          </div>

          {/* Search Button */}
          <button
            onClick={applyFilters}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium whitespace-nowrap"
          >
            Поиск
          </button>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Actions Row */}
        <div className="flex items-center justify-between">
          {/* Results Count */}
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing {products.length} products
            {appliedSearch && ` matching "${appliedSearch}"`}
            {appliedBrand && ` in ${brands.find(b => b.id === appliedBrand)?.name}`}
            {appliedCategory && ` in ${categories.find(c => c.id === appliedCategory)?.name}`}
          </div>

          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <button
                onClick={() => handleViewModeChange('table')}
                className={`p-2 ${
                  viewMode === 'table'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                <List size={18} />
              </button>
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-2 ${
                  viewMode === 'grid'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                <LayoutGrid size={18} />
              </button>
            </div>

            {/* Create Button */}
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
            >
              <Plus size={18} />
              <span className="hidden sm:inline">New Product</span>
            </button>
          </div>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Photo
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {products.map((product) => (
                  <tr 
                    key={product.id} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getPhotoUrl(product) ? (
                        <img
                          src={getPhotoUrl(product)!}
                          alt={product.name}
                          className="h-12 w-12 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="h-12 w-12 bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400 text-xs">
                          No image
                        </div>
                      )}
                    </td>
                    <td 
                      className="px-6 py-4 cursor-pointer"
                      onDoubleClick={() => startEditing(product.id, 'name', product.name)}
                    >
                      {editingCell?.productId === product.id && editingCell?.field === 'name' ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => handleBlur(product.id, 'name')}
                          onKeyDown={(e) => handleKeyPress(e, product.id, 'name')}
                          autoFocus
                          className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      ) : (
                        <div className="text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 px-2 py-1 rounded">
                          {product.name}
                          {product.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                              {product.description}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td 
                      className="px-6 py-4 whitespace-nowrap cursor-pointer"
                      onClick={() => handleEdit(product)}
                    >
                      <div className="text-sm text-gray-900 dark:text-white">
                        {product.expand?.category?.name || '-'}
                      </div>
                    </td>
                    <td 
                      className="px-6 py-4 whitespace-nowrap cursor-pointer"
                      onDoubleClick={() => startEditing(product.id, 'price', product.price)}
                    >
                      {editingCell?.productId === product.id && editingCell?.field === 'price' ? (
                        <input
                          type="number"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => handleBlur(product.id, 'price')}
                          onKeyDown={(e) => handleKeyPress(e, product.id, 'price')}
                          autoFocus
                          className="w-24 px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        <div className="text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 px-2 py-1 rounded">
                          {Number(product.price).toLocaleString('ru-RU')}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(product.id)
                          }}
                          className={`${
                            deleteConfirm === product.id
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-400 hover:text-red-600 dark:hover:text-red-400'
                          }`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((product) => (
            <div
              key={product.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
            >
              {/* Image */}
              <div 
                className="aspect-square bg-gray-200 dark:bg-gray-700 cursor-pointer"
                onClick={() => handleEdit(product)}
              >
                {getPhotoUrl(product) ? (
                  <img
                    src={getPhotoUrl(product)!}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    No image
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div 
                    className="flex-1 min-w-0 cursor-pointer"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startEditing(product.id, 'name', product.name)
                    }}
                  >
                    {editingCell?.productId === product.id && editingCell?.field === 'name' ? (
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={() => handleBlur(product.id, 'name')}
                        onKeyDown={(e) => handleKeyPress(e, product.id, 'name')}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="w-full px-2 py-1 text-sm font-medium border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    ) : (
                      <h3 className="font-medium text-gray-900 dark:text-white truncate hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded">
                        {product.name}
                      </h3>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-mono px-2">
                      {product.productId}
                    </p>
                  </div>
                </div>

                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 px-2">
                  <div>{product.expand?.category?.name}</div>
                </div>

                <div 
                  className="cursor-pointer"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startEditing(product.id, 'price', product.price)
                  }}
                >
                  {editingCell?.productId === product.id && editingCell?.field === 'price' ? (
                    <input
                      type="number"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => handleBlur(product.id, 'price')}
                      onKeyDown={(e) => handleKeyPress(e, product.id, 'price')}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="w-full px-2 py-1 text-lg font-bold border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  ) : (
                    <div className="text-lg font-bold text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded">
                      {Number(product.price).toLocaleString('ru-RU')}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(product.id)
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      deleteConfirm === product.id
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20'
                    }`}
                  >
                    {deleteConfirm === product.id ? 'Confirm Delete?' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {products.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg">
          <p className="text-gray-500 dark:text-gray-400">
            {appliedSearch ? `No products found matching "${appliedSearch}"` : 'No products found'}
          </p>
        </div>
      )}

      {/* Product Form Modal */}
      <ProductForm
        product={editingProduct}
        brands={brands}
        categories={categories}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingProduct(null)
        }}
      />
    </div>
  )
}

'use client'

import { useState, useEffect, useTransition } from 'react'
import { type Product, type Brand, type Category, type Subcategory } from '@/lib/types'
import { createProductAction, updateProductAction } from '@/actions/products'
import { X, Upload, Trash2, GripVertical } from 'lucide-react'
import { useRouter } from 'next/navigation'

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
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [existingPhotos, setExistingPhotos] = useState<string[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setProductId(product.productId || '')
        setName(product.name)
        setDescription(product.description || '')
        setPrice(Number(product.price).toString())
        setStatus(product.status)
        setBrand(product.brand)
        setCategory(product.category)
        setSubcategory(product.expand?.subcategory?.id || '')
        setPhotoFiles([])
        setPhotoPreviews([])

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
        setBrand(brands[0]?.id || '')
        setCategory(categories[0]?.id || '')
        setSubcategory('')
        setPhotoFiles([])
        setPhotoPreviews([])
        setExistingPhotos([])
      }
      setError('')
    }
  }, [isOpen, product, brands, categories])

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setPhotoFiles((prev) => [...prev, ...files])

      // Create previews
      files.forEach((file) => {
        const objectUrl = URL.createObjectURL(file)
        setPhotoPreviews((prev) => [...prev, objectUrl])
      })
    }
  }

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index))
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index))
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
    if (!brand) {
      setError('Brand is required')
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
    formData.append('brand', brand)
    formData.append('category', category)
    formData.append('subcategory', subcategory)

    // Add existing photos in new order (as JSON)
    if (existingPhotos.length > 0) {
      formData.append('existingPhotos', JSON.stringify(existingPhotos))
    }

    // Add new photo files
    photoFiles.forEach((file, index) => {
      formData.append(`photo_${index}`, file)
    })

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
              {product ? 'Edit Product' : 'New Product'}
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

            {/* Photos Upload - MOVED TO TOP */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Product Photos
              </label>

              {/* Existing Photos with Drag and Drop */}
              {existingPhotos.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Current photos (drag to reorder):</p>
                  <div className="grid grid-cols-3 gap-2">
                    {existingPhotos.map((url, index) => (
                      <div
                        key={index}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`relative group cursor-move ${draggedIndex === index ? 'opacity-50' : ''
                          }`}
                      >
                        <img
                          src={url}
                          alt={`Photo ${index + 1}`}
                          className="w-full h-24 object-cover rounded-lg border-2 border-gray-300 dark:border-gray-600"
                        />
                        <div className="absolute top-1 left-1 p-1 bg-gray-800/70 text-white rounded">
                          <GripVertical size={14} />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExistingPhoto(index)}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                        <div className="absolute bottom-1 right-1 px-2 py-0.5 bg-gray-800/70 text-white text-xs rounded">
                          {index + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Photos */}
              {photoPreviews.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">New photos to upload:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {photoPreviews.map((url, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={url}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-24 object-cover rounded-lg border border-gray-300 dark:border-gray-600"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Button */}
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 flex flex-col items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors relative group bg-gray-50 dark:bg-gray-900/50">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={isPending}
                />
                <div className="p-4 bg-blue-50 dark:bg-gray-700 text-blue-500 rounded-full mb-3">
                  <Upload size={28} />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    Upload photos
                  </span>{' '}
                  or drag and drop
                </p>
                <p className="text-xs text-gray-400 mt-2">PNG, JPG, GIF up to 5MB each</p>
              </div>
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
                placeholder="e.g. SKU-12345"
                required
                disabled={isPending}
              />
            </div>

            {/* Name */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Product Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="e.g. Chanel Комплект"
                required
                disabled={isPending}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="Product description..."
                disabled={isPending}
              />
            </div>

            {/* Brand */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Brand *
              </label>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                required
                disabled={isPending}
              >
                <option value="">Select brand...</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                required
                disabled={isPending}
              >
                <option value="">Select category...</option>
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
                Subcategory
              </label>
              <select
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                disabled={isPending || !category}
              >
                <option value="">Select subcategory...</option>
                {subcategories
                  .filter((s) => s.category === category)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Price */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Price ($) *
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                placeholder="0.00"
                required
                disabled={isPending}
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 dark:text-white"
                disabled={isPending}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
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
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving...' : product ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

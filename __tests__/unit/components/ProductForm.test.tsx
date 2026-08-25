import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProductForm from '@/components/products/ProductForm'
import { updateProductAction } from '@/actions/products'
import type { Brand, Category, Product } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ''} />,
}))

vi.mock('@/actions/products', () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
}))

vi.mock('@/components/inventory/BrandSelect', () => ({
  default: () => <div data-testid="brand-select" />,
}))

vi.mock('@/components/catalog-attributes/CatalogAttributeFields', () => ({
  default: () => <div data-testid="catalog-attributes" />,
}))

const brand: Brand = {
  id: 'brand-1',
  name: 'Goyard',
  slug: 'goyard',
  description: '',
  created: '',
  updated: '',
  collectionId: 'brands',
  collectionName: 'brands',
}

const category: Category = {
  id: 'category-1',
  name: 'Сумки',
  slug: 'bags',
  description: '',
  created: '',
  updated: '',
  collectionId: 'categories',
  collectionName: 'categories',
}

const product: Product = {
  id: 'product-1',
  productId: 'external-1',
  seo_article: 'GOY-48225',
  name: 'Goyard Jouvence',
  description: 'Описание',
  price: 38000,
  status: 'active',
  brand: brand.id,
  category: category.id,
  subcategory: '',
  photos: [],
  photos_processed: true,
  gender: 'unisex',
  thumb: '',
  created: '',
  updated: '',
  collectionId: 'products',
  collectionName: 'products',
}

describe('ProductForm save shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateProductAction).mockResolvedValue({ success: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, queued: true }), { status: 202 })))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() })
  })

  it('saves with Ctrl+S and closes the editor', async () => {
    const onClose = vi.fn()

    render(
      <ProductForm
        product={product}
        brands={[brand]}
        categories={[category]}
        subcategories={[]}
        isOpen
        onClose={onClose}
      />,
    )

    await screen.findByRole('heading', { name: 'Изменить товар' })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(updateProductAction).toHaveBeenCalledOnce())
    const submittedFormData = vi.mocked(updateProductAction).mock.calls[0][1] as FormData
    expect(submittedFormData.has('canonical_url')).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('also supports Cmd+S', async () => {
    const onClose = vi.fn()

    render(
      <ProductForm
        product={product}
        brands={[brand]}
        categories={[category]}
        subcategories={[]}
        isOpen
        onClose={onClose}
      />,
    )

    await screen.findByRole('heading', { name: 'Изменить товар' })
    fireEvent.keyDown(window, { key: 'S', metaKey: true })

    await waitFor(() => expect(updateProductAction).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits the selected source supplier and album id', async () => {
    render(
      <ProductForm
        product={product}
        brands={[brand]}
        categories={[category]}
        subcategories={[]}
        supplierOptions={[{ id: 'album-1', name: 'CH Одежда', source_id: 'album-1' }]}
        isOpen
        onClose={vi.fn()}
      />,
    )

    const supplierSelect = await screen.findByLabelText('Поставщик')
    fireEvent.change(supplierSelect, { target: { value: 'album-1' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(updateProductAction).toHaveBeenCalledOnce())
    const submittedFormData = vi.mocked(updateProductAction).mock.calls[0][1] as FormData
    expect(submittedFormData.get('supplier_name')).toBe('CH Одежда')
    expect(submittedFormData.get('supplier_source_id')).toBe('album-1')
  })

  it('shows the SEO article as read-only technical data', async () => {
    render(
      <ProductForm
        product={product}
        brands={[brand]}
        categories={[category]}
        subcategories={[]}
        isOpen
        onClose={vi.fn()}
      />,
    )

    const articleInput = await screen.findByLabelText('Артикул')
    expect(articleInput).toHaveValue('GOY-48225')
    expect(articleInput).toHaveAttribute('readonly')
  })

  it('queues selected photo and video files after saving without waiting for S3', async () => {
    const onClose = vi.fn()
    render(
      <ProductForm
        product={product}
        brands={[brand]}
        categories={[category]}
        subcategories={[]}
        isOpen
        onClose={onClose}
      />,
    )

    await screen.findByRole('heading', { name: 'Изменить товар' })
    const fileInputs = document.querySelectorAll('input[type="file"]')
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    const video = new File(['video'], 'video.mp4', { type: 'video/mp4' })
    fireEvent.change(fileInputs[0], { target: { files: [photo] } })
    fireEvent.change(fileInputs[1], { target: { files: [video] } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(updateProductAction).toHaveBeenCalledOnce())
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/admin/products/media-upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    ))
    const uploadFormData = vi.mocked(fetch).mock.calls[0][1]?.body as FormData
    expect(uploadFormData.get('product_id')).toBe(product.id)
    expect(uploadFormData.getAll('photo_file')).toHaveLength(1)
    expect(uploadFormData.get('video_file')).toBe(video)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

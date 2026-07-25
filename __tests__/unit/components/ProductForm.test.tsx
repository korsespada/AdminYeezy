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
})

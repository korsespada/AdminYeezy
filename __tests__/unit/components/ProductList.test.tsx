import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductList from '@/components/products/ProductList'
import type { Product } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ''} />,
}))

vi.mock('@/actions/products', () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
  deleteProductAction: vi.fn(),
  getProductAction: vi.fn(),
}))

vi.mock('@/actions/bulk-update', () => ({
  bulkUpdateProductsAction: vi.fn(),
  bulkDeleteProductsAction: vi.fn(),
}))

// Тест проверяет раскладку сетки товаров, поэтому тяжёлые панели заменены заглушками.
vi.mock('@/components/ui/Sidebar', () => ({ default: () => <aside data-testid="sidebar" /> }))
vi.mock('@/components/products/ProductForm', () => ({ default: () => null }))
vi.mock('@/components/products/VariantFamilyBulkDialog', () => ({ default: () => null }))
vi.mock('@/components/products/MeasurementTemplateBulkPicker', () => ({ default: () => null }))

function buildProduct(index: number): Product {
  return {
    id: `product-${index}`,
    productId: `external-${index}`,
    external_id: `external-${index}`,
    name: `Товар ${index}`,
    description: 'Описание',
    price: 10_000 * index,
    status: 'active',
    brand: 'brand-1',
    category: 'category-1',
    subcategory: '',
    photos: [`https://cdn.example.test/product-${index}.jpg`],
    photos_processed: true,
    gender: 'Унисекс',
    thumb: `https://cdn.example.test/product-${index}.jpg`,
    created: '',
    updated: '',
    collectionId: 'products',
    collectionName: 'products',
  }
}

const products = [1, 2, 3, 4].map(buildProduct)

function renderList() {
  return render(
    <ProductList
      initialData={products}
      brands={[]}
      categories={[]}
      subcategories={[]}
      totalItems={products.length}
    />,
  )
}

/** Сетка карточек и сетка фото отличаются числом колонок — по нему и находим контейнер. */
function gridFor(alt: string, columns: 2 | 4) {
  const image = screen.getByAltText(alt)
  return image.closest(`div[class*="grid-cols-${columns}"]`)
}

describe('ProductList views', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('shows two cards per row on a phone viewport', () => {
    renderList()

    expect(gridFor('Товар 1', 2)).not.toBeNull()
    expect(screen.getByText('Товар 1')).toBeInTheDocument()
  })

  it('shows four square photos per row without captions in the photos view', async () => {
    renderList()

    await userEvent.click(screen.getByRole('button', { name: 'Только фото' }))

    const grid = gridFor('Товар 1', 4)
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-4')
    expect(screen.queryByText('Товар 1')).not.toBeInTheDocument()
    expect(screen.queryByText('10 000 ₽')).not.toBeInTheDocument()
    expect(screen.getByAltText('Товар 1').closest('div')).toHaveClass('aspect-square')
  })

  it('restores the photos view from localStorage', async () => {
    window.localStorage.setItem('productViewMode', 'photos')

    renderList()

    await waitFor(() => expect(gridFor('Товар 1', 4)).not.toBeNull())
    expect(screen.queryByText('Товар 1')).not.toBeInTheDocument()
  })

  it('uses the desktop column slider in the photos view', async () => {
    stubDesktopViewport()
    window.localStorage.setItem('productViewMode', 'photos')

    renderList()

    const grid = await waitFor(() => {
      const found = gridFor('Товар 1', 4)
      expect(found).not.toBeNull()
      return found!
    })
    expect(grid).toHaveClass('lg:grid-cols-4')

    fireEvent.change(screen.getByLabelText('Количество карточек в ряду'), { target: { value: '6' } })

    expect(gridFor('Товар 1', 4)).toHaveClass('lg:grid-cols-6')
    expect(window.localStorage.getItem('productCardColumns')).toBe('6')
  })
})

/** Десктопная ветка раскладки включается только по media-query. */
function stubDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: query === '(min-width: 1024px)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

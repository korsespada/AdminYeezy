import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductCard from '@/components/products/ProductCard'
import type { Product } from '@/lib/types'

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

const product: Product = {
  id: 'product-1',
  productId: 'external-id-hidden-in-grid',
  external_id: 'external-id-hidden-in-grid',
  name: 'Компактная карточка',
  description: 'Описание товара',
  price: 42_000,
  status: 'active',
  brand: 'brand-1',
  category: 'category-1',
  subcategory: '',
  photos: [],
  photos_processed: true,
  gender: 'Унисекс',
  thumb: '',
  created: '',
  updated: '',
  collectionId: 'products',
  collectionName: 'products',
}

describe('ProductCard grid presentation', () => {
  it('does not render the external ID', () => {
    render(
      <ProductCard
        product={product}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Компактная карточка')).toBeInTheDocument()
    expect(screen.queryByText('external-id-hidden-in-grid')).not.toBeInTheDocument()
  })

  it('keeps delete available when duplication is disabled for batch products', () => {
    render(
      <ProductCard
        product={product}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
        allowDuplicate={false}
      />,
    )

    expect(screen.getByTitle('Удалить')).toBeInTheDocument()
    expect(screen.queryByTitle('Дублировать')).not.toBeInTheDocument()
  })

  it('shows the primary photo alt text on hover', () => {
    render(
      <ProductCard
        product={{
          ...product,
          thumb: 'https://cdn.example.test/products/product-1/cover.jpg',
          media: [{
            original_url: 'https://cdn.example.test/products/product-1/cover.jpg',
            alt_text: 'Louis Vuitton кошелёк Victorine, вид спереди',
            sort_order: 0,
            processing_status: 'processed',
          }],
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(screen.getByTitle('Louis Vuitton кошелёк Victorine, вид спереди')).toHaveAttribute('alt', 'Louis Vuitton кошелёк Victorine, вид спереди')
  })

  it('shows a compact, grammatically correct color family badge', () => {
    render(
      <ProductCard
        product={{
          ...product,
          color_variants: [
            { id: 'variant-1', slug: 'white', name: 'Белый', color: 'Белый', price_cents: 4200000, image_url: null, current: true },
            { id: 'variant-2', slug: 'black', name: 'Чёрный', color: 'Чёрный', price_cents: 4200000, image_url: null, current: false },
          ],
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        selected={false}
        onToggleSelect={vi.fn()}
        variantCount={2}
        variantColors={['Белый', 'Чёрный']}
      />,
    )

    expect(screen.getByText('2 варианта')).toBeInTheDocument()
  })
})

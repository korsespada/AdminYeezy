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
})

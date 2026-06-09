import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '@/components/ui/Sidebar'
import type { Brand, Category, ProductFilterFacets, Subcategory } from '@/lib/types'

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMock.push }),
  useSearchParams: () => navigationMock.searchParams,
}))

const brands: Brand[] = [
  {
    id: 'acne-id',
    slug: 'acne-studios',
    name: 'Acne Studios',
    description: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'brands',
  },
  {
    id: 'adidas-id',
    slug: 'adidas',
    name: 'Adidas',
    description: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'brands',
  },
]

const categories: Category[] = [
  {
    id: 'bags-id',
    slug: 'bags',
    name: 'Сумки',
    description: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'categories',
  },
]

const subcategories: Subcategory[] = [
  {
    id: 'totes-id',
    slug: 'totes',
    category: 'bags-id',
    name: 'Шопперы',
    description: '',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'subcategories',
  },
]

const filterFacets: ProductFilterFacets = {
  brandFacets: [{ slug: 'adidas', name: 'Adidas', count: 3 }],
  categoryFacets: [{ slug: 'totes', name: 'Шопперы', count: 3 }],
  subcategoryFacets: [{ slug: 'totes', name: 'Шопперы', count: 3 }],
  genderFacets: [{ value: null, count: 3 }],
}

function renderSidebar() {
  return render(
    <Sidebar
      brands={brands}
      categories={categories}
      subcategories={subcategories}
      activeSubcategoryIds={[]}
      filterFacets={filterFacets}
      isOpen
      onClose={vi.fn()}
      count={3}
    />
  )
}

describe('Sidebar faceted filters', () => {
  beforeEach(() => {
    navigationMock.push.mockReset()
    navigationMock.searchParams = new URLSearchParams()
  })

  it('narrows brands to facet matches for products without gender', () => {
    navigationMock.searchParams = new URLSearchParams('gender=__none__')

    renderSidebar()

    expect(screen.getByText('Adidas')).toBeInTheDocument()
    expect(screen.queryByText('Acne Studios')).not.toBeInTheDocument()
  })

  it('keeps the selected brand visible even when it is absent from facets', () => {
    navigationMock.searchParams = new URLSearchParams('gender=__none__&brand=acne-id')

    renderSidebar()

    expect(screen.getByText('Acne Studios')).toBeInTheDocument()
    expect(screen.getByText('Adidas')).toBeInTheDocument()
  })

  it('resets filters while preserving perPage', () => {
    navigationMock.searchParams = new URLSearchParams('gender=__none__&brand=acne-id&search=bag&page=2&perPage=500')

    renderSidebar()

    fireEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' })[0])

    expect(navigationMock.push).toHaveBeenCalledWith('/admin?perPage=500')
  })
})

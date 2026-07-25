import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import Sidebar from '@/components/ui/Sidebar'
import type { Brand, Category, ProductFilterFacets, Subcategory } from '@/lib/types'
import { CATALOG_ATTRIBUTE_DEFINITIONS } from '@/lib/catalog-attribute-schema'

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
  attributeFacets: {
    colors: [{ value: 'gray', count: 3 }],
  },
}

function renderSidebar() {
  return render(
    <Sidebar
      brands={brands}
      categories={categories}
      subcategories={subcategories}
      activeSubcategoryIds={[]}
      filterFacets={filterFacets}
      attributeDefinitions={CATALOG_ATTRIBUTE_DEFINITIONS.map((definition) => (
        definition.code === 'colors'
          ? {
            ...definition,
            dictionary_values: [{
              id: 'gray',
              attribute_code: 'colors',
              canonical_value: 'Серый',
              aliases: ['gray', 'grey'],
              sort_order: 10,
              active: true,
            }],
          }
          : definition
      ))}
      isOpen
      onClose={vi.fn()}
      count={3}
    />
  )
}

describe('Sidebar faceted filters', () => {
  beforeEach(() => {
    vi.useRealTimers()
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
    navigationMock.searchParams = new URLSearchParams('gender=__none__&brand=acne-id&name=bag&description=leather&priceMin=0&page=2&perPage=500')

    renderSidebar()

    fireEvent.click(screen.getAllByRole('button', { name: 'Сбросить фильтры' })[0])

    expect(navigationMock.push).toHaveBeenCalledWith('/admin?perPage=500')
  })

  it('keeps zero as an active price filter', () => {
    vi.useFakeTimers()
    renderSidebar()

    fireEvent.change(screen.getByLabelText('Цена от'), { target: { value: '0' } })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(navigationMock.push).toHaveBeenCalledWith('/admin?priceMin=0')
  })

  it('runs text search only after clicking the search button', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.type(screen.getByLabelText('Название'), '  leather bag  ')

    expect(navigationMock.push).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Найти' }))

    expect(navigationMock.push).toHaveBeenCalledWith('/admin?name=leather+bag')
  })

  it('runs text search by pressing Enter', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.type(screen.getByLabelText('Название'), 'sneakers{Enter}')

    expect(navigationMock.push).toHaveBeenCalledWith('/admin?name=sneakers')
  })

  it('uses dependent attribute and value selects with dictionary labels', async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole('combobox', { name: 'Атрибут' }))
    await user.click(screen.getByRole('option', { name: 'Цвет' }))
    expect(navigationMock.push).toHaveBeenCalledWith('/admin?attributeKey=colors')

    await user.click(screen.getByRole('combobox', { name: 'Значение атрибута' }))
    await user.click(screen.getByRole('option', { name: 'Серый (3)' }))
    const finalUrl = new URL(navigationMock.push.mock.calls.at(-1)?.[0], 'https://admin.example')
    expect(finalUrl.searchParams.get('attributeKey')).toBe('colors')
    expect(finalUrl.searchParams.get('attributeValue')).toBe('gray')
  })
})

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
  {
    id: 'crossbody-id',
    slug: 'crossbody',
    category: 'bags-id',
    name: 'Кросс-боди',
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
  subcategoryFacets: [
    { slug: 'totes', name: 'Шопперы', count: 3 },
    { slug: 'crossbody', name: 'Кросс-боди', count: 2 },
  ],
  missingCategoryCount: 1,
  missingSubcategoryCount: 1,
  genderFacets: [{ value: null, count: 3 }],
  missingGenderCount: 3,
  attributeFacets: {
    colors: [{ value: 'gray', count: 3 }],
  },
}

function renderSidebar(searchProps: {
  isNavigationPending?: boolean
  onNavigate?: (url: string) => void
} = {}) {
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
              filter_value: 'gray',
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
      {...searchProps}
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

    const resetButtons = screen.getAllByRole('button', { name: 'Сбросить фильтры' })
    expect(resetButtons[0]).toHaveAttribute('title', 'Сбросить фильтры')
    expect(resetButtons[0]).not.toHaveTextContent('Сбросить фильтры')
    fireEvent.click(resetButtons[0])

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

  it('filters products by status', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    await user.click(screen.getByRole('combobox', { name: 'Статус товара' }))
    await user.click(screen.getByRole('option', { name: 'Архивные' }))

    expect(onNavigate).toHaveBeenCalledWith('/admin?status=archived')
  })

  it('filters products without category or subcategory', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()

    renderSidebar({ onNavigate })
    await user.click(screen.getByRole('combobox', { name: 'Категория' }))
    await user.click(screen.getByRole('option', { name: 'Без категории' }))
    expect(onNavigate).toHaveBeenCalledWith('/admin?category=__none__')

    navigationMock.searchParams = new URLSearchParams('category=bags-id')
    renderSidebar({ onNavigate })
    await user.click(screen.getAllByRole('combobox', { name: 'Подкатегория' }).at(-1)!)
    await user.click(screen.getByRole('option', { name: 'Без подкатегории' }))
    expect(onNavigate).toHaveBeenCalledWith('/admin?category=bags-id&subcategory=__none__')
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

  it('delegates search navigation and exposes its pending state', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    await user.type(screen.getByLabelText('Описание'), 'orthopaedic')
    await user.click(screen.getByRole('button', { name: 'Найти' }))

    expect(onNavigate).toHaveBeenCalledWith('/admin?description=orthopaedic')
    expect(navigationMock.push).not.toHaveBeenCalled()

    renderSidebar({ isNavigationPending: true })
    expect(screen.getByRole('button', { name: 'Обновляем товары...' })).toBeDisabled()
  })

  it('delegates subcategory changes through the pending navigation path', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    navigationMock.searchParams = new URLSearchParams('category=bags-id&subcategory=totes-id')
    renderSidebar({ onNavigate })

    await user.click(screen.getByRole('combobox', { name: 'Подкатегория' }))
    await user.click(screen.getByRole('option', { name: 'Кросс-боди' }))

    expect(onNavigate).toHaveBeenCalledWith('/admin?category=bags-id&subcategory=crossbody-id')
    expect(navigationMock.push).not.toHaveBeenCalled()
  })

  it('keeps earlier pending filters during rapid consecutive changes', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate, isNavigationPending: true })

    await user.click(screen.getByRole('checkbox', { name: 'Adidas' }))
    await user.click(screen.getByRole('button', { name: 'Без гендера' }))

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/admin?brand=adidas-id')
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/admin?brand=adidas-id&gender=__none__')
  })

  it('clears category-dependent attribute filters when subcategory changes', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    navigationMock.searchParams = new URLSearchParams(
      'category=bags-id&subcategory=totes-id&attributeKey=colors&attributeValue=gray'
    )
    renderSidebar({ onNavigate })

    await user.click(screen.getByRole('combobox', { name: 'Подкатегория' }))
    await user.click(screen.getByRole('option', { name: 'Кросс-боди' }))

    expect(onNavigate).toHaveBeenCalledWith('/admin?category=bags-id&subcategory=crossbody-id')
  })

  it('clears subcategory and attributes when the parent category is cleared', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    navigationMock.searchParams = new URLSearchParams(
      'category=bags-id&subcategory=totes-id&attributeKey=colors&attributeValue=gray'
    )
    renderSidebar({ onNavigate })

    await user.click(screen.getByRole('combobox', { name: 'Категория' }))
    await user.click(screen.getByRole('option', { name: 'Все категории' }))

    expect(onNavigate).toHaveBeenCalledWith('/admin')
  })

  it('merges both debounced price bounds into one pending filter state', () => {
    vi.useFakeTimers()
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate, isNavigationPending: true })

    fireEvent.change(screen.getByLabelText('Цена от'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('Цена до'), { target: { value: '5000' } })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/admin?priceMin=1000')
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/admin?priceMin=1000&priceMax=5000')
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

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CategoryBrowser from '@/components/products/CategoryBrowser'
import type { Brand, Category, ProductFilterFacets, Subcategory } from '@/lib/types'

const categories = [
  { id: 'shoes', slug: 'shoes', name: 'Обувь' },
  { id: 'bags', slug: 'bags', name: 'Сумки' },
] as Category[]

const subcategories = [
  { id: 'sneakers', slug: 'sneakers', category: 'shoes', name: 'Кроссовки' },
] as Subcategory[]

const brands = Array.from({ length: 15 }, (_, index) => ({
  id: `brand-${index + 1}`,
  slug: `brand-${index + 1}`,
  name: `Бренд ${index + 1}`,
})) as Brand[]

const facets = {
  brandFacets: brands.map((brand, index) => ({ slug: brand.slug!, count: 100 - index })),
  categoryFacets: [],
  subcategoryFacets: [{ slug: 'sneakers', count: 125 }],
  genderFacets: [],
} as ProductFilterFacets

describe('CategoryBrowser', () => {
  it('shows categories instead of products and selects a catalog branch', async () => {
    const onCategorySelect = vi.fn()
    const onBrandSelect = vi.fn()
    render(
      <CategoryBrowser
        categories={categories}
        subcategories={subcategories}
        brands={brands}
        filterFacets={facets}
        onCategorySelect={onCategorySelect}
        onBrandSelect={onBrandSelect}
      />,
    )

    expect(screen.getByText('Товары загрузятся только после выбора категории или применения фильтра.')).toBeInTheDocument()
    expect(screen.getByText('Кроссовки')).toBeInTheDocument()
    expect(screen.getByText('125')).toBeInTheDocument()
    expect(screen.getByText('14 брендов с наибольшим числом товаров')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Бренд/ })).toHaveLength(14)
    expect(screen.queryByRole('button', { name: /Бренд 15/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Обувь/ }))
    expect(onCategorySelect).toHaveBeenCalledWith('shoes')

    await userEvent.click(screen.getByRole('button', { name: /^Бренд 1 100$/ }))
    expect(onBrandSelect).toHaveBeenCalledWith('brand-1')
  })
})

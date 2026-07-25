import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProductSearchSkeleton } from '@/components/products/ProductList'

describe('ProductSearchSkeleton', () => {
  it.each(['grid', 'list'] as const)('announces loading in %s view', (viewMode) => {
    render(<ProductSearchSkeleton viewMode={viewMode} />)

    expect(screen.getByRole('status', { name: 'Поиск товаров' })).toHaveTextContent(
      'Собираем подходящие товары...'
    )
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProductAttributeSummary from '@/components/products/ProductAttributeSummary'
import type { Product } from '@/lib/types'

describe('ProductAttributeSummary', () => {
  it('shows structured sizes, colors, and materials stored on a product', () => {
    render(
      <ProductAttributeSummary
        product={{
          catalog_attributes: {
            sizes: { values: ['S', 'M', 'L'] },
            colors: { filter_display: 'Серый', filter_values: ['gray'] },
            materials: { display_value: 'Кожа' },
          },
        } as unknown as Product}
      />,
    )

    expect(screen.getByTitle('Размеры: S, M, L')).toBeInTheDocument()
    expect(screen.getByTitle('Цвет: Серый')).toBeInTheDocument()
    expect(screen.getByTitle('Материал / состав: Кожа')).toBeInTheDocument()
  })
})

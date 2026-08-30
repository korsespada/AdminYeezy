import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProductSizeRecommendationPreview from '@/components/products/ProductSizeRecommendationPreview'

describe('ProductSizeRecommendationPreview', () => {
  it('renders the height and weight table from a structured recommendation', () => {
    render(
      <ProductSizeRecommendationPreview
        value={{
          columns: [
            { key: 'height', label: 'Рост (см)' },
            { key: 'weight', label: 'Вес (кг)' },
            { key: 'recommended_size', label: 'Рекомендуемый размер' },
          ],
          rows: [{ values: { height: '160-165', weight: '55-60', recommended_size: 'S' } }],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Рекомендации размера на сайте' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '160-165' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '55-60' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'S' })).toBeInTheDocument()
  })

  it('also renders a JSON-encoded recommendation returned by an older product', () => {
    render(
      <ProductSizeRecommendationPreview
        value={JSON.stringify({
          columns: [{ key: 'height', label: 'Рост' }, { key: 'recommended_size', label: 'Размер' }],
          rows: [{ values: { height: '170-175', recommended_size: 'M' } }],
        })}
      />,
    )

    expect(screen.getByRole('cell', { name: '170-175' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'M' })).toBeInTheDocument()
  })
})

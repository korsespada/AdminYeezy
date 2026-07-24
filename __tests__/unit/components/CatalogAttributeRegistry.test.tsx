import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CatalogAttributeRegistry from '@/components/catalog-attributes/CatalogAttributeRegistry'
import { CATALOG_ATTRIBUTE_DEFINITIONS } from '@/lib/catalog-attribute-schema'

vi.mock('@/actions/catalog-attribute-registry', () => ({
  updateCatalogAttributeDefinitionAction: vi.fn(),
  upsertCatalogAttributeDictionaryValueAction: vi.fn(),
}))

describe('CatalogAttributeRegistry', () => {
  it('separates parser examples from editable dictionary values', () => {
    const colors = CATALOG_ATTRIBUTE_DEFINITIONS.find((item) => item.code === 'colors')!
    render(
      <CatalogAttributeRegistry
        initialDefinitions={[{
          ...colors,
          dictionary_values: [{
            id: '1',
            attribute_code: 'colors',
            canonical_value: 'Чёрный',
            aliases: ['черный', 'black', 'noir'],
            sort_order: 10,
            active: true,
          }],
        }]}
      />,
    )

    expect(screen.getByText('Примеры распознавания')).toBeInTheDocument()
    expect(screen.getByText('Цвет: чёрный')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Справочники значений' }))

    expect(screen.getByDisplayValue('Чёрный')).toBeInTheDocument()
    expect(screen.getByDisplayValue('черный, black, noir')).toBeInTheDocument()
    expect(screen.getByText(/Алиасы используются парсером и AI/)).toBeInTheDocument()
  })
})

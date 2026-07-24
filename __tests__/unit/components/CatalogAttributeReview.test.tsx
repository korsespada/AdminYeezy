import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogAttributeReview from '@/components/catalog-attributes/CatalogAttributeReview'
import {
  approveCatalogAttributeSuggestionAction,
  bulkApproveCatalogAttributeSuggestionsAction,
  bulkApproveFilteredCatalogAttributeSuggestionsAction,
  bulkUpdateCatalogAttributeSuggestionValuesAction,
  rejectCatalogAttributeSuggestionAction,
  updateCatalogAttributeSuggestionValueAction,
} from '@/actions/catalog-attributes'
import { getProductAction } from '@/actions/products'
import type { RailsCatalogAttributeSuggestion } from '@/lib/rails-admin'

vi.mock('@/actions/catalog-attributes', () => ({
  approveCatalogAttributeSuggestionAction: vi.fn(),
  bulkApproveCatalogAttributeSuggestionsAction: vi.fn(),
  bulkApproveFilteredCatalogAttributeSuggestionsAction: vi.fn(),
  bulkRejectCatalogAttributeSuggestionsAction: vi.fn(),
  bulkUpdateCatalogAttributeSuggestionValuesAction: vi.fn(),
  rejectCatalogAttributeSuggestionAction: vi.fn(),
  updateCatalogAttributeSuggestionValueAction: vi.fn(),
}))

vi.mock('@/actions/products', () => ({
  getProductAction: vi.fn(),
}))

vi.mock('@/components/products/ProductForm', () => ({
  default: ({ isOpen, product }: { isOpen: boolean; product: { name: string } }) => (
    isOpen ? <div>Карточка товара: {product.name}</div> : null
  ),
}))

const suggestion: RailsCatalogAttributeSuggestion = {
  id: 'suggestion-1',
  attribute_code: 'brand',
  raw_value: 'Hermes',
  normalized_value: { brand_id: 'brand-1', brand_name: 'Hermes' },
  source: 'name',
  evidence: 'Hermes Oran',
  confidence: 0.99,
  status: 'suggested',
  extractor_version: 'test',
  public_filter: false,
  current_value: null,
  product: {
    id: 'product-1',
    slug: 'hermes-oran',
    name: 'Hermes Oran',
    brand: null,
    category: { id: 'category-1', name: 'Тапки', slug: 'obuv-tapki' },
  },
  created_at: '2026-07-16T10:00:00Z',
  updated_at: '2026-07-16T10:00:00Z',
}

const filters = {
  query: '', status: 'suggested', attributeCode: '', brand: '', category: '',
  subcategory: '', perPage: 30,
}

const lookups = { brands: [], categories: [], subcategories: [] }

describe('CatalogAttributeReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the real current brand separately from the proposal', () => {
    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    expect(screen.getByText('Не указан')).toBeInTheDocument()
    expect(screen.getAllByText('Hermes')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Принять' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Отклонить' })).toHaveLength(2)
  })

  it('narrows related filters, removes source and AI review, and keeps bulk actions sticky', () => {
    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={{ ...filters, category: 'bags-id' }}
        brands={[
          { id: 'dior-id', slug: 'dior', name: 'Dior', description: '', created: '', updated: '', collectionId: '', collectionName: 'brands' },
          { id: 'prada-id', slug: 'prada', name: 'Prada', description: '', created: '', updated: '', collectionId: '', collectionName: 'brands' },
        ]}
        categories={[
          { id: 'bags-id', slug: 'bags', name: 'Сумки', description: '', created: '', updated: '', collectionId: '', collectionName: 'categories' },
          { id: 'clothes-id', slug: 'clothes', name: 'Одежда', description: '', created: '', updated: '', collectionId: '', collectionName: 'categories' },
        ]}
        subcategories={[
          { id: 'shoulder-id', slug: 'shoulder', category: 'bags-id', name: 'На плечо', description: '', created: '', updated: '', collectionId: '', collectionName: 'subcategories' },
          { id: 'dresses-id', slug: 'dresses', category: 'clothes-id', name: 'Платья', description: '', created: '', updated: '', collectionId: '', collectionName: 'subcategories' },
        ]}
        lookupFacets={{
          brandFacets: [{ slug: 'dior', count: 2 }],
          categoryFacets: [{ slug: 'bags', count: 2 }],
          subcategoryFacets: [{ slug: 'shoulder', count: 2 }],
          genderFacets: [],
        }}
      />,
    )

    expect(screen.getByRole('option', { name: 'Dior' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Prada' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'На плечо' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Платья' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Габариты' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Посадка' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Все источники' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Проверить AI' })).not.toBeInTheDocument()
    expect(screen.getByText('Выбрать все на странице').closest('.top-\\[60px\\]')).toBeInTheDocument()
  })

  it('shows a selector with unique proposed values for the selected attribute', () => {
    const value = JSON.stringify({ value: 'Kelly 25' })

    render(
      <CatalogAttributeReview
        initialResult={{
          items: [suggestion],
          page: 1,
          perPage: 30,
          totalItems: 1,
          totalPages: 1,
          availableValues: [{ value, label: 'Kelly 25', count: 4 }],
        }}
        filters={{ ...filters, attributeCode: 'model_name' }}
        {...lookups}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Предложенное значение' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Kelly 25 (4)' })).toBeInTheDocument()
  })

  it('shows unknown products without approval actions and opens their product drawer', async () => {
    const unknownSuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'unknown:product-1',
      attribute_code: 'subcategory',
      normalized_value: {},
      raw_value: '',
      source: 'unknown',
      confidence: 0,
    }
    vi.mocked(getProductAction).mockResolvedValue({
      success: true,
      data: { id: 'product-1', name: 'Hermes Oran' },
    })
    const user = userEvent.setup()

    render(
      <CatalogAttributeReview
        initialResult={{
          items: [unknownSuggestion],
          page: 1,
          perPage: 30,
          totalItems: 1,
          totalPages: 1,
          availableValues: [{ value: '__unknown__', label: 'Неизвестно', count: 1 }],
        }}
        filters={{ ...filters, attributeCode: 'subcategory', suggestedValue: '__unknown__' }}
        {...lookups}
      />
    )

    expect(screen.getAllByText('Неизвестно')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Открыть товар Hermes Oran' }))
    expect(await screen.findByText('Карточка товара: Hermes Oran')).toBeInTheDocument()
    expect(getProductAction).toHaveBeenCalledWith('product-1')
  })

  it('changes a subcategory proposal from the selector inside the card', async () => {
    const subcategorySuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'subcategory-suggestion',
      attribute_code: 'subcategory',
      normalized_value: {
        category_id: 'shoulder-id',
        category_name: 'Сумки на плечо',
        category_slug: 'sumki-na-plecho',
      },
    }
    vi.mocked(updateCatalogAttributeSuggestionValueAction).mockResolvedValue({
      success: true,
      data: {
        ...subcategorySuggestion,
        normalized_value: {
          category_id: 'tote-id',
          category_name: 'Сумки-тоут',
          category_slug: 'sumki-tout',
        },
      },
    })
    const user = userEvent.setup()

    render(
      <CatalogAttributeReview
        initialResult={{ items: [subcategorySuggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={{ ...filters, attributeCode: 'subcategory' }}
        brands={[]}
        categories={[]}
        subcategories={[
          {
            id: 'shoulder-id',
            name: 'Сумки на плечо',
            slug: 'sumki-na-plecho',
            category: 'bags-id',
            description: '',
            created: '',
            updated: '',
            collectionId: '',
            collectionName: 'subcategories',
          },
          {
            id: 'tote-id',
            name: 'Сумки-тоут',
            slug: 'sumki-tout',
            category: 'bags-id',
            description: '',
            created: '',
            updated: '',
            collectionId: '',
            collectionName: 'subcategories',
          },
        ]}
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Выбрать подкатегорию' }), 'tote-id')
    expect(updateCatalogAttributeSuggestionValueAction).toHaveBeenCalledWith('subcategory-suggestion', 'tote-id')
  })

  it('removes an approved item from the suggested queue', async () => {
    vi.mocked(approveCatalogAttributeSuggestionAction).mockResolvedValue({
      success: true,
      data: { ...suggestion, status: 'approved' },
    })
    const user = userEvent.setup()
    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Принять' }))

    await waitFor(() => expect(screen.getByText('Предложений не найдено')).toBeInTheDocument())
    expect(approveCatalogAttributeSuggestionAction).toHaveBeenCalledWith('suggestion-1')
    expect(rejectCatalogAttributeSuggestionAction).not.toHaveBeenCalled()
  })

  it('bulk approves selected suggestions', async () => {
    vi.mocked(bulkApproveCatalogAttributeSuggestionsAction).mockResolvedValue({
      success: true,
      data: { reviewed_ids: ['suggestion-1'], status: 'approved' },
    })
    const user = userEvent.setup()
    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: /Выбрать все на странице/ }))
    await user.click(screen.getByRole('button', { name: 'Принять выбранные' }))

    await waitFor(() => expect(screen.getByText('Предложений не найдено')).toBeInTheDocument())
    expect(bulkApproveCatalogAttributeSuggestionsAction).toHaveBeenCalledWith(['suggestion-1'])
  })

  it('changes the value for every selected suggestion from the common selector', async () => {
    const secondSuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'suggestion-2',
      product: { ...suggestion.product, id: 'product-2', slug: 'hermes-oran-2' },
    }
    const updatedSuggestions = [suggestion, secondSuggestion].map((item) => ({
      ...item,
      normalized_value: { brand_id: 'brand-2', brand_name: 'Chanel' },
    }))
    vi.mocked(bulkUpdateCatalogAttributeSuggestionValuesAction).mockResolvedValue({
      success: true,
      data: updatedSuggestions,
    })
    const user = userEvent.setup()

    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion, secondSuggestion], page: 1, perPage: 30, totalItems: 2, totalPages: 1 }}
        filters={filters}
        brands={[
          { id: 'brand-1', slug: 'hermes', name: 'Hermes', description: '', created: '', updated: '', collectionId: '', collectionName: 'brands' },
          { id: 'brand-2', slug: 'chanel', name: 'Chanel', description: '', created: '', updated: '', collectionId: '', collectionName: 'brands' },
        ]}
        categories={[]}
        subcategories={[]}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: /Выбрать все на странице/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Общее значение для выбранных' }), 'brand-2')

    await waitFor(() => expect(screen.getByText('Изменено значений: 2')).toBeInTheDocument())
    expect(bulkUpdateCatalogAttributeSuggestionValuesAction).toHaveBeenCalledWith(
      ['suggestion-1', 'suggestion-2'],
      'brand-2',
    )
  })

  it('approves every suggestion matching current filters after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(bulkApproveFilteredCatalogAttributeSuggestionsAction).mockResolvedValue({
      success: true,
      data: { approved_count: 1, status: 'approved' },
    })
    const user = userEvent.setup()
    render(
      <CatalogAttributeReview
        initialResult={{ items: [suggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={{ ...filters, attributeCode: 'brand' }}
        {...lookups}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Принять всё по фильтрам (1)' }))

    await waitFor(() => expect(screen.getByText('Подтверждено по текущим фильтрам: 1')).toBeInTheDocument())
    expect(bulkApproveFilteredCatalogAttributeSuggestionsAction).toHaveBeenCalledWith({
      query: '',
      attributeCode: 'brand',
      brand: '',
      category: '',
      subcategory: '',
    })
  })

  it('renders normalized sizes as readable values instead of JSON', () => {
    const sizeSuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'suggestion-sizes',
      attribute_code: 'sizes',
      raw_value: '48-56',
      normalized_value: {
        groups: [{ min: 48, max: 56, system: 'numeric', audience: 'male' }],
        values: [],
      },
    }

    render(
      <CatalogAttributeReview
        initialResult={{ items: [sizeSuggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    expect(screen.getByText('48–56 · мужские')).toBeInTheDocument()
    expect(screen.queryByText(/"groups"/)).not.toBeInTheDocument()
  })

  it('shows a branded color and its simple catalog color together', () => {
    const colorSuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'suggestion-color',
      attribute_code: 'colors',
      public_filter: true,
      normalized_value: {
        names: ['N5/Cassis'],
        families: ['purple'],
        display_value: 'N5/Cassis',
        filter_display: 'Фиолетовый',
      },
    }

    render(
      <CatalogAttributeReview
        initialResult={{ items: [colorSuggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    expect(screen.getByText('N5/Cassis → Фиолетовый')).toBeInTheDocument()
    expect(screen.getByText('Фильтр каталога')).toBeInTheDocument()
  })

  it('formats dimensions without redundant zeroes and localizes centimeters', () => {
    const dimensionsSuggestion: RailsCatalogAttributeSuggestion = {
      ...suggestion,
      id: 'suggestion-dimensions',
      attribute_code: 'dimensions',
      normalized_value: {
        width: 34.0,
        height: 24.0,
        depth: 11.5,
        unit: 'cm',
        display_value: '34.0 × 24.0 × 11.5 cm',
      },
    }

    render(
      <CatalogAttributeReview
        initialResult={{ items: [dimensionsSuggestion], page: 1, perPage: 30, totalItems: 1, totalPages: 1 }}
        filters={filters}
        {...lookups}
      />
    )

    expect(screen.getByText('34 × 24 × 11,5 см')).toBeInTheDocument()
  })
})

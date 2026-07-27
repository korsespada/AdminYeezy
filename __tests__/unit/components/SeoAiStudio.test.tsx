import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SeoAiStudio from '@/components/seo-ai/SeoAiStudio'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'
import type { SeoAiGeneration } from '@/lib/types'

vi.mock('@/actions/seo-ai', () => ({
  applySeoAiDraftAction: vi.fn(),
  createSeoAiBatchAction: vi.fn(),
  createSeoAiSuggestedSubcategoryAction: vi.fn(),
  deleteSeoAiDraftAction: vi.fn(),
  listSeoAiDraftsAction: vi.fn(),
  listSeoAiBatchesAction: vi.fn(),
  rejectSeoAiDraftAction: vi.fn(),
  renameSeoAiBatchAction: vi.fn(),
  retrySeoAiGenerationAction: vi.fn(),
  runSeoAiGenerationAction: vi.fn(),
  searchSeoAiProductsAction: vi.fn(),
  updateSeoAiSettingsAction: vi.fn(),
  updateSeoAiBatchStateAction: vi.fn(),
}))

const colorDefinition: CatalogAttributeDefinition = {
  code: 'colors',
  label: 'Цвет',
  category_scope: 'Все категории',
  value_type: 'multi_enum',
  show_as_characteristic: true,
  use_as_filter: true,
  use_as_variant_dimension: false,
  parser_rules: [],
  aliases: [],
  dictionary_values: [{
    id: 'pink',
    attribute_code: 'colors',
    filter_value: 'pink',
    canonical_value: 'Розовый',
    aliases: [],
    sort_order: 10,
    active: true,
  }],
  sort_order: 10,
  active: true,
}

function draft(id: string): SeoAiGeneration {
  return {
    id,
    target_type: 'Product',
    target_id: id,
    target_label: 'Chanel Серьги',
    draft_type: 'product',
    status: 'draft',
    input_snapshot: {
      product: { name: 'Chanel Серьги', slug: 'chanel-earrings', catalog_attributes: { colors: { normalized_value: { value: 'pink' } } } },
      images: [{ preview_url: 'https://static.yeezyunique.ru/test.webp' }],
      catalog: { current_taxonomy: { top_level: { name: 'Бижутерия' }, assigned: { name: 'Серьги' } } },
    },
    text_result: {},
    vision_result: {},
    output: {
      suggested_name: 'Серьги-пусеты с розовой вставкой',
      catalog_attributes: { colors: ['pink'] },
      subcategory_suggestion: { kind: 'existing', name: 'Серьги', confidence: 0.99, evidence: 'Форма соответствует серьгам-пусетам.' },
    },
    prompt_snapshot: {},
    model_snapshot: {},
    created_at: '2026-07-27T10:00:00Z',
    updated_at: '2026-07-27T10:01:00Z',
  }
}

describe('SeoAiStudio queue', () => {
  it('keeps a large queue compact and shows human-readable product data on demand', async () => {
    const user = userEvent.setup()
    render(
      <SeoAiStudio
        initialSettings={[]}
        initialDrafts={[draft('1'), draft('2'), draft('3'), draft('4')]}
        initialBatches={[]}
        brands={[]}
        categories={[]}
        subcategories={[]}
        attributeDefinitions={[colorDefinition]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Очередь и сравнение' }))
    expect(screen.queryByText('Цвет')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /Chanel Серьги/ })[0])

    expect(screen.getByText('Цвет')).toBeInTheDocument()
    expect(screen.getAllByText('Розовый')).toHaveLength(2)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('Подкатегория: Серьги')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Оригинальная карточка' })[0]).toHaveAttribute('href', 'https://yeezyunique.ru/product/chanel-earrings')
  })
})

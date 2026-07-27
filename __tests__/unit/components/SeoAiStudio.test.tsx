import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SeoAiStudio from '@/components/seo-ai/SeoAiStudio'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-schema'
import type { SeoAiBatch, SeoAiGeneration } from '@/lib/types'

vi.mock('@/actions/seo-ai', () => ({
  applySeoAiDraftAction: vi.fn(),
  createSeoAiBatchAction: vi.fn(),
  createSeoAiSuggestedSubcategoryAction: vi.fn(),
  deleteSeoAiDraftAction: vi.fn(),
  listSeoAiDraftsAction: vi.fn(),
  listSeoAiBatchesAction: vi.fn(),
  rejectSeoAiDraftAction: vi.fn(),
  renameSeoAiBatchAction: vi.fn(),
  reviewSeoAiBatchAction: vi.fn(),
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

const metalDefinition: CatalogAttributeDefinition = {
  ...colorDefinition,
  code: 'jewelry_metal',
  label: 'Ювелирный металл',
  dictionary_values: [{
    ...colorDefinition.dictionary_values![0],
    id: 'silver',
    attribute_code: 'jewelry_metal',
    filter_value: 'silver',
    canonical_value: 'Серебро',
  }],
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
      catalog_attributes: { colors: ['pink'], jewelry_metal: { family: 'silver', purity: '925', filter_value: 'silver', display_value: 'Серебро' } },
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
        attributeDefinitions={[colorDefinition, metalDefinition]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Очередь и сравнение' }))
    expect(screen.queryByText('Цвет')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /Chanel Серьги/ })[0])

    expect(screen.getByText('Цвет')).toBeInTheDocument()
    expect(screen.getAllByText('Розовый')).toHaveLength(2)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('Серебро, 925')).toBeInTheDocument()
    expect(screen.getByText('Подкатегория: Серьги')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Оригинальная карточка' })[0]).toHaveAttribute('href', 'https://yeezyunique.ru/product/chanel-earrings')
  })

  it('groups batch drafts in a renameable folder with bulk review actions', async () => {
    const user = userEvent.setup()
    const ready = { ...draft('ready'), batch_id: 'batch-1' }
    const rejected = { ...draft('rejected'), batch_id: 'batch-1', status: 'rejected' as const }
    const batch: SeoAiBatch = {
      id: 'batch-1',
      name: 'Обувь за июль',
      target_type: 'Product',
      status: 'completed',
      ids: [],
      missing_seo_only: false,
      include_images: true,
      item_limit: 2,
      total_count: 2,
      success_count: 1,
      failure_count: 0,
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:02:00Z',
    }

    render(
      <SeoAiStudio
        initialSettings={[]}
        initialDrafts={[ready, rejected]}
        initialBatches={[batch]}
        brands={[]}
        categories={[]}
        subcategories={[]}
        attributeDefinitions={[colorDefinition, metalDefinition]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Очередь и сравнение' }))
    expect(screen.getByText('Обувь за июль')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Применить готовые' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отклонить готовые' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вернуть отклонённые' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Переименовать выгрузку' })).toBeInTheDocument()
  })
})

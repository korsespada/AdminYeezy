import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHROMOFF_AI_SETTINGS,
  buildChromoffAiUserPrompt,
  hydrateChromoffAiSettings,
  normalizeChromoffAiOutput,
  promptRulesForChromoffCategory,
} from '@/lib/chromoff-ai'

describe('Chromoff AI SEO helpers', () => {
  it('defaults to BYESU Gemini 3.7 Flash and clamps runtime settings', () => {
    expect(DEFAULT_CHROMOFF_AI_SETTINGS.provider).toBe('byesu')
    expect(DEFAULT_CHROMOFF_AI_SETTINGS.byesuModel).toBe('gemini-3.7-flash')

    expect(hydrateChromoffAiSettings({
      provider: 'unknown',
      temperature: 9,
      maxTokens: 100,
      concurrency: 50,
    })).toMatchObject({
      provider: 'byesu',
      temperature: 2,
      maxTokens: 1000,
      concurrency: 10,
    })
  })

  it('combines root and exact subcategory prompts without classification', () => {
    const rules = [
      { id: 'root', categoryId: 'root-id', title: 'Обувь', prompt: 'Общий промпт обуви' },
      { id: 'child', categoryId: 'child-id', title: 'Кеды', prompt: 'Промпт кед' },
      { id: 'other', categoryId: 'other-id', title: 'Сумки', prompt: 'Промпт сумок' },
    ]

    expect(promptRulesForChromoffCategory(rules, 'child-id', 'root-id')).toEqual([
      'Общий промпт обуви',
      'Промпт кед',
    ])
  })

  it('builds a photo-first prompt with immutable catalog identity fields', () => {
    const prompt = buildChromoffAiUserPrompt({
      name: 'Кеды Low',
      description: 'Кожаная модель',
      brand: { name: 'Chrome Hearts' },
      price_cents: 12500000,
      gender: 'unisex',
      catalog_attributes: { materials: ['Кожа'] },
      chromoff_category: { id: 'child', parent_id: 'root', name: 'Кеды', slug: 'kedy' },
    }, ['Сделай описание спокойным'])

    expect(prompt).toContain('Кеды Low')
    expect(prompt).toContain('Кожаная модель')
    expect(prompt).toContain('Сделай описание спокойным')
    expect(prompt.toLowerCase()).toContain('не изменяй категорию, подкатегорию, бренд, гендер и цену')
    expect(prompt).toContain('contact sheet 3×3')
  })

  it('normalizes only allowed AI fields and derives Chromoff SEO deterministically', () => {
    const result = normalizeChromoffAiOutput({
      name: 'Кеды Low с серебряными крестами',
      description: 'Подробное описание товара.',
      chromoff_h1: 'Chrome Hearts Кеды Low с серебряными крестами',
      chromoff_seo_description: 'Уникальное описание Chromoff.',
      attributes: { materials: ['Кожа'], color: 'Чёрный' },
      alts: ['Кеды Chrome Hearts, вид сбоку'],
      price: 1,
      brand: 'Другая марка',
      gender: 'female',
      category: 'Сумки',
      subcategory: 'Клатчи',
    }, {
      name: 'Старое название',
      description: 'Старое описание',
      brand: { name: 'Chrome Hearts' },
      price_cents: 12500000,
      gender: 'unisex',
      catalog_attributes: { sizes: ['40', '41'] },
      images: ['1.jpg', '2.jpg'],
    })

    expect(result).toEqual({
      name: 'Кеды Low с серебряными крестами',
      description: 'Подробное описание товара.',
      h1: 'Chrome Hearts Кеды Low с серебряными крестами',
      seoDescription: 'Уникальное описание Chromoff.',
      attributes: { sizes: ['40', '41'], materials: ['Кожа'], color: 'Чёрный' },
      alts: [
        'Кеды Chrome Hearts, вид сбоку',
        'Chrome Hearts Кеды Low с серебряными крестами, фото 2',
      ],
    })
    expect(result).not.toHaveProperty('price')
    expect(result).not.toHaveProperty('brand')
    expect(result).not.toHaveProperty('gender')
    expect(result).not.toHaveProperty('category')
    expect(result).not.toHaveProperty('subcategory')
  })

  it('keeps existing characteristics but filters and canonicalizes generated ones', () => {
    const result = normalizeChromoffAiOutput({
      attributes: { materials: ['leather'], unknown_code: 'discard me' },
    }, {
      name: 'Кеды Low',
      catalog_attributes: { sizes: ['40'] },
      images: [],
    }, [{
      code: 'materials',
      dictionary_values: [{ canonical_value: 'Кожа', filter_value: 'leather', aliases: ['натуральная кожа'] }],
    }])

    expect(result.attributes).toEqual({ sizes: ['40'], materials: ['Кожа'] })
  })
})

import { describe, expect, it } from 'vitest'
import {
  PRODUCT_CARD_AI_SYSTEM_PROMPT,
  buildProductCardAiPrompt,
  normalizeProductCardAiOutput,
} from '@/lib/product-card-ai'
import { HERMES_CARD_PROMPT_DEFAULT, composeCardSystemPrompt, defaultCardPromptForPreset } from '@/lib/product-card-prompts'
import type { CardUpdateRecord } from '@/lib/product-card-updates'

/**
 * Промпт и разбор ответа ИИ по карточке поставщика. Сетевых вызовов здесь нет:
 * проверяем, что в запрос уходят подтверждённые факты, а ответ приводится
 * к числу фотографий товара.
 */

const row = {
  id: 1,
  supplier_id: 'supplier-uuid',
  crm_product_id: 'product-uuid',
  crm_slug: 'hermes-lindy-26-her-10993',
  category: 'Сумки на плечо',
  category_slug: 'sumki-na-plecho',
  kind: 'bag',
  status: 'pending',
  current_name: 'Lindy 26',
  current_slug: 'hermes-lindy-26-her-10993',
  current_description: `Стиль: Lindy

Цвет: 18/etoupe

Материал: Clemence

Размер: 26*18*12cm

Описание: Сумка Lindy 26, цвет "слоновая кость", с золотой фурнитурой.`,
  current_attributes: {},
  current_media: [
    { original_url: 'https://static.yeezyunique.ru/products/a/img_0.webp' },
    { original_url: 'https://static.yeezyunique.ru/products/a/img_1.webp' },
  ],
  proposed_name: 'Lindy 26 18/Etoupe',
  proposed_slug: 'hermes-lindy-26-18-etoupe-gold-clemence-her-10993',
  proposed_description: 'Сумка Lindy 26 18/Etoupe.',
  proposed_attributes: {},
  proposed_photo_alts: [],
  attribute_patch: {},
  warnings: [],
  model_name: 'Lindy',
  size_token: '26',
  ai_status: 'pending',
  ai_model: null,
  ai_error: null,
  error: null,
  decided_at: null,
  applied_at: null,
  created_at: '',
  updated_at: '',
} as unknown as CardUpdateRecord

describe('buildProductCardAiPrompt', () => {
  it('передаёт подтверждённые факты карточки и число листов фотографий', () => {
    const prompt = buildProductCardAiPrompt(row)
    expect(prompt).toContain('Модель: Lindy')
    expect(prompt).toContain('Цвет Hermes: 18/Etoupe')
    expect(prompt).toContain('Материал: Clemence')
    expect(prompt).toContain('Фурнитура: золото (из текста)')
    expect(prompt).toContain('Размер из описания: 26*18*12cm')
    expect(prompt).toContain('Фотографий у товара: 2')
    expect(prompt).toContain('Стиль: Lindy')
  })

  it('требует бренд в каждом альте и запрещает рекламу', () => {
    expect(PRODUCT_CARD_AI_SYSTEM_PROMPT).toContain('Бренд Hermes обязателен в каждом альте')
    expect(PRODUCT_CARD_AI_SYSTEM_PROMPT).toContain('без китайских иероглифов')
    expect(PRODUCT_CARD_AI_SYSTEM_PROMPT).toContain('900–1800')
    expect(PRODUCT_CARD_AI_SYSTEM_PROMPT).toContain('Про упаковку, коробку, пыльник и бутиковый сет не пиши вообще')
    expect(PRODUCT_CARD_AI_SYSTEM_PROMPT).toContain('materials: массив подтверждённых материалов')
  })

  it('передаёт перевод цвета, если он был в исходнике', () => {
    const withGloss = buildProductCardAiPrompt({
      ...row,
      current_description: 'Стиль: CHYPRE SANDAL Цвет: Черный (ck89/noir) Материал: Замша Размер: 34-42',
      kind: 'shoe',
    })
    expect(withGloss).toContain('Цвет Hermes: ck89/Noir (по-русски: Черный).')
  })
})

describe('промпт поставщика', () => {
  it('для Hermes есть подсказка по умолчанию, для остальных — пусто', () => {
    expect(defaultCardPromptForPreset('hermes')).toBe(HERMES_CARD_PROMPT_DEFAULT)
    expect(defaultCardPromptForPreset('unknown')).toBe('')
    expect(HERMES_CARD_PROMPT_DEFAULT).toContain('18/Etoupe')
    expect(HERMES_CARD_PROMPT_DEFAULT).toContain('34–41')
  })

  it('собирает системный промпт из базы, инструкции поставщика и правил каталога', () => {
    const prompt = composeCardSystemPrompt({
      base: 'БАЗА',
      supplierPrompt: '  ИНСТРУКЦИЯ HERMES  ',
      catalogRules: 'ПРАВИЛА КАТАЛОГА',
    })
    expect(prompt).toBe('БАЗА\n\nИнструкция поставщика:\nИНСТРУКЦИЯ HERMES\n\nПРАВИЛА КАТАЛОГА')
    expect(composeCardSystemPrompt({ base: 'БАЗА', supplierPrompt: '', catalogRules: '' })).toBe('БАЗА')
  })
})

describe('normalizeProductCardAiOutput', () => {
  it('приводит альты к числу фотографий и чистит описание', () => {
    const result = normalizeProductCardAiOutput({
      description: '  Сумка   Lindy 26.\n\n\n\nМатериал — Clemence.  ',
      photo_alts: ['Первый альт', ''],
    }, 3, 'Lindy 26 18/Etoupe')

    expect(result.description).toBe('Сумка Lindy 26.\n\nМатериал — Clemence.')
    expect(result.photoAlts).toEqual(['Первый альт', 'Lindy 26 18/Etoupe', 'Lindy 26 18/Etoupe'])
  })

  it('обрезает слишком длинный альт до 160 знаков', () => {
    const long = 'Hermes Lindy 26 '.repeat(20)
    const result = normalizeProductCardAiOutput({ description: 'Текст', photo_alts: [long] }, 1, 'Lindy')
    expect(result.photoAlts[0].length).toBeLessThanOrEqual(160)
  })

  it('переживает пустой ответ модели', () => {
    const result = normalizeProductCardAiOutput(null, 1, 'Lindy 26')
    expect(result.description).toBe('')
    expect(result.photoAlts).toEqual(['Lindy 26'])
  })
})

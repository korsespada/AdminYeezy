import { describe, expect, it } from 'vitest'
import {
  buildExportsV2GroupingPrompts,
  buildExportsV2ProductPrompts,
  compactExportsV2Examples,
  exportsV2CacheHash,
} from '@/lib/exports-v2-ai'

describe('exports v2 AI helpers', () => {
  it('uses a deterministic cache key and invalidates it when settings change', () => {
    const base = { model: 'test/model', prompt: 'v1', text: 'same', price: 19000 }
    expect(exportsV2CacheHash(base)).toBe(exportsV2CacheHash({ ...base }))
    expect(exportsV2CacheHash(base)).not.toBe(exportsV2CacheHash({ ...base, price: 21000 }))
  })

  it('keeps the supplier script as a text hint and requests ordered JSON groups', () => {
    const prompts = buildExportsV2GroupingPrompts({
      albums: [{ external_id: 'a-1', source_order: 7, media_count: 9, photo_count: 9, description: 'товар' }],
      examples: [],
      scriptDescription: 'После основного альбома идёт таблица размеров',
    })
    expect(prompts.userPrompt).toContain('После основного альбома идёт таблица размеров')
    expect(prompts.systemPrompt).toContain('Сохраняй порядок album_ids')
    expect(prompts.systemPrompt).toContain('PRIMARY_MEDIA')
  })

  it('only exposes requested product attributes to the product prompt', () => {
    const prompts = buildExportsV2ProductPrompts({
      globalRules: '',
      supplierInstructions: 'Футболки стоят 19000',
      supplierDefaults: { default_price: 19000 },
      attributeHints: [{ code: 'clothing_sizes', label: 'Размеры одежды' }],
      lookups: { brands: [], categories: [], subcategories: [] },
      sources: [],
    })
    expect(prompts.userPrompt).toContain('clothing_sizes')
    expect(prompts.userPrompt).toContain('Футболки стоят 19000')
    expect(prompts.systemPrompt).toContain('Цена определяется инструкциями поставщика')
  })

  it('limits examples passed to the model to ten', () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({ example: { albums: [{ external_id: String(index) }] } }))
    expect(compactExportsV2Examples(rows)).toHaveLength(10)
  })
})

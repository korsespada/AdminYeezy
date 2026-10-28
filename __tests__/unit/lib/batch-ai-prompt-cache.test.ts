import { describe, expect, it, vi } from 'vitest'
import {
  BATCH_AI_PRODUCT_SECTION,
  batchAiContactSheetSourceUrl,
  buildBatchAiColorSplitPrompt,
  buildBatchAiRequestContent,
  buildBatchAiUserPrompt,
  splitBatchAiPrompt,
  withBatchAiPromptCacheFallback,
} from '@/lib/batch-ai'

const lookups = {
  brands: [{ id: 'b1', name: 'Prada' }],
  categories: [{ id: 'c1', name: 'Сумки' }],
  subcategories: [{ id: 's1', name: 'Тоут', parent_id: 'c1' }],
  attributes: [],
}

describe('batch AI prompt cache', () => {
  it('keeps the shared prompt identical for different products of one run', () => {
    const first = splitBatchAiPrompt(buildBatchAiUserPrompt({ ...lookups, product: { external_id: 'p1', name: 'Сумка', description: 'Кожа' } }))
    const second = splitBatchAiPrompt(buildBatchAiUserPrompt({ ...lookups, product: { external_id: 'p2', name: 'Тоут', description: 'Замша' } }))

    expect(first.shared).toBeTruthy()
    expect(first.shared).toBe(second.shared)
    expect(first.shared).toContain('Бренды: ')
    expect(first.shared).not.toContain('p1')
    expect(first.product.startsWith(BATCH_AI_PRODUCT_SECTION)).toBe(true)
    expect(first.product).toContain('Товар: ')
  })

  it('splits the colour split prompt the same way', () => {
    const prompt = buildBatchAiColorSplitPrompt({ ...lookups, product: { external_id: 'p1' }, videoPreviewAvailable: true })
    const { shared, product } = splitBatchAiPrompt(prompt)

    expect(shared).toContain('Бренды: ')
    expect(product).toContain('Исходный товар: ')
    expect(product).toContain('кадр-превью исходного видео')
  })

  it('sends shared parts first and marks the last of them for caching', () => {
    const userPrompt = buildBatchAiUserPrompt({ ...lookups, product: { external_id: 'p1' } })
    const content = buildBatchAiRequestContent({
      userPrompt,
      cacheSharedPrefix: true,
      contactSheets: ['data:image/jpeg;base64,product'],
      referenceSheets: ['data:image/jpeg;base64,prices'],
      visualExampleSheets: ['data:image/jpeg;base64,examples'],
    })
    const urls = content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url)
    const cached = content.filter((part) => part.cache_control)
    const cachedIndex = content.findIndex((part) => part.cache_control)

    expect(urls).toEqual(['data:image/jpeg;base64,prices', 'data:image/jpeg;base64,examples', 'data:image/jpeg;base64,product'])
    expect(cached).toHaveLength(1)
    expect(cached[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
    expect(content[cachedIndex + 1].text.startsWith(BATCH_AI_PRODUCT_SECTION)).toBe(true)
    expect(buildBatchAiRequestContent({ userPrompt, cacheSharedPrefix: false, contactSheets: [] }).some((part) => part.cache_control)).toBe(false)
  })

  it('keeps prompts without a shared part as one product text', () => {
    const content = buildBatchAiRequestContent({ userPrompt: 'Только товар', cacheSharedPrefix: true, contactSheets: [] })
    expect(content).toEqual([{ type: 'text', text: 'Только товар' }])
  })

  it('retries without cache_control once a provider rejects it and remembers that', async () => {
    const request = vi.fn(async (cache: boolean) => {
      if (cache) throw new Error('Unrecognized request argument supplied: cache_control')
      return 'ok'
    })

    await expect(withBatchAiPromptCacheFallback('test:reject', request)).resolves.toBe('ok')
    await expect(withBatchAiPromptCacheFallback('test:reject', request)).resolves.toBe('ok')
    expect(request.mock.calls.map(([cache]) => cache)).toEqual([true, false, false])
  })

  it('does not drop cache_control because of a temporary provider error', async () => {
    const request = vi.fn(async () => { throw new Error('rate limit, retry later') })

    await expect(withBatchAiPromptCacheFallback('test:busy', request)).rejects.toThrow('rate limit')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('requests a CDN thumbnail for Szwego contact sheet tiles only', () => {
    expect(batchAiContactSheetSourceUrl('https://xcimg.szwego.com/a/b.jpg')).toContain('imageMogr2/auto-orient/thumbnail/!768x768r')
    expect(batchAiContactSheetSourceUrl('https://static.yeezyunique.ru/a.webp')).not.toContain('imageMogr2')
  })
})

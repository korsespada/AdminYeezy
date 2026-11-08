import { describe, expect, it } from 'vitest'
import {
  anthropicUsage,
  isDeepSeekPeak,
  normalizePricingTable,
  openAiCompatibleUsage,
  resolveModelPrice,
  usageCostUsd,
} from '@/lib/ai-usage-pricing'

describe('ai usage pricing', () => {
  it('reads DeepSeek cache hit and reasoning tokens', () => {
    const tokens = openAiCompatibleUsage({
      usage: {
        prompt_tokens: 10_000,
        completion_tokens: 2_000,
        prompt_cache_hit_tokens: 8_000,
        prompt_cache_miss_tokens: 2_000,
        completion_tokens_details: { reasoning_tokens: 1_500 },
      },
    })
    expect(tokens).toEqual({
      promptTokens: 10_000,
      cachedTokens: 8_000,
      cacheWriteTokens: 0,
      completionTokens: 2_000,
      reasoningTokens: 1_500,
      providerCostUsd: null,
    })
  })

  it('takes OpenAI cached_tokens and OpenRouter cost', () => {
    const tokens = openAiCompatibleUsage({
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 }, cost: 0.0012 },
    })
    expect(tokens?.cachedTokens).toBe(40)
    expect(tokens?.providerCostUsd).toBe(0.0012)
    expect(openAiCompatibleUsage({})).toBeNull()
  })

  it('sums Anthropic input with cache read and write', () => {
    expect(anthropicUsage({
      usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 30 },
    })).toMatchObject({ promptTokens: 1050, cachedTokens: 900, cacheWriteTokens: 50, completionTokens: 30 })
  })

  it('detects DeepSeek peak hours in UTC on weekdays only', () => {
    expect(isDeepSeekPeak(new Date('2026-11-09T02:00:00Z'))).toBe(true) // понедельник
    expect(isDeepSeekPeak(new Date('2026-11-09T05:00:00Z'))).toBe(false)
    expect(isDeepSeekPeak(new Date('2026-11-09T09:59:00Z'))).toBe(true)
    expect(isDeepSeekPeak(new Date('2026-11-09T10:00:00Z'))).toBe(false)
    expect(isDeepSeekPeak(new Date('2026-11-08T02:00:00Z'))).toBe(false) // воскресенье
  })

  it('halves the built-in DeepSeek price off-peak and prefers a custom price', () => {
    const peak = resolveModelPrice({ host: 'api.deepseek.com', model: 'deepseek-flash', at: new Date('2026-11-09T02:00:00Z') })
    const offpeak = resolveModelPrice({ host: 'api.deepseek.com', model: 'DeepSeek-Flash', at: new Date('2026-11-09T12:00:00Z') })
    expect(peak).toMatchObject({ period: 'peak', price: { input: 0.30, cachedInput: 0.006, output: 1.20 } })
    expect(offpeak).toMatchObject({ period: 'offpeak', price: { input: 0.15, cachedInput: 0.003, output: 0.60 } })

    const custom = resolveModelPrice({
      host: 'api.deepseek.com',
      model: 'deepseek-flash',
      customPricing: normalizePricingTable({ 'DeepSeek-Flash': { input: 1, cachedInput: 0.1, output: 2 } }),
    })
    expect(custom).toEqual({ price: { input: 1, cachedInput: 0.1, output: 2 }, period: null, source: 'custom' })
    expect(resolveModelPrice({ host: 'byesu.com', model: 'gemini-3.8-flash-high' })).toBeNull()
  })

  it('charges cached input at the cache price', () => {
    const cost = usageCostUsd(
      { promptTokens: 10_000, cachedTokens: 8_000, cacheWriteTokens: 0, completionTokens: 2_000, reasoningTokens: 0, providerCostUsd: null },
      { input: 0.30, cachedInput: 0.006, output: 1.20 },
    )
    // 2000 × 0.30 + 8000 × 0.006 + 2000 × 1.20 = 600 + 48 + 2400 = 3048 / 1e6
    expect(cost).toBeCloseTo(0.003048, 8)
  })
})

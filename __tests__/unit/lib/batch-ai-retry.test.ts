import { describe, expect, it } from 'vitest'
import { AiRequestCancelledError } from '@/lib/ai-cancellation'
import {
  BATCH_AI_CONTENT_ITEM_ATTEMPTS,
  BATCH_AI_PROVIDER_ITEM_ATTEMPTS,
  batchAiItemMaxAttempts,
  batchAiRetryRoundDelayMs,
  shouldRetryBatchAiItem,
} from '@/lib/batch-ai-retry'

describe('batch AI item retry', () => {
  // Ошибки из запусков 17.11.2026, на которых товар падал с одной попыткой.
  it.each([
    'The upstream service is temporarily unavailable. Please try again later. (request id: 1)',
    'The upstream service is busy. Please try again later.',
    'auth_unavailable: no auth available (providers=antigravity, model=gemini-3.8-flash-high)',
    'antigravity auth missing project_id: no project_id in response',
    'credit wallet quota insufficient for default wallet, balance: $0.001, need: $0.011',
    'byesu.com вернул некорректный JSON (403)',
    'byesu.com: ошибка 403',
    'byesu.com не ответил за 300 с (тайм-аут запроса)',
    'openai_error',
    'terminated',
    'Connection terminated due to connection timeout',
    'No available channel for model gemini-4-hydrogen-xhigh under group Gemini Business',
  ])('retries provider failure: %s', (message) => {
    expect(batchAiItemMaxAttempts(new Error(message))).toBe(BATCH_AI_PROVIDER_ITEM_ATTEMPTS)
  })

  it.each([
    'ИИ вернул невалидный JSON',
    'ИИ вернул пустой ответ',
    'Для категории «Сумки» требуется конкретная подкатегория вместо «Сумки»',
    'Фотография 29 назначена нескольким цветам',
  ])('gives one more attempt for a rejected answer: %s', (message) => {
    expect(batchAiItemMaxAttempts(new Error(message))).toBe(BATCH_AI_CONTENT_ITEM_ATTEMPTS)
  })

  it('does not retry a stopped run', () => {
    expect(shouldRetryBatchAiItem(new AiRequestCancelledError(), 1)).toBe(false)
  })

  it('stops after the attempt limit', () => {
    const provider = new Error('The upstream service is busy')
    expect(shouldRetryBatchAiItem(provider, 1)).toBe(true)
    expect(shouldRetryBatchAiItem(provider, BATCH_AI_PROVIDER_ITEM_ATTEMPTS - 1)).toBe(true)
    expect(shouldRetryBatchAiItem(provider, BATCH_AI_PROVIDER_ITEM_ATTEMPTS)).toBe(false)
    const content = new Error('ИИ вернул невалидный JSON')
    expect(shouldRetryBatchAiItem(content, 1)).toBe(true)
    expect(shouldRetryBatchAiItem(content, 2)).toBe(false)
  })

  it('waits longer on each retry round', () => {
    expect(batchAiRetryRoundDelayMs(1)).toBe(30_000)
    expect(batchAiRetryRoundDelayMs(2)).toBe(120_000)
    expect(batchAiRetryRoundDelayMs(4)).toBe(600_000)
    expect(batchAiRetryRoundDelayMs(9)).toBe(600_000)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { isProviderTimeoutError, providerConnectionError, providerTimeoutError, providerTimeoutMsFromEnv } from '@/lib/ai-providers'
import { anthropicTimeoutMs } from '@/lib/anthropic'
import { byesuTimeoutMs } from '@/lib/byesu'
import { openRouterTimeoutMs } from '@/lib/openrouter'

const TOUCHED = ['BYESU_TIMEOUT_MS', 'OPENROUTER_TIMEOUT_MS', 'ANTHROPIC_TIMEOUT_MS'] as const

describe('provider timeouts', () => {
  const saved = new Map<string, string | undefined>()

  afterEach(() => {
    for (const key of TOUCHED) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
      saved.delete(key)
    }
  })

  function remember() {
    for (const key of TOUCHED) saved.set(key, process.env[key])
  }

  it('держит 300 секунд по умолчанию для всех трёх провайдеров', () => {
    remember()
    for (const key of TOUCHED) delete process.env[key]

    expect(byesuTimeoutMs()).toBe(300_000)
    expect(openRouterTimeoutMs()).toBe(300_000)
    expect(anthropicTimeoutMs()).toBe(300_000)
  })

  it('принимает настройку из окружения и игнорирует слишком маленькую', () => {
    remember()
    process.env.BYESU_TIMEOUT_MS = '45000'
    process.env.OPENROUTER_TIMEOUT_MS = '120000'
    process.env.ANTHROPIC_TIMEOUT_MS = '500'

    expect(byesuTimeoutMs()).toBe(45_000)
    expect(openRouterTimeoutMs()).toBe(120_000)
    expect(anthropicTimeoutMs()).toBe(300_000)
  })

  it('собирает читаемую ошибку провайдера', () => {
    expect(providerTimeoutMsFromEnv('MISSING_PROVIDER_TIMEOUT_MS', 300_000)).toBe(300_000)
  })
})

describe('provider error classification', () => {
  it('распознаёт тайм-аут и сохраняет структурный признак', () => {
    const timeout = providerTimeoutError('BYESU', 300_000, new Error('aborted'))

    expect(timeout.message).toBe('BYESU не ответил за 300 с (тайм-аут запроса)')
    expect(timeout.name).toBe('TimeoutError')
    expect(isProviderTimeoutError(timeout)).toBe(true)
    expect(isProviderTimeoutError(Object.assign(new Error('aborted'), { code: 23 }))).toBe(true)
  })

  it('показывает сетевой код обрыва, а не тайм-аут', () => {
    const connection = providerConnectionError('OpenRouter', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))

    expect(connection.message).toBe('Не удалось подключиться к OpenRouter (ECONNRESET)')
    expect((connection as Error & { code?: string }).code).toBe('ECONNRESET')
    expect(isProviderTimeoutError(connection)).toBe(false)
    expect(providerConnectionError('Anthropic', new Error('boom')).message).toBe('Не удалось подключиться к Anthropic')
  })
})

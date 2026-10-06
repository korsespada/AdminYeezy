import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { byesuApiKeyEnvName, byesuApiKeyStatus, byesuGroupLabel, byesuModelGroup, byesuRequestError, byesuTimeoutMs } from '@/lib/byesu'

const TOUCHED = [
  'BYESU_API_KEY',
  'BYESU_API_GROUP',
  'BYESU_GEMINI_API_KEY',
  'BYESU_OPENAI_API_KEY',
  'BYESU_CLAUDE_API_KEY',
  'BYESU_GROK_API_KEY',
] as const

describe('byesuModelGroup', () => {
  it('относит модель к группе по её имени', () => {
    expect(byesuModelGroup('gemini-3.8-flash-high')).toBe('gemini')
    expect(byesuModelGroup('claude-sonnet-4-6')).toBe('claude')
    expect(byesuModelGroup('grok-4.7')).toBe('grok')
    expect(byesuModelGroup('GROK-4.5')).toBe('grok')
    expect(byesuModelGroup('gpt-5.6-luna')).toBe('openai')
    expect(byesuModelGroup(undefined)).toBe('openai')
  })

  it('подписывает группы и переменные окружения', () => {
    expect(byesuApiKeyEnvName('claude')).toBe('BYESU_CLAUDE_API_KEY')
    expect(byesuApiKeyEnvName('grok')).toBe('BYESU_GROK_API_KEY')
    expect(byesuGroupLabel('claude')).toBe('Claude')
    expect(byesuGroupLabel('grok')).toBe('Grok')
    expect(byesuGroupLabel('gemini')).toBe('Gemini Business')
  })
})

describe('byesuRequestError', () => {
  it('называет тайм-аут тайм-аутом, а не отказом соединения', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError', code: 23 })

    const error = byesuRequestError(timeout)

    expect(error.message).toContain('не ответил за 300 с')
    expect(error.message).toContain('тайм-аут')
    // Структурный признак нужен, чтобы batch AI повторил такой запрос.
    expect(error.name).toBe('TimeoutError')
    expect(error.cause).toBe(timeout)
  })

  it('показывает сетевой код обрыва соединения', () => {
    const socket = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })

    const error = byesuRequestError(socket)

    expect(error.message).toBe('Не удалось подключиться к BYESU (ECONNRESET)')
    expect(error.code).toBe('ECONNRESET')
  })

  it('уважает настройку BYESU_TIMEOUT_MS и её границы', () => {
    const saved = process.env.BYESU_TIMEOUT_MS
    try {
      process.env.BYESU_TIMEOUT_MS = '45000'
      expect(byesuTimeoutMs()).toBe(45_000)
      process.env.BYESU_TIMEOUT_MS = '1000'
      expect(byesuTimeoutMs()).toBe(300_000)
      delete process.env.BYESU_TIMEOUT_MS
      expect(byesuTimeoutMs()).toBe(300_000)
    } finally {
      if (saved === undefined) delete process.env.BYESU_TIMEOUT_MS
      else process.env.BYESU_TIMEOUT_MS = saved
    }
  })
})

describe('byesuApiKeyStatus', () => {
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of TOUCHED) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of TOUCHED) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('видит ключ Claude отдельно от остальных групп', () => {
    process.env.BYESU_CLAUDE_API_KEY = 'sk-claude'

    const status = byesuApiKeyStatus()
    expect(status.claude).toBe(true)
    expect(status.gemini).toBe(false)
    expect(status.openai).toBe(false)
    expect(status.grok).toBe(false)
  })

  it('видит ключ Grok отдельно от остальных групп', () => {
    process.env.BYESU_GROK_API_KEY = 'sk-grok'

    const status = byesuApiKeyStatus()
    expect(status.grok).toBe(true)
    expect(status.gemini).toBe(false)
    expect(status.openai).toBe(false)
    expect(status.claude).toBe(false)
  })

  it('отдаёт legacy-ключ той группе, которая указана в BYESU_API_GROUP', () => {
    process.env.BYESU_API_KEY = 'sk-legacy'
    process.env.BYESU_API_GROUP = 'claude'

    const status = byesuApiKeyStatus()
    expect(status.claude).toBe(true)
    expect(status.openai).toBe(false)
    expect(status.legacy).toBe(true)
  })

  it('поддерживает группу grok в legacy-ключе', () => {
    process.env.BYESU_API_KEY = 'sk-legacy'
    process.env.BYESU_API_GROUP = 'grok'

    const status = byesuApiKeyStatus()
    expect(status.grok).toBe(true)
    expect(status.openai).toBe(false)
  })

  it('без ключей все группы пустые', () => {
    const status = byesuApiKeyStatus()
    expect([status.gemini, status.openai, status.claude, status.grok, status.legacy]).toEqual([false, false, false, false, false])
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { byesuApiKeyEnvName, byesuApiKeyStatus, byesuGroupLabel, byesuModelGroup } from '@/lib/byesu'

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

import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = new Map<string, string>()

vi.mock('@/lib/db', () => ({
  scrapingQuery: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*SELECT value FROM app_settings/i.test(sql)) {
      const value = settings.get(String(params[0]))
      return { rows: value === undefined ? [] : [{ value }] }
    }
    return { rows: [] }
  }),
}))

import {
  isByesuHostname,
  providerUsesProxy,
  proxyPoolEnabled,
  resolveBatchAiProxies,
  withProxyFailover,
} from '@/lib/batch-ai-proxies'

const POOL = JSON.stringify([{ id: 'a', url: 'http://user:pass@1.1.1.1:8888', status: 'ok', latencyMs: 100 }])

describe('per-provider proxy flag', () => {
  beforeEach(() => {
    settings.clear()
    delete process.env.BYESU_PROXY_URL
  })

  it('recognises byesu hosts', () => {
    expect(isByesuHostname('byesu.com')).toBe(true)
    expect(isByesuHostname('api.byesu.com')).toBe(true)
    expect(isByesuHostname('openrouter.ai')).toBe(false)
  })

  it('uses the provider flag and defaults to BYESU only', () => {
    expect(proxyPoolEnabled('byesu.com')).toBe(true)
    expect(proxyPoolEnabled('openrouter.ai')).toBe(false)
    expect(proxyPoolEnabled('openrouter.ai', true)).toBe(true)
    expect(proxyPoolEnabled('byesu.com', false)).toBe(false)
    expect(providerUsesProxy('https://byesu.com/v1', null)).toBe(true)
    expect(providerUsesProxy('https://api.deepseek.com', null)).toBe(false)
    expect(providerUsesProxy('https://api.deepseek.com', true)).toBe(true)
    expect(providerUsesProxy('not a url', null)).toBe(false)
  })

  it('sends a flagged request through the stored pool', async () => {
    settings.set('batch_ai_proxies', POOL)
    const attempt = vi.fn(async (agent: unknown) => agent)
    const proxied = await withProxyFailover(attempt, { hostname: 'openrouter.ai' })
    expect(proxied.proxyUrl).toMatch(/^http:\/\/user:pass@1\.1\.1\.1:8888/)
  })

  it('keeps BYESU_PROXY_URL for byesu.com only', async () => {
    process.env.BYESU_PROXY_URL = 'http://env:1@9.9.9.9:8888'
    expect((await resolveBatchAiProxies('byesu.com')).map((proxy) => proxy.id)).toEqual(['env'])
    expect(await resolveBatchAiProxies('openrouter.ai')).toEqual([])
  })
})

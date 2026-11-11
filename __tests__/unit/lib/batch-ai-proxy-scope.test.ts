import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = new Map<string, string>()

vi.mock('@/lib/db', () => ({
  scrapingQuery: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*SELECT value FROM app_settings/i.test(sql)) {
      const value = settings.get(String(params[0]))
      return { rows: value === undefined ? [] : [{ value }] }
    }
    if (/INSERT INTO app_settings/i.test(sql)) {
      settings.set(String(params[0]), String(params[1]))
      return { rows: [] }
    }
    return { rows: [] }
  }),
}))

import {
  isByesuHostname,
  proxyPoolAppliesTo,
  resolveBatchAiProxies,
  saveProxyAllProviders,
  withProxyFailover,
} from '@/lib/batch-ai-proxies'

const POOL = JSON.stringify([{ id: 'a', url: 'http://user:pass@1.1.1.1:8888', status: 'ok', latencyMs: 100 }])

describe('proxy pool scope', () => {
  beforeEach(() => {
    settings.clear()
    delete process.env.BYESU_PROXY_URL
  })

  it('recognises byesu hosts', () => {
    expect(isByesuHostname('byesu.com')).toBe(true)
    expect(isByesuHostname('api.byesu.com')).toBe(true)
    expect(isByesuHostname('openrouter.ai')).toBe(false)
  })

  it('applies the pool to BYESU always and to others only with the flag', async () => {
    expect(await proxyPoolAppliesTo('byesu.com')).toBe(true)
    expect(await proxyPoolAppliesTo('openrouter.ai')).toBe(false)
    await saveProxyAllProviders(true)
    expect(await proxyPoolAppliesTo('openrouter.ai')).toBe(true)
    await saveProxyAllProviders(false)
    expect(await proxyPoolAppliesTo('api.anthropic.com')).toBe(false)
  })

  it('sends other providers directly while the flag is off', async () => {
    settings.set('batch_ai_proxies', POOL)
    const attempt = vi.fn(async (agent: unknown) => agent)
    const direct = await withProxyFailover(attempt, { hostname: 'openrouter.ai' })
    expect(direct.proxyUrl).toBeNull()
    expect(attempt).toHaveBeenCalledWith(undefined)

    await saveProxyAllProviders(true)
    const proxied = await withProxyFailover(attempt, { hostname: 'openrouter.ai' })
    expect(proxied.proxyUrl).toMatch(/^http:\/\/user:pass@1\.1\.1\.1:8888/)
  })

  it('keeps BYESU_PROXY_URL for byesu.com only', async () => {
    process.env.BYESU_PROXY_URL = 'http://env:1@9.9.9.9:8888'
    expect((await resolveBatchAiProxies('byesu.com')).map((proxy) => proxy.id)).toEqual(['env'])
    expect(await resolveBatchAiProxies('openrouter.ai')).toEqual([])
  })
})

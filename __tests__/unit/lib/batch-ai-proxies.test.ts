import { describe, expect, it } from 'vitest'

import {
  isProxyFailoverError,
  normalizeBatchAiProxies,
  normalizeProxyUrl,
  proxyCandidates,
} from '@/lib/batch-ai-proxies'

describe('batch AI proxy pool', () => {
  it('нормализует адреса и отбрасывает мусор с дублями', () => {
    const proxies = normalizeBatchAiProxies([
      { id: 'a', url: 'http://user:pass@1.1.1.1:8888', status: 'ok', latencyMs: 120 },
      { id: 'b', url: 'http://user:pass@1.1.1.1:8888', status: 'fail' },
      { id: 'c', url: 'ftp://bad', status: 'ok' },
      { id: 'd', url: '', status: 'ok' },
      { id: 'e', url: 'socks5h://user:pass@2.2.2.2:1080', enabled: false, status: 'weird' },
    ])

    expect(proxies).toHaveLength(2)
    expect(proxies.map((proxy) => proxy.id)).toEqual(['a', 'e'])
    expect(proxies[0].status).toBe('ok')
    expect(proxies[0].latencyMs).toBe(120)
    expect(proxies[1].status).toBe('unknown')
    expect(proxies[1].enabled).toBe(false)
  })

  it('не принимает неизвестные схемы прокси', () => {
    expect(normalizeProxyUrl('http://user:pass@1.1.1.1:8888')).toMatch(/^http:\/\//)
    expect(normalizeProxyUrl('socks5h://user:pass@1.1.1.1:1080')).toMatch(/^socks5h:\/\//)
    expect(normalizeProxyUrl('ftp://1.1.1.1')).toBe('')
    expect(normalizeProxyUrl('not a url')).toBe('')
  })

  it('ставит рабочие прокси первыми, упавшие последними', () => {
    const rows = normalizeBatchAiProxies([
      { id: 'dead', url: 'http://dead:1@1.1.1.1:8888', status: 'fail' },
      { id: 'slow', url: 'http://slow:1@2.2.2.2:8888', status: 'ok', latencyMs: 900 },
      { id: 'fast', url: 'http://fast:1@3.3.3.3:8888', status: 'ok', latencyMs: 80 },
      { id: 'new', url: 'http://new:1@4.4.4.4:8888', status: 'unknown' },
      { id: 'off', url: 'http://off:1@5.5.5.5:8888', status: 'ok', enabled: false },
    ])

    expect(proxyCandidates(rows).map((proxy) => proxy.id)).toEqual(['fast', 'slow', 'new', 'dead'])
  })

  it('переключает прокси только на сетевых сбоях', () => {
    expect(isProxyFailoverError(Object.assign(new Error('socket'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isProxyFailoverError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(true)
    expect(isProxyFailoverError(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe(true)
    expect(isProxyFailoverError(new Error('BYESU вернул некорректный JSON (200)'))).toBe(false)
    expect(isProxyFailoverError(new Error('Invalid token'))).toBe(false)
  })
})

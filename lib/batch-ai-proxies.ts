import crypto from 'node:crypto'
import https from 'node:https'

import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

import { scrapingQuery } from '@/lib/db'
import { isProviderTimeoutError } from '@/lib/ai-providers'

/**
 * Пул прокси для запросов к BYESU, который оператор ведёт в «Настройках ИИ».
 *
 * Зачем: с сервера админки крупные тела (contact sheets с картинками) до
 * byesu.com по HTTP/1.1 не доходят — соединение рвётся или висит до таймаута,
 * хотя через прокси тот же запрос проходит с первого раза. Один прокси —
 * единая точка отказа, поэтому хранится список: при обрыве запрос уходит через
 * следующий, а статус каждой строки виден в интерфейсе.
 *
 * Хранение: `app_settings.batch_ai_proxies` — JSON-массив строк
 * `{ id, url, label, enabled, status, latencyMs, checkedAt, lastError }`.
 */

export type BatchAiProxyStatus = 'unknown' | 'ok' | 'fail'

export type BatchAiProxy = {
  id: string
  url: string
  label: string
  enabled: boolean
  status: BatchAiProxyStatus
  latencyMs: number | null
  checkedAt: string | null
  lastError: string
}

const SETTINGS_KEY = 'batch_ai_proxies'
const PROBE_URL = 'https://byesu.com/v1/models'
const PROBE_TIMEOUT_MS = 12_000

function asString(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeProxyUrl(value: unknown): string {
  const raw = asString(value)
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (!['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol)) return ''
  return url.toString()
}

export function normalizeBatchAiProxies(value: unknown): BatchAiProxy[] {
  const rows = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const result: BatchAiProxy[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const url = normalizeProxyUrl((row as any).url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const status = (row as any).status === 'ok' || (row as any).status === 'fail' ? (row as any).status : 'unknown'
    const latency = Number((row as any).latencyMs)
    result.push({
      id: asString((row as any).id) || crypto.randomUUID(),
      url,
      label: asString((row as any).label).slice(0, 80),
      enabled: (row as any).enabled !== false,
      status,
      latencyMs: Number.isFinite(latency) && latency > 0 ? Math.round(latency) : null,
      checkedAt: asString((row as any).checkedAt) || null,
      lastError: asString((row as any).lastError).slice(0, 300),
    })
  }
  return result
}

// Порядок попыток: рабочие сначала, затем непроверенные, упавшие — последними;
// внутри группы быстрые раньше медленных.
export function proxyCandidates(proxies: BatchAiProxy[]): BatchAiProxy[] {
  const rank = (proxy: BatchAiProxy) => (proxy.status === 'ok' ? 0 : proxy.status === 'unknown' ? 1 : 2)
  return proxies
    .filter((proxy) => proxy.enabled)
    .sort((left, right) => rank(left) - rank(right) || (left.latencyMs ?? 9999) - (right.latencyMs ?? 9999))
}

export function createProxyAgent(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return new HttpsProxyAgent(parsed)
  return new SocksProxyAgent(parsed)
}

export type BatchAiProxyAgent = ReturnType<typeof createProxyAgent>

export async function loadBatchAiProxies(): Promise<BatchAiProxy[]> {
  const result = await scrapingQuery('SELECT value FROM app_settings WHERE key=$1', [SETTINGS_KEY]).catch(() => ({ rows: [] as any[] }))
  if (!result.rows[0]) return []
  try {
    return normalizeBatchAiProxies(JSON.parse(String(result.rows[0].value || '[]')))
  } catch {
    return []
  }
}

export async function saveBatchAiProxies(proxies: BatchAiProxy[]) {
  await scrapingQuery(
    `INSERT INTO app_settings (key, value, updated_at) VALUES($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [SETTINGS_KEY, JSON.stringify(proxies)],
  )
}

/**
 * Прокси из окружения остаётся запасным вариантом: пока в «Настройках ИИ» нет
 * списка, работает прежняя переменная `BYESU_PROXY_URL`.
 */
export function legacyProxyFromEnv(): BatchAiProxy | null {
  const raw = asString(process.env.BYESU_PROXY_URL)
  const url = normalizeProxyUrl(raw)
  if (!url) return null
  return { id: 'env', url, label: 'BYESU_PROXY_URL', enabled: true, status: 'unknown', latencyMs: null, checkedAt: null, lastError: '' }
}

export async function resolveBatchAiProxies(): Promise<BatchAiProxy[]> {
  const stored = await loadBatchAiProxies()
  if (stored.length) return proxyCandidates(stored)
  const legacy = legacyProxyFromEnv()
  return legacy ? [legacy] : []
}

/**
 * Проверка прокси: любой HTTP-ответ (даже 401/404) значит, что путь до byesu
 * через прокси есть — важен факт соединения, а не авторизация.
 */
export function probeBatchAiProxy(url: string): Promise<{ ok: boolean; latencyMs: number | null; error: string }> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    const finish = (ok: boolean, error = '') => {
      if (settled) return
      settled = true
      resolve({ ok, latencyMs: ok ? Date.now() - startedAt : null, error })
    }
    try {
      const request = https.request(new URL(PROBE_URL), {
        method: 'GET',
        agent: createProxyAgent(url),
        headers: { 'Cache-Control': 'no-store' },
      }, (response) => {
        response.resume()
        response.on('end', () => finish(true))
        response.on('error', () => finish(true))
      })
      request.setTimeout(PROBE_TIMEOUT_MS, () => {
        request.destroy(new Error('таймаут проверки прокси'))
      })
      request.on('error', (error: any) => finish(false, String(error?.code || error?.message || error).slice(0, 200)))
      request.end()
    } catch (error: any) {
      finish(false, String(error?.message || error).slice(0, 200))
    }
  })
}

async function recordProxyResult(url: string, ok: boolean, latencyMs: number | null, error = '') {
  try {
    const proxies = await loadBatchAiProxies()
    const target = proxies.find((proxy) => proxy.url === url)
    if (!target) return
    const nextStatus: BatchAiProxyStatus = ok ? 'ok' : 'fail'
    target.status = nextStatus
    target.latencyMs = ok ? latencyMs : target.latencyMs
    target.checkedAt = new Date().toISOString()
    target.lastError = ok ? '' : error
    await saveBatchAiProxies(proxies)
  } catch {
    // Статус — вспомогательная информация: его сбой не должен ломать запрос.
  }
}

export type ProxyAttemptResult<T> = { value: T; proxyUrl: string | null }

/**
 * Выполняет запрос через первый рабочий прокси из списка. На сетевой ошибке
 * помечает прокси упавшим и пробует следующий; когда список кончился —
 * последняя ошибка уходит наверх. Пустой список означает прямой запрос.
 */
export async function withProxyFailover<T>(
  attempt: (agent: ReturnType<typeof createProxyAgent> | undefined) => Promise<T>,
): Promise<ProxyAttemptResult<T>> {
  const candidates = await resolveBatchAiProxies()
  if (!candidates.length) {
    return { value: await attempt(undefined), proxyUrl: null }
  }
  let lastError: unknown = null
  for (const proxy of candidates) {
    const startedAt = Date.now()
    try {
      const value = await attempt(createProxyAgent(proxy.url))
      void recordProxyResult(proxy.url, true, Date.now() - startedAt)
      return { value, proxyUrl: proxy.url }
    } catch (error: any) {
      lastError = error
      // Ошибку содержимого (невалидный JSON, отказ провайдера) не лечим сменой
      // прокси: она повторится и через другой адрес.
      if (!isProxyFailoverError(error)) throw error
      void recordProxyResult(proxy.url, false, null, String(error?.message || error).slice(0, 200))
    }
  }
  throw lastError
}

/** Сетевые сбои, при которых имеет смысл пробовать другой прокси. */
export function isProxyFailoverError(error: any) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase()
  return isProviderTimeoutError(error)
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
}

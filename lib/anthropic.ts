import http from 'node:http'
import https from 'node:https'

import { recordAiUsage } from '@/lib/ai-usage'
import { AiRequestCancelledError, bindAiAbortToRequest, currentAiAbortSignal, isAiCancelledError, throwIfAiCancelled } from '@/lib/ai-cancellation'
import { proxyPoolAppliesTo, withProxyFailover, type BatchAiProxyAgent } from '@/lib/batch-ai-proxies'
import { isProviderTimeoutError, providerConnectionError, providerTimeoutError, providerTimeoutMsFromEnv, providerMessagesUrl } from '@/lib/ai-providers'

const ANTHROPIC_DEFAULT_TIMEOUT_MS = 300_000
const ANTHROPIC_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export function anthropicTimeoutMs() {
  return providerTimeoutMsFromEnv('ANTHROPIC_TIMEOUT_MS', ANTHROPIC_DEFAULT_TIMEOUT_MS)
}

type AnthropicPayload = Record<string, any>

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isAgentRouter(baseUrl: string) {
  const hostname = providerHost(baseUrl)
  return hostname === 'agentrouter.org' || hostname.endsWith('.agentrouter.org')
}

function anthropicError(payload: AnthropicPayload, status: number) {
  const message = payload?.error?.message || payload?.message
  return new Error(message ? String(message) : `Anthropic error ${status}`)
}

function headers(baseUrl: string, apiKey: string) {
  const result: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': apiKey,
  }
  if (isAgentRouter(baseUrl)) {
    result['anthropic-beta'] = 'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24,redact-thinking-2026-02-12'
    result['anthropic-dangerous-direct-browser-access'] = 'true'
    result['X-Stainless-Retry-Count'] = '0'
    result['X-Stainless-Timeout'] = String(Math.round(anthropicTimeoutMs() / 1000))
    result['X-Stainless-Lang'] = 'js'
    result['X-Stainless-Package-Version'] = '0.76.0'
    result['X-Stainless-OS'] = 'Linux'
    result['X-Stainless-Arch'] = 'x64'
    result['X-Stainless-Runtime'] = 'node'
    result['X-Stainless-Runtime-Version'] = process.versions.node
    result['accept-encoding'] = 'gzip, deflate, br, zstd'
    result['User-Agent'] = 'claude-cli/2.1.158 (external, sdk-cli)'
    result['x-app'] = 'cli'
  }
  return result
}

export async function anthropicMessagesCompletion(
  requestBody: Record<string, any>,
  connection: { baseUrl?: string; apiKey?: string } = {},
): Promise<AnthropicPayload> {
  const apiKey = connection.apiKey?.trim()
  if (!apiKey) throw new Error('API-ключ Anthropic не задан')
  const baseUrl = connection.baseUrl?.trim() || 'https://api.anthropic.com'
  const startedAt = Date.now()
  try {
    const payload = await sendAnthropicRequest(requestBody, baseUrl, apiKey)
    recordAiUsage({ target: providerMessagesUrl(baseUrl), protocol: 'anthropic', model: requestBody.model, payload, startedAt })
    return payload
  } catch (error) {
    recordAiUsage({ target: providerMessagesUrl(baseUrl), protocol: 'anthropic', model: requestBody.model, error, startedAt })
    throw error
  }
}

type RawResponse = { status: number; ok: boolean; contentLength: number; text: string }

async function sendAnthropicRequest(requestBody: Record<string, any>, baseUrl: string, apiKey: string): Promise<AnthropicPayload> {
  throwIfAiCancelled()
  const url = providerMessagesUrl(baseUrl)
  const body = JSON.stringify(requestBody)
  const requestHeaders = headers(baseUrl, apiKey)
  // При флажке «Все провайдеры ИИ через прокси» запрос идёт через пул прокси
  // (node https с агентом), иначе — прежним fetch напрямую.
  const response = await proxyPoolAppliesTo(new URL(url).hostname)
    ? (await withProxyFailover((agent) => postAnthropicViaNode(url, requestHeaders, body, agent), { hostname: new URL(url).hostname })).value
    : await postAnthropicViaFetch(url, requestHeaders, body)

  if (response.contentLength > ANTHROPIC_MAX_RESPONSE_BYTES) throw new Error('Ответ Anthropic превышает допустимый размер')
  const raw = response.text
  if (Buffer.byteLength(raw) > ANTHROPIC_MAX_RESPONSE_BYTES) throw new Error('Ответ Anthropic превышает допустимый размер')

  let payload: AnthropicPayload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    throw new Error(`Anthropic вернул некорректный JSON (${response.status})`)
  }
  if (!response.ok) throw anthropicError(payload, response.status)
  return payload
}

async function postAnthropicViaFetch(url: string, requestHeaders: Record<string, string>, body: string): Promise<RawResponse> {
  const cancelSignal = currentAiAbortSignal()
  const timeoutSignal = AbortSignal.timeout(anthropicTimeoutMs())
  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body,
    signal: cancelSignal ? AbortSignal.any([timeoutSignal, cancelSignal]) : timeoutSignal,
  }).catch((error: any) => {
    if (cancelSignal?.aborted) throw new AiRequestCancelledError()
    const causeCode = error?.cause?.code
    if (isProviderTimeoutError(error) || causeCode === 'UND_ERR_HEADERS_TIMEOUT' || causeCode === 'UND_ERR_BODY_TIMEOUT') {
      throw providerTimeoutError('Anthropic', anthropicTimeoutMs(), error)
    }
    throw providerConnectionError('Anthropic', error)
  })
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > ANTHROPIC_MAX_RESPONSE_BYTES) throw new Error('Ответ Anthropic превышает допустимый размер')
  return { status: response.status, ok: response.ok, contentLength, text: await response.text() }
}

function postAnthropicViaNode(
  url: string,
  requestHeaders: Record<string, string>,
  body: string,
  agent: BatchAiProxyAgent | undefined,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    throwIfAiCancelled()
    const target = new URL(url)
    const client = target.protocol === 'http:' ? http : https
    const timeoutMs = anthropicTimeoutMs()
    const request = client.request(target, {
      method: 'POST',
      agent,
      headers: { ...requestHeaders, 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      let received = 0
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > ANTHROPIC_MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Ответ Anthropic превышает допустимый размер'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const status = response.statusCode || 0
        resolve({
          status,
          ok: status >= 200 && status < 300,
          contentLength: Number(response.headers['content-length'] || 0),
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(providerTimeoutError('Anthropic', timeoutMs)))
    const unbindAbort = bindAiAbortToRequest(request)
    request.on('close', unbindAbort)
    request.on('error', (error: Error) => {
      reject(isProviderTimeoutError(error) || isAiCancelledError(error) ? error : providerConnectionError('Anthropic', error))
    })
    request.end(body)
  })
}

require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })

const sharp = require('sharp')
const { readSseContent } = require('./lib/cockpit-sse')

const ADMIN_URL = (process.env.ADMINYEEZY_URL || process.env.ADMIN_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const WORKER_TOKEN = process.env.BATCH_AI_WORKER_TOKEN || required('AI_CATALOG_WORKER_TOKEN')
const COCKPIT_API_URL = required('COCKPIT_API_URL')
const COCKPIT_API_KEY = required('COCKPIT_API_KEY')
const COCKPIT_MODEL = process.env.COCKPIT_MODEL || 'gpt-5.6-luna'
const WORKER_ID = process.env.BATCH_AI_WORKER_ID || `batch-ai-${process.pid}`
const POLL_MS = Math.max(1000, Number(process.env.BATCH_AI_WORKER_POLL_MS || 5000))
let concurrency = Math.max(1, Math.min(10, Number(process.env.BATCH_AI_WORKER_CONCURRENCY || 5)))
const TILE = 384
const MEDIA_HOSTS = new Set((process.env.AI_CATALOG_MEDIA_HOSTS || 'static.yeezyunique.ru,xcimg.szwego.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))
const referenceSheetCache = new Map()

let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

main().catch((error) => {
  console.error(`[batch-ai-worker] fatal: ${error.message}`)
  process.exitCode = 1
})

async function main() {
  console.log(`[batch-ai-worker] ready: ${COCKPIT_MODEL}, concurrency: ${concurrency}`)
  const active = new Set()
  while (!stopping) {
    const heartbeat = await api({ action: 'heartbeat', worker_id: WORKER_ID, model: COCKPIT_MODEL, metadata: { concurrency } }).catch((error) => {
      console.error(`[batch-ai-worker] heartbeat: ${error.message}`)
      return null
    })
    if (heartbeat?.concurrency) concurrency = Math.max(1, Math.min(10, Number(heartbeat.concurrency)))
    while (!stopping && active.size < concurrency) {
      const claimed = await api({ action: 'claim', worker_id: WORKER_ID }).catch(() => null)
      if (!claimed?.item) break
      const promise = processItem(claimed.item).finally(() => active.delete(promise))
      active.add(promise)
    }
    if (active.size) await Promise.race([Promise.allSettled([...active]), delay(POLL_MS)])
    else await delay(POLL_MS)
  }
  await Promise.allSettled([...active])
}

async function processItem(item) {
  try {
    const input = item.input_snapshot || {}
    const sheets = await buildContactSheets(input.photoUrls || [])
    const referenceSheets = await cachedReferenceSheets(input.priceReferenceUrls || [])
    const modelReferenceSheets = await cachedReferenceSheets(input.modelReferenceUrls || [])
    const visualExampleSheets = await cachedReferenceSheets(input.visualExampleUrls || [])
    const content = [{ type: 'text', text: input.userPrompt }]
    sheets.forEach((url, index) => {
      content.push({ type: 'text', text: `Contact sheet ${index + 1}` })
      content.push({ type: 'image_url', image_url: { url } })
    })
    referenceSheets.forEach((url, index) => {
      content.push({ type: 'text', text: `Эталоны цен ${index + 1}. Это не фотографии текущего товара.` })
      content.push({ type: 'image_url', image_url: { url } })
    })
    modelReferenceSheets.forEach((url, index) => {
      content.push({ type: 'text', text: `Эталоны моделей Chanel ${index + 1}. Это отдельный лист справочника, не фотографии текущего товара.` })
      content.push({ type: 'image_url', image_url: { url } })
    })
    visualExampleSheets.forEach((url, index) => {
      content.push({ type: 'text', text: `Визуальные эталоны поставщика ${index + 1}. Это отдельный справочник ракурсов, не фотографии текущего товара.` })
      content.push({ type: 'image_url', image_url: { url } })
    })
    let output = await cockpitJson({
      systemPrompt: input.systemPrompt,
      content,
      temperature: item.settings_snapshot?.temperature,
      maxTokens: item.settings_snapshot?.maxTokens,
    })
    if (input.fullSizeRefinementEnabled && Array.isArray(output?.inspect_full_size_indexes) && output.inspect_full_size_indexes.length) {
      const originals = originalPhotos(input.photoUrls || [], output.inspect_full_size_indexes)
      if (originals.length) {
        const refinementContent = [{
          type: 'text',
          text: `${input.userPrompt}\n\nПредыдущий результат: ${JSON.stringify(output)}\n\nНиже только запрошенные оригиналы. Уточни по ним плохо читаемый бренд, модель, конструкцию или конфликт между исходным текстом и фотографиями. Если текст относится к другому товару, проигнорируй противоречащие сведения и исправь весь результат по фотографиям. Верни полный итоговый JSON той же схемы. Не запрашивай дополнительные фото.`,
        }]
        originals.forEach(({ index, url }) => {
          refinementContent.push({ type: 'text', text: `Оригинал фото ${index}` })
          refinementContent.push({ type: 'image_url', image_url: { url } })
        })
        output = await cockpitJson({
          systemPrompt: input.systemPrompt,
          content: refinementContent,
          temperature: item.settings_snapshot?.temperature,
          maxTokens: item.settings_snapshot?.maxTokens,
        })
      }
    }
    await api({ action: 'complete', item_id: item.id, lease_token: item.lease_token, output })
    console.log(`[batch-ai-worker] completed ${item.external_id || item.id}`)
  } catch (error) {
    console.error(`[batch-ai-worker] failed ${item.external_id || item.id}: ${error.message}`)
    await api({ action: 'fail', item_id: item.id, lease_token: item.lease_token, error: error.message }).catch(() => undefined)
  }
}

function originalPhotos(urls, indexes) {
  return [...new Set(indexes.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= urls.length))]
    .slice(0, 3)
    .flatMap((index) => {
      try {
        const url = String(urls[index - 1] || '')
        const parsed = new URL(url)
        return ['http:', 'https:'].includes(parsed.protocol) && MEDIA_HOSTS.has(parsed.hostname.toLowerCase()) ? [{ index, url }] : []
      } catch { return [] }
    })
}

async function buildContactSheets(urls) {
  const unique = [...new Set(urls.map(String).filter((url) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) && MEDIA_HOSTS.has(parsed.hostname.toLowerCase())
    } catch { return false }
  }))]
  const sheets = []
  for (let start = 0; start < unique.length; start += 9) {
    const chunk = unique.slice(start, start + 9)
    const tiles = await Promise.all(chunk.map(async (url, index) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`photo ${start + index + 1}: HTTP ${response.status}`)
      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (declaredSize > 12 * 1024 * 1024) throw new Error(`photo ${start + index + 1}: larger than 12 MB`)
      const source = Buffer.from(await response.arrayBuffer())
      if (source.length > 12 * 1024 * 1024) throw new Error(`photo ${start + index + 1}: larger than 12 MB`)
      const image = await sharp(source).rotate().resize(TILE, TILE, { fit: 'contain', background: '#fff' }).jpeg({ quality: 82 }).toBuffer()
      const label = await sharp({ text: { text: `<span foreground="white" background="#111827"> ${start + index + 1} </span>`, width: 100, height: 42, rgba: true } }).png().toBuffer()
      return { image, label, left: (index % 3) * TILE, top: Math.floor(index / 3) * TILE }
    }))
    const sheet = await sharp({ create: { width: TILE * 3, height: Math.ceil(tiles.length / 3) * TILE, channels: 3, background: '#fff' } })
      .composite(tiles.flatMap((tile) => [
        { input: tile.image, left: tile.left, top: tile.top },
        { input: tile.label, left: tile.left + 8, top: tile.top + 8 },
      ])).jpeg({ quality: 84 }).toBuffer()
    sheets.push(`data:image/jpeg;base64,${sheet.toString('base64')}`)
  }
  return sheets
}

async function cachedReferenceSheets(urls) {
  const key = JSON.stringify(urls || [])
  if (!referenceSheetCache.has(key)) {
    if (referenceSheetCache.size >= 20) referenceSheetCache.delete(referenceSheetCache.keys().next().value)
    referenceSheetCache.set(key, buildContactSheets(urls))
  }
  return referenceSheetCache.get(key)
}

async function cockpitJson({ systemPrompt, content, temperature, maxTokens }) {
  const response = await fetch(COCKPIT_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${COCKPIT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: COCKPIT_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }],
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
      max_tokens: Number(maxTokens) || 5000,
      response_format: { type: 'json_object' },
      stream: true,
    }),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) throw new Error(`Cockpit HTTP ${response.status}: ${await response.text()}`)
  const raw = await readSseContent(response)
  if (!raw) throw new Error('Cockpit returned an empty response')
  const clean = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  return JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean)
}

async function api(body) {
  const response = await fetch(`${ADMIN_URL}/api/batch-ai/worker`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `AdminYeezy HTTP ${response.status}`)
  return payload
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

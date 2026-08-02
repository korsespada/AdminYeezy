require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })

const sharp = require('sharp')
const { readSseContent } = require('./lib/cockpit-sse')
const { catalogQualityIssues, sanitizeCatalogOutput } = require('./lib/catalog-output')

const RAILS_API_URL = trimTrailingSlash(requiredEnv('RAILS_API_URL'))
const WORKER_TOKEN = requiredEnv('AI_CATALOG_WORKER_TOKEN')
const COCKPIT_API_URL = String(process.env.COCKPIT_API_URL || '').trim()
const COCKPIT_API_KEY = String(process.env.COCKPIT_API_KEY || '').trim()
const COCKPIT_MODEL = process.env.COCKPIT_MODEL || 'gpt-5.6-luna'
const BYESU_API_URL = process.env.BYESU_API_URL || 'https://byesu.com/v1/chat/completions'
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions'
const POLL_MS = integerEnv('AI_CATALOG_WORKER_POLL_MS', 5000, 1000, 60000)
const MAX_IMAGES = integerEnv('AI_CATALOG_WORKER_MAX_IMAGES', 9, 1, 9)
const CONCURRENCY = integerEnv('AI_CATALOG_WORKER_CONCURRENCY', 10, 1, 10)
const MEDIA_HOSTS = new Set((process.env.AI_CATALOG_MEDIA_HOSTS || 'static.yeezyunique.ru,xcimg.szwego.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))
const ONCE = process.argv.includes('--once')
const TILE_SIZE = 512
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

let stopping = false
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

main().catch((error) => {
  console.error(`[ai-catalog-worker] fatal: ${safeError(error)}`)
  process.exitCode = 1
})

async function main() {
  console.log(`[ai-catalog-worker] ready: provider from generation snapshot, fallback BYESU/${defaultModelFor('byesu')}, concurrency cap: ${CONCURRENCY}`)

  if (ONCE) {
    const claimed = await claimJob()
    if (claimed) await processJob(claimed)
    return
  }

  const active = new Set()
  while (!stopping) {
    let queueEmpty = false
    let queueUnavailable = false

    while (!stopping && active.size < CONCURRENCY) {
      let claimed
      try {
        claimed = await claimJob()
      } catch (error) {
        console.error(`[ai-catalog-worker] queue unavailable, retrying: ${safeError(error)}`)
        queueUnavailable = true
        break
      }
      if (!claimed) {
        queueEmpty = true
        break
      }

      let task
      task = processJob(claimed).finally(() => active.delete(task))
      active.add(task)
    }

    if (stopping) break
    if (active.size >= CONCURRENCY) {
      await Promise.race(active)
    } else if (queueEmpty || queueUnavailable) {
      await Promise.race([delay(POLL_MS), ...active])
    }
  }

  await Promise.allSettled([...active])
}

async function processJob({ generation, lease_token: leaseToken }) {
  const id = generation.id
  try {
    await reportProgress(id, leaseToken, 'building_contact_sheet')
    const images = Array.isArray(generation.input_snapshot?.images)
      ? generation.input_snapshot.images.slice(0, MAX_IMAGES)
      : []
    const contactSheet = images.length > 0 ? await buildContactSheet(images) : null

    await reportProgress(id, leaseToken, 'analyzing_product')
    const firstOutput = await generateDraft(generation, contactSheet)
    let finalOutput = firstOutput

    const detailNumbers = (Array.isArray(firstOutput.inspect_image_numbers) ? firstOutput.inspect_image_numbers : [])
      .map(Number)
      .filter((number) => Number.isInteger(number) && number >= 1 && number <= images.length)
      .slice(0, 3)

    if (detailNumbers.length > 0) {
      await reportProgress(id, leaseToken, 'reading_image_details')
      const detailImages = await Promise.all(detailNumbers.map(async (number) => ({
        number,
        dataUrl: await imageDataUrl(imageSource(images[number - 1])),
      })))
      finalOutput = await refineDraft(generation, firstOutput, detailImages)
    }

    const qualityIssues = catalogQualityIssues(generation, finalOutput)
    if (qualityIssues.length > 0) {
      await reportProgress(id, leaseToken, 'quality_review')
      finalOutput = await auditDraft(generation, finalOutput, qualityIssues)
    }

    finalOutput = sanitizeCatalogOutput(finalOutput, {
      internalIdentifiers: generation.input_snapshot?.catalog?.internal_identifiers || [],
    })

    await reportProgress(id, leaseToken, 'saving_draft')
    await workerRequest(`/admin/seo_ai/worker/generations/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      leaseToken,
      body: {
        result: {
          output: finalOutput,
          vision_result: firstOutput,
          text_result: {},
          model_snapshot: {
            provider: aiProvider(generation),
            model: generation.model_snapshot?.model || defaultModelFor(aiProvider(generation)),
            contact_sheet: Boolean(contactSheet),
            detail_images: detailNumbers,
            quality_review: qualityIssues.length > 0,
          },
        },
      },
    })
    console.log(`[ai-catalog-worker] completed ${id}`)
  } catch (error) {
    console.error(`[ai-catalog-worker] failed ${id}: ${safeError(error)}`)
    try {
      await workerRequest(`/admin/seo_ai/worker/generations/${encodeURIComponent(id)}/fail`, {
        method: 'POST',
        leaseToken,
        body: { error: safeError(error) },
      })
    } catch (reportError) {
      console.error(`[ai-catalog-worker] could not report failure ${id}: ${safeError(reportError)}`)
    }
  }
}

async function claimJob() {
  const response = await fetch(`${RAILS_API_URL}/admin/seo_ai/worker/claim`, {
    method: 'POST',
    headers: workerHeaders(),
    signal: AbortSignal.timeout(30000),
  })
  if (response.status === 204) return null
  return parseResponse(response, 'claim')
}

async function reportProgress(id, leaseToken, stage) {
  return workerRequest(`/admin/seo_ai/worker/generations/${encodeURIComponent(id)}/progress`, {
    method: 'POST',
    leaseToken,
    body: { stage },
  })
}

async function workerRequest(path, { method, leaseToken, body }) {
  const response = await fetch(`${RAILS_API_URL}${path}`, {
    method,
    headers: workerHeaders(leaseToken),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  return parseResponse(response, path)
}

function workerHeaders(leaseToken) {
  return {
    Authorization: `Bearer ${WORKER_TOKEN}`,
    'Content-Type': 'application/json',
    ...(leaseToken ? { 'X-AI-Lease-Token': leaseToken } : {}),
  }
}

async function generateDraft(generation, contactSheet) {
  const prompt = generation.prompt_snapshot?.user_prompt || JSON.stringify(generation.input_snapshot)
  const content = [{ type: 'text', text: prompt }]
  if (contactSheet) {
    content.push({ type: 'image_url', image_url: { url: contactSheet } })
  }

  return aiJson({
    provider: aiProvider(generation),
    model: generation.model_snapshot?.model,
    systemPrompt: generation.prompt_snapshot?.system_prompt || 'Верни только JSON.',
    content,
    temperature: generation.model_snapshot?.temperature,
    maxTokens: generation.model_snapshot?.max_tokens,
  })
}

async function refineDraft(generation, firstOutput, detailImages) {
  const content = [{
    type: 'text',
    text: [
      'Уточни черновик по приложенным оригинальным кадрам.',
      'Сохрани ту же JSON-схему. Исправляй только факты, которые подтверждаются крупным изображением.',
      'Если надпись или характеристика не читается, пропусти её. inspect_image_numbers верни пустым массивом.',
      `Исходный черновик: ${JSON.stringify(firstOutput)}`,
      `Контекст товара: ${JSON.stringify(generation.input_snapshot?.product || {})}`,
    ].join('\n'),
  }]
  for (const image of detailImages) {
    content.push({ type: 'text', text: `Оригинальный кадр #${image.number}` })
    content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
  }

  return aiJson({
    provider: aiProvider(generation),
    model: generation.model_snapshot?.model,
    systemPrompt: generation.prompt_snapshot?.system_prompt || 'Верни только JSON.',
    content,
    temperature: generation.model_snapshot?.temperature,
    maxTokens: generation.model_snapshot?.max_tokens,
  })
}

async function auditDraft(generation, draft, issues) {
  return aiJson({
    provider: aiProvider(generation),
    model: generation.model_snapshot?.model,
    systemPrompt: generation.prompt_snapshot?.system_prompt || 'Верни только JSON.',
    content: [{
      type: 'text',
      text: [
        'Проведи финальную редакторскую проверку черновика и верни исправленный JSON в той же схеме.',
        'Не сокращай подтверждённые свойства исходного товара. Не добавляй новых фактов.',
        'Исправь каждую проблему из списка:',
        ...issues.map((issue, index) => `${index + 1}. ${issue}`),
        `Черновик: ${JSON.stringify(draft)}`,
        `Полный контекст товара: ${JSON.stringify(generation.input_snapshot || {})}`,
      ].join('\n'),
    }],
    temperature: 0.05,
    maxTokens: generation.model_snapshot?.max_tokens,
  })
}

function aiProvider(generation) {
  const provider = String(generation.model_snapshot?.provider || process.env.AI_CATALOG_PROVIDER || 'byesu').trim().toLowerCase()
  if (provider === 'cockpit' || provider === 'cockpit_tools') return 'cockpit_tools'
  if (provider === 'openrouter') return 'openrouter'
  return 'byesu'
}

function defaultModelFor(provider) {
  if (provider === 'cockpit_tools') return COCKPIT_MODEL
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash'
  return process.env.BYESU_MODEL || 'gemini-3.1-flash-lite'
}

async function aiJson({ provider, model, systemPrompt, content, temperature, maxTokens }) {
  if (provider === 'cockpit_tools') {
    return cockpitJson({ systemPrompt, content, temperature, maxTokens, model: model || COCKPIT_MODEL })
  }
  if (provider === 'openrouter') {
    return openRouterJson({ systemPrompt, content, temperature, maxTokens, model: model || defaultModelFor('openrouter') })
  }
  return byesuJson({ systemPrompt, content, temperature, maxTokens, model: model || defaultModelFor('byesu') })
}

async function openRouterJson({ systemPrompt, content, temperature, maxTokens, model }) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY не задан')
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://admin.yeezyunique.ru',
      'X-Title': 'YeezyUnique SEO AI Studio',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }],
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
      max_tokens: Number(maxTokens) || 2400,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter HTTP ${response.status}`)
  const raw = payload?.choices?.[0]?.message?.content
  if (!raw) throw new Error('OpenRouter вернул пустой ответ')
  return parseJsonObject(String(raw))
}

async function byesuJson({ systemPrompt, content, temperature, maxTokens, model }) {
  const normalizedModel = String(model || defaultModelFor('byesu')).trim()
  const group = normalizedModel.toLowerCase().startsWith('gemini') ? 'gemini' : 'openai'
  const directKey = process.env[group === 'gemini' ? 'BYESU_GEMINI_API_KEY' : 'BYESU_OPENAI_API_KEY']?.trim()
  const legacyKey = process.env.BYESU_API_KEY?.trim()
  const legacyGroup = process.env.BYESU_API_GROUP?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai'
  const apiKey = directKey || (legacyGroup === group ? legacyKey : '')
  if (!apiKey) throw new Error(`BYESU_${group === 'gemini' ? 'GEMINI' : 'OPENAI'}_API_KEY не задан`)

  const response = await fetch(BYESU_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: normalizedModel,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }],
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
      max_tokens: Number(maxTokens) || 2400,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `BYESU HTTP ${response.status}`)
  const raw = payload?.choices?.[0]?.message?.content
  if (!raw) throw new Error('BYESU вернул пустой ответ')
  return parseJsonObject(String(raw))
}

async function cockpitJson({ systemPrompt, content, temperature, maxTokens, model }) {
  if (!COCKPIT_API_URL || !COCKPIT_API_KEY) throw new Error('COCKPIT_API_URL и COCKPIT_API_KEY обязательны для провайдера Cockpit')
  const response = await fetch(COCKPIT_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${COCKPIT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || COCKPIT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.1,
      max_tokens: Number(maxTokens) || 2400,
      response_format: { type: 'json_object' },
      stream: true,
    }),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) await parseResponse(response, 'Cockpit Tools')
  const raw = await readSseContent(response)
  if (!raw) throw new Error('Cockpit Tools returned an empty response')
  return parseJsonObject(raw)
}

async function buildContactSheet(images) {
  const tiles = await Promise.all(images.map((image, index) => buildTile(imageSource(image), index + 1)))
  const columns = 3
  const rows = Math.ceil(tiles.length / columns)
  const sheet = await sharp({
    create: {
      width: columns * TILE_SIZE,
      height: rows * TILE_SIZE,
      channels: 4,
      background: '#f8fafc',
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % columns) * TILE_SIZE,
    top: Math.floor(index / columns) * TILE_SIZE,
  }))).jpeg({ quality: 84 }).toBuffer()

  return `data:image/jpeg;base64,${sheet.toString('base64')}`
}

async function buildTile(source, number) {
  try {
    const bytes = await downloadImage(source)
    const image = await sharp(bytes)
      .rotate()
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'contain', background: '#ffffff' })
      .png()
      .toBuffer()
    const label = Buffer.from(`<svg width="${TILE_SIZE}" height="${TILE_SIZE}">
      <rect x="12" y="12" width="58" height="42" rx="8" fill="rgba(15,23,42,.88)"/>
      <text x="41" y="42" text-anchor="middle" font-size="25" font-weight="700" fill="white">#${number}</text>
    </svg>`)
    return sharp(image).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer()
  } catch {
    return sharp({ create: { width: TILE_SIZE, height: TILE_SIZE, channels: 4, background: '#e2e8f0' } })
      .composite([{ input: Buffer.from(`<svg width="${TILE_SIZE}" height="${TILE_SIZE}"><text x="30" y="55" font-size="28" fill="#0f172a">#${number} недоступно</text></svg>`) }])
      .png()
      .toBuffer()
  }
}

async function imageDataUrl(source) {
  const bytes = await downloadImage(source)
  const normalized = await sharp(bytes).rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  return `data:image/jpeg;base64,${normalized.toString('base64')}`
}

async function downloadImage(source) {
  if (!source) throw new Error('Image URL is empty')
  const url = new URL(source)
  if (url.protocol !== 'https:' || !MEDIA_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Image host is not allowed: ${url.hostname}`)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' })
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_IMAGE_BYTES) throw new Error('Image is too large')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image is too large')
  return bytes
}

function imageSource(image) {
  return image?.preview_url || image?.original_url || image?.thumb_url || ''
}

async function parseResponse(response, label) {
  const raw = await response.text()
  let payload = {}
  try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { message: raw.slice(0, 500) } }
  if (!response.ok) {
    const detail = payload.message
      || (typeof payload.error === 'string' ? payload.error : payload.error?.message)
      || (payload.error ? JSON.stringify(payload.error) : '')
      || `HTTP ${response.status}`
    throw new Error(`${label}: ${detail}`)
  }
  return payload
}

function parseJsonObject(value) {
  const clean = value.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try { return JSON.parse(clean) } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI provider response is not valid JSON')
    return JSON.parse(match[0])
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 2000)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

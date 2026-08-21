'use server'

import crypto from 'crypto'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import {
  buildChromoffAiUserPrompt,
  hydrateChromoffAiSettings,
  normalizeChromoffAiOutput,
  promptRulesForChromoffCategory,
  type ChromoffAiAttributeDefinition,
  type ChromoffAiSettings,
} from '@/lib/chromoff-ai'
import {
  buildBatchAiContactSheets,
  runBatchAiOpenRouter,
} from '@/lib/batch-ai'
import { byesuApiKeyStatus, byesuModelGroup, getByesuModels } from '@/lib/byesu'
import { decryptProviderApiKey, type AiProviderKind, type AiProviderRecord } from '@/lib/ai-providers'
import { applyRailsChromoffAiContent, getRailsChromoffAiContent } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'

const SETTINGS_KEYS = [
  'chromoff_ai_provider',
  'chromoff_ai_provider_id',
  'chromoff_ai_openrouter_model',
  'chromoff_ai_byesu_model',
  'chromoff_ai_temperature',
  'chromoff_ai_max_tokens',
  'chromoff_ai_concurrency',
  'chromoff_ai_system_prompt',
  'chromoff_ai_category_rules',
]

const FALLBACK_BYESU_MODELS = [
  { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', group: 'gemini' as const },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', group: 'gemini' as const },
  { value: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', group: 'openai' as const },
]

function safeJsonParse(value: unknown) {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return null
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Неизвестная ошибка')
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function chromoffMediaHosts() {
  return [
    ...(process.env.CHROMOFF_MEDIA_HOSTS || '').split(','),
    ...['CHROMOFF_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'S3_PUBLIC_DOMAIN']
      .map((key) => process.env[key]?.trim() || '')
      .flatMap((value) => {
        try { return [new URL(value).hostname] } catch { return [] }
      }),
  ]
}

async function loadChromoffAiSettings() {
  const result = await scrapingQuery('SELECT key,value FROM app_settings WHERE key=ANY($1::text[])', [SETTINGS_KEYS])
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]))
  const configuredProviders = await scrapingQuery(`
    SELECT id,name,kind,base_url,model,models,created_at,updated_at
    FROM ai_providers ORDER BY updated_at DESC,created_at DESC
  `).catch(() => ({ rows: [] }))
  const providerId = String(values.chromoff_ai_provider_id || '').trim()
  const configured = configuredProviders.rows.find((row) => String(row.id) === providerId)
  const settings = hydrateChromoffAiSettings({
    provider: configured?.kind || values.chromoff_ai_provider,
    providerId: configured ? providerId : undefined,
    activeProviderId: configured ? providerId : null,
    openrouterModel: configured?.kind === 'openrouter' ? configured.model : values.chromoff_ai_openrouter_model,
    byesuModel: configured?.kind === 'byesu' ? configured.model : values.chromoff_ai_byesu_model,
    temperature: values.chromoff_ai_temperature,
    maxTokens: values.chromoff_ai_max_tokens,
    concurrency: values.chromoff_ai_concurrency,
    systemPrompt: values.chromoff_ai_system_prompt,
    categoryRules: safeJsonParse(values.chromoff_ai_category_rules),
  })
  const fetchedByesuModels = await getByesuModels()
  const providers: AiProviderRecord[] = configuredProviders.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    kind: row.kind as AiProviderKind,
    baseUrl: String(row.base_url || ''),
    model: String(row.model || ''),
    models: Array.isArray(row.models) ? row.models : [],
    hasApiKey: true,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }))
  const byesuModels = Array.from(new Map(
    [...FALLBACK_BYESU_MODELS, ...fetchedByesuModels].map((model) => [model.value, model]),
  ).values())
  return {
    settings,
    providers,
    byesuModels,
  }
}

async function hydrateProviderCredentials(settings: ChromoffAiSettings): Promise<ChromoffAiSettings> {
  const providerId = String(settings.providerId || settings.activeProviderId || '').trim()
  if (!providerId) return settings
  const result = await scrapingQuery(
    'SELECT id,kind,name,base_url,api_key_ciphertext,model FROM ai_providers WHERE id=$1',
    [providerId],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Выбранный AI-провайдер удалён или недоступен')
  return {
    ...settings,
    provider: row.kind,
    providerName: String(row.name || ''),
    providerBaseUrl: String(row.base_url || ''),
    providerApiKey: decryptProviderApiKey(row.api_key_ciphertext),
    openrouterModel: row.kind === 'openrouter' ? String(row.model || '') : settings.openrouterModel,
    byesuModel: row.kind === 'byesu' ? String(row.model || '') : settings.byesuModel,
  }
}

function publicSettings(settings: ChromoffAiSettings) {
  const safe = { ...settings }
  delete safe.providerApiKey
  return safe
}

export async function getChromoffAiSettingsAction() {
  await requireAdmin()
  const loaded = await loadChromoffAiSettings()
  return {
    success: true,
    data: {
      ...loaded.settings,
      providers: loaded.providers,
      byesuModels: loaded.byesuModels,
    },
  }
}

export async function updateChromoffAiSettingsAction(settingsInput: Partial<ChromoffAiSettings>) {
  await requireAdmin()
  const settings = hydrateChromoffAiSettings(settingsInput)
  const requestedProviderId = String(settings.providerId || settings.activeProviderId || '').trim()
  const configured = requestedProviderId
    ? await scrapingQuery('SELECT id,kind FROM ai_providers WHERE id=$1', [requestedProviderId]).then((result) => result.rows[0])
    : null
  if (requestedProviderId && !configured) return { success: false, error: 'Провайдер не найден' }

  const values: Record<string, string> = {
    chromoff_ai_provider: configured?.kind || settings.provider,
    chromoff_ai_provider_id: requestedProviderId,
    chromoff_ai_openrouter_model: settings.openrouterModel,
    chromoff_ai_byesu_model: settings.byesuModel,
    chromoff_ai_temperature: String(settings.temperature),
    chromoff_ai_max_tokens: String(settings.maxTokens),
    chromoff_ai_concurrency: String(settings.concurrency),
    chromoff_ai_system_prompt: settings.systemPrompt,
    chromoff_ai_category_rules: JSON.stringify(settings.categoryRules),
  }

  const client = await getScrapingClient()
  try {
    const entries = Object.entries(values)
    await client.query(`
      INSERT INTO app_settings(key,value,updated_at)
      SELECT entry.key,entry.value,NOW()
      FROM UNNEST($1::text[],$2::text[]) AS entry(key,value)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
    `, [entries.map(([key]) => key), entries.map(([, value]) => value)])
    revalidatePath('/admin/chromoff/ai-seo')
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error) }
  } finally {
    client.release()
  }
}

async function ensureProviderReady(settings: ChromoffAiSettings) {
  if (settings.provider === 'byesu' && !settings.providerApiKey) {
    const group = byesuModelGroup(settings.byesuModel)
    if (!byesuApiKeyStatus()[group]) {
      throw new Error(group === 'gemini'
        ? 'Для модели нужен BYESU_GEMINI_API_KEY'
        : 'Для модели нужен BYESU_OPENAI_API_KEY')
    }
  }
  if (settings.provider === 'openrouter' && !settings.providerApiKey && !process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error('OPENROUTER_API_KEY не задан')
  }
  if (settings.provider === 'cockpit' && (!process.env.COCKPIT_API_URL?.trim() || !process.env.COCKPIT_API_KEY?.trim())) {
    throw new Error('COCKPIT_API_URL и COCKPIT_API_KEY не заданы')
  }
}

export async function startChromoffAiRunAction(listingIds: string[]) {
  await requireAdmin()
  const ids = [...new Set(listingIds.map(String).map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return { success: false, error: 'Нет товаров для обработки' }
  if (ids.length > 500) return { success: false, error: 'За один запуск можно обработать не больше 500 товаров' }

  try {
    const loaded = await loadChromoffAiSettings()
    const settings = await hydrateProviderCredentials(loaded.settings)
    const attributeDefinitions = await getCatalogAttributeDefinitions()
    await ensureProviderReady(settings)
    const runId = crypto.randomUUID()
    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      await client.query(`
        INSERT INTO chromoff_ai_runs(id,status,total_count,settings_snapshot,created_at,updated_at)
        VALUES($1,'running',$2,$3::jsonb,NOW(),NOW())
      `, [runId, ids.length, JSON.stringify(publicSettings(settings))])
      await client.query(`
        INSERT INTO chromoff_ai_items(run_id,listing_id,status,created_at,updated_at)
        SELECT $1,listing_id,'pending',NOW(),NOW() FROM UNNEST($2::text[]) AS listing_id
      `, [runId, ids])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    // ponytail: self-hosted after() keeps one queue implementation; add a leased worker only if restarts cause measurable stuck runs.
    after(() => processChromoffAiRun(runId, settings, attributeDefinitions))
    revalidatePath('/admin/chromoff/ai-seo')
    return { success: true, runId }
  } catch (error: unknown) {
    const message = errorCode(error) === '42P01'
      ? 'Схема Chromoff AI не установлена: выполните npm run db:migrate:scraping'
      : errorMessage(error)
    return { success: false, error: message }
  }
}

export async function retryChromoffAiRunAction(runId: string) {
  await requireAdmin()
  try {
    const run = await scrapingQuery('SELECT settings_snapshot FROM chromoff_ai_runs WHERE id=$1', [runId])
    if (!run.rows[0]) return { success: false, error: 'Запуск не найден' }
    const settings = await hydrateProviderCredentials(hydrateChromoffAiSettings(run.rows[0].settings_snapshot))
    const attributeDefinitions = await getCatalogAttributeDefinitions()
    await ensureProviderReady(settings)
    await scrapingQuery(`
      UPDATE chromoff_ai_items
      SET status='pending',error_message=NULL,completed_at=NULL,updated_at=NOW()
      WHERE run_id=$1
        AND (status='failed' OR (status='running' AND updated_at < NOW() - INTERVAL '10 minutes'))
    `, [runId])
    await scrapingQuery(`
      UPDATE chromoff_ai_runs
      SET status='running',failed_count=0,error_message=NULL,completed_at=NULL,updated_at=NOW()
      WHERE id=$1
    `, [runId])
    after(() => processChromoffAiRun(runId, settings, attributeDefinitions))
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: errorMessage(error) }
  }
}

export async function getChromoffAiDashboardAction(listingIds: string[] = []) {
  await requireAdmin()
  try {
    const runs = await scrapingQuery(`
      SELECT id,status,total_count,completed_count,failed_count,error_message,created_at,updated_at,completed_at
      FROM chromoff_ai_runs ORDER BY created_at DESC LIMIT 20
    `)
    const ids = [...new Set(listingIds.map(String).filter(Boolean))]
    const items = ids.length ? await scrapingQuery(`
      SELECT DISTINCT ON (listing_id)
        listing_id,run_id,status,error_message,created_at,updated_at,completed_at
      FROM chromoff_ai_items
      WHERE listing_id=ANY($1::text[])
      ORDER BY listing_id,created_at DESC
    `, [ids]) : { rows: [] }
    return { success: true, data: { runs: runs.rows, items: items.rows } }
  } catch (error: unknown) {
    if (errorCode(error) === '42P01') return { success: true, data: { runs: [], items: [] } }
    return { success: false, error: errorMessage(error), data: { runs: [], items: [] } }
  }
}

async function processChromoffAiRun(
  runId: string,
  settings: ChromoffAiSettings,
  attributeDefinitions: ChromoffAiAttributeDefinition[],
) {
  const rows = await scrapingQuery(
    "SELECT id,listing_id FROM chromoff_ai_items WHERE run_id=$1 AND status='pending' ORDER BY created_at,id",
    [runId],
  )
  let cursor = 0
  const workers = Array.from({ length: Math.min(settings.concurrency, rows.rows.length) }, async () => {
    while (cursor < rows.rows.length) {
      const item = rows.rows[cursor]
      cursor += 1
      await processChromoffAiItem(runId, item, settings, attributeDefinitions)
    }
  })
  await Promise.all(workers)
  await updateChromoffAiRunCounts(runId)
}

async function processChromoffAiItem(
  runId: string,
  item: { id: string; listing_id: string },
  settings: ChromoffAiSettings,
  attributeDefinitions: ChromoffAiAttributeDefinition[],
) {
  let attempt: number | null = null
  try {
    const claimed = await scrapingQuery(`
      UPDATE chromoff_ai_items
      SET status='running',attempts=attempts+1,updated_at=NOW()
      WHERE id=$1 AND status='pending'
      RETURNING id,attempts
    `, [item.id])
    if (!claimed.rows[0]) return
    attempt = Number(claimed.rows[0].attempts)

    const listing = await getRailsChromoffAiContent(item.listing_id)
    const photos = Array.isArray(listing.media)
      ? listing.media.map((medium) => medium.original_url || medium.preview_url).filter((url): url is string => Boolean(url))
      : Array.isArray(listing.images) ? listing.images : []
    if (!photos.length) throw new Error('У товара нет фотографий')
    const categoryPrompts = promptRulesForChromoffCategory(
      settings.categoryRules,
      listing.chromoff_category?.id,
      listing.chromoff_category?.parent_id,
    )
    const input = { ...listing, media: listing.media || photos.map((original_url) => ({ original_url })) }
    const userPrompt = buildChromoffAiUserPrompt(input, categoryPrompts, attributeDefinitions)
    const contactSheets = await buildBatchAiContactSheets(photos, { additionalHosts: chromoffMediaHosts() })
    const raw = settings.provider === 'cockpit'
      ? await runChromoffCockpit(settings, userPrompt, contactSheets)
      : await runBatchAiOpenRouter({
          settings,
          systemPrompt: settings.systemPrompt,
          userPrompt,
          contactSheets,
        })
    const normalized = normalizeChromoffAiOutput(raw, input, attributeDefinitions)
    if (!normalized.seoDescription) throw new Error('ИИ не вернул уникальное SEO-описание Chromoff')
    const updated = await applyRailsChromoffAiContent(item.listing_id, {
      name: normalized.name,
      description: normalized.description,
      catalogAttributes: normalized.attributes,
      mediaAlts: normalized.alts,
      h1: normalized.h1,
      seoDescription: normalized.seoDescription,
    })
    const completed = await scrapingQuery(`
      UPDATE chromoff_ai_items
      SET status='completed',input_snapshot=$2::jsonb,output=$3::jsonb,error_message=NULL,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND status='running' AND attempts=$4
      RETURNING id
    `, [item.id, JSON.stringify(input), JSON.stringify({ ...normalized, applied_listing: updated.id }), attempt])
    if (completed.rows[0]) await incrementChromoffAiRunCount(runId, 'completed')
  } catch (error: unknown) {
    const failed = attempt === null ? { rows: [] } : await scrapingQuery(`
      UPDATE chromoff_ai_items
      SET status='failed',error_message=$2,updated_at=NOW(),completed_at=NOW()
      WHERE id=$1 AND status='running' AND attempts=$3
      RETURNING id
    `, [item.id, errorMessage(error).slice(0, 2000), attempt])
    if (failed.rows[0]) await incrementChromoffAiRunCount(runId, 'failed')
  }
}

async function incrementChromoffAiRunCount(runId: string, status: 'completed' | 'failed') {
  const column = status === 'completed' ? 'completed_count' : 'failed_count'
  await scrapingQuery(`UPDATE chromoff_ai_runs SET ${column}=${column}+1,updated_at=NOW() WHERE id=$1`, [runId])
}

async function updateChromoffAiRunCounts(runId: string) {
  await scrapingQuery(`
    WITH counts AS (
      SELECT
        COUNT(*) FILTER (WHERE status='completed')::integer AS completed_count,
        COUNT(*) FILTER (WHERE status='failed')::integer AS failed_count,
        COUNT(*) FILTER (WHERE status IN ('pending','running'))::integer AS active_count
      FROM chromoff_ai_items WHERE run_id=$1
    )
    UPDATE chromoff_ai_runs r SET
      completed_count=counts.completed_count,
      failed_count=counts.failed_count,
      status=CASE
        WHEN counts.active_count=0
          THEN CASE WHEN counts.failed_count > 0 OR counts.completed_count=0 THEN 'failed' ELSE 'completed' END
        ELSE 'running'
      END,
      completed_at=CASE
        WHEN counts.active_count=0 THEN NOW()
        ELSE NULL
      END,
      updated_at=NOW()
    FROM counts
    WHERE r.id=$1
  `, [runId])
}

async function runChromoffCockpit(settings: ChromoffAiSettings, userPrompt: string, contactSheets: string[]) {
  const url = process.env.COCKPIT_API_URL?.trim()
  const apiKey = process.env.COCKPIT_API_KEY?.trim()
  if (!url || !apiKey) throw new Error('Cockpit не настроен')
  const content: any[] = [{ type: 'text', text: userPrompt }]
  contactSheets.forEach((sheet, index) => {
    content.push({ type: 'text', text: `Contact sheet ${index + 1}` })
    content.push({ type: 'image_url', image_url: { url: sheet } })
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.COCKPIT_MODEL || 'gpt-5.6-luna',
      messages: [{ role: 'system', content: settings.systemPrompt }, { role: 'user', content }],
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      response_format: { type: 'json_object' },
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) throw new Error(`Cockpit HTTP ${response.status}: ${await response.text()}`)
  const payload = await response.json()
  const message = payload?.choices?.[0]?.message?.content
  const text = Array.isArray(message)
    ? message.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
    : String(message || '')
  const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  return JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean)
}

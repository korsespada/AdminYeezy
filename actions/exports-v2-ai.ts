'use server'

import crypto from 'crypto'
import { revalidatePath } from 'next/cache'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'
import type { V2AlbumRole, V2DraftAlbum } from '@/lib/exports-v2-types'
import { buildExportsV2MediaPlan } from '@/lib/exports-v2-media'
import {
  buildExportsV2ContactSheet,
  buildExportsV2GroupingPrompts,
  buildExportsV2ProductPrompts,
  compactExportsV2Examples,
  EXPORTS_V2_GROUPING_OVERLAP,
  EXPORTS_V2_GROUPING_PROMPT_VERSION,
  EXPORTS_V2_GROUPING_WINDOW,
  EXPORTS_V2_PRODUCT_PROMPT_VERSION,
  exportsV2CacheHash,
  runExportsV2AiJson,
} from '@/lib/exports-v2-ai'
import { createRailsAdminProduct } from '@/lib/rails-admin'
import { getSupplierAttributeDefinition, normalizeSupplierAttributeCodes } from '@/lib/supplier-attributes'

const ALLOWED_ROLES = new Set<V2AlbumRole>([
  'PRIMARY_MEDIA', 'ON_MODEL', 'MEDIA_WITH_TEXT', 'EXTRA_MEDIA',
  'TEXT_ONLY', 'SIZE_CHART', 'COMPARISON_OR_AD', 'IGNORE',
])

const ROLE_FLAGS: Record<V2AlbumRole, { text: boolean; media: boolean; ai: boolean }> = {
  UNASSIGNED: { text: false, media: false, ai: false },
  PRIMARY_MEDIA: { text: true, media: true, ai: true },
  ON_MODEL: { text: false, media: true, ai: true },
  MEDIA_WITH_TEXT: { text: true, media: true, ai: true },
  EXTRA_MEDIA: { text: false, media: true, ai: true },
  TEXT_ONLY: { text: true, media: false, ai: true },
  SIZE_CHART: { text: true, media: false, ai: true },
  COMPARISON_OR_AD: { text: false, media: false, ai: false },
  IGNORE: { text: false, media: false, ai: false },
}

function sumUsage(target: Record<string, number>, usage: Record<string, any> = {}) {
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) {
    target[key] = Number(target[key] || 0) + Number(usage[key] || 0)
  }
}

async function loadRunAiContext(runId: string) {
  const result = await scrapingQuery(`
    SELECT
      r.id, r.supplier_id, r.name,
      s.name AS supplier_name,
      s.ai_instructions,
      s.ai_cache_enabled,
      s.ai_photo_enabled,
      s.ai_parallel_enabled,
      s.ai_parallel_count,
      s.default_price,
      s.default_gender,
      s.default_brand,
      s.default_category,
      s.default_subcategory,
      s.default_attributes,
      s.max_on_model_media,
      s.post_process_script,
      s.post_process_description,
      COALESCE((SELECT value FROM app_settings WHERE key='general_ai_rules'), '') AS general_ai_rules,
      COALESCE(
        (SELECT value FROM app_settings WHERE key='exports_v2_grouping_model'),
        (SELECT value FROM app_settings WHERE key='selected_ai_model'),
        'google/gemini-2.0-flash-lite:free'
      ) AS grouping_model,
      COALESCE(
        (SELECT value FROM app_settings WHERE key='exports_v2_product_model'),
        (SELECT value FROM app_settings WHERE key='selected_ai_model'),
        'google/gemini-2.0-flash-lite:free'
      ) AS product_model
    FROM scraping_v2_runs r
    JOIN suppliers s ON s.id=r.supplier_id
    WHERE r.id=$1 AND r.status <> 'ARCHIVED'
  `, [runId])
  return result.rows[0] || null
}

function normalizeGroupingResponse(data: any, windowAlbums: any[], coreIds: Set<string>, claimed: Set<string>) {
  const position = new Map(windowAlbums.map((album, index) => [String(album.id), index]))
  const byExternalId = new Map(windowAlbums.map((album) => [String(album.external_id), album]))
  const groups: Array<{ albums: any[]; roles: Record<string, V2AlbumRole>; confidence: number; reason: string }> = []

  for (const rawGroup of Array.isArray(data?.groups) ? data.groups : []) {
    const externalIds: string[] = [...new Set<string>((rawGroup?.album_ids || []).map((id: unknown) => String(id)))]
    const albums = externalIds.map((id) => byExternalId.get(id)).filter(Boolean) as any[]
    albums.sort((left, right) => Number(position.get(String(left.id))) - Number(position.get(String(right.id))))
    if (albums.length === 0) continue
    if (!coreIds.has(String(albums[0].id))) continue
    if (albums.some((album) => claimed.has(String(album.id)))) continue

    const roles: Record<string, V2AlbumRole> = {}
    let primaryAssigned = false
    for (const album of albums) {
      const requested = String(rawGroup?.roles?.[album.external_id] || '') as V2AlbumRole
      let role: V2AlbumRole = ALLOWED_ROLES.has(requested) ? requested : 'MEDIA_WITH_TEXT'
      if (role === 'PRIMARY_MEDIA') {
        if (primaryAssigned) role = 'MEDIA_WITH_TEXT'
        primaryAssigned = true
      }
      roles[String(album.id)] = role
    }
    if (!primaryAssigned) roles[String(albums[0].id)] = 'PRIMARY_MEDIA'
    albums.forEach((album) => claimed.add(String(album.id)))
    groups.push({
      albums,
      roles,
      confidence: Math.min(1, Math.max(0, Number(rawGroup?.confidence || 0))),
      reason: String(rawGroup?.reason || '').slice(0, 1200),
    })
  }
  return groups
}

export async function runExportsV2GroupingAiAction(runId: string): Promise<ActionResponse> {
  await requireAdmin()
  const context = await loadRunAiContext(runId)
  if (!context) return { success: false, error: 'Выгрузка V2 не найдена' }

  const jobId = crypto.randomUUID()
  const model = String(context.grouping_model)
  await scrapingQuery(`
    INSERT INTO scraping_v2_ai_jobs (id, run_id, supplier_id, stage, status, model, prompt_version)
    VALUES ($1,$2,$3,'GROUPING','RUNNING',$4,$5)
  `, [jobId, runId, context.supplier_id, model, EXPORTS_V2_GROUPING_PROMPT_VERSION])

  try {
    const albumsResult = await scrapingQuery(`
      WITH latest_pass AS (
        SELECT id FROM scraping_v2_scrape_passes
        WHERE run_id=$1 AND status='COMPLETED'
        ORDER BY completed_at DESC LIMIT 1
      )
      SELECT
        a.id, a.external_id, a.name, a.description, a.photos, a.media,
        COALESCE(o.source_position, a.source_order) AS source_order,
        jsonb_array_length(a.photos)::int AS photo_count,
        jsonb_array_length(a.media)::int AS media_count,
        COALESCE(a.photos->>0, a.media->0->>'preview_url') AS preview_media,
        EXISTS (SELECT 1 FROM jsonb_array_elements(a.media) item WHERE item->>'type'='video') AS has_video
      FROM scraping_v2_albums a
      LEFT JOIN scraping_v2_draft_albums da ON da.album_id=a.id
      LEFT JOIN scraping_v2_album_observations o
        ON o.album_id=a.id AND o.pass_id=(SELECT id FROM latest_pass)
      WHERE a.run_id=$1 AND da.album_id IS NULL
      ORDER BY COALESCE(o.source_position, a.source_order)
    `, [runId])
    const albums = albumsResult.rows
    if (albums.length === 0) throw new Error('Нет неразмеченных альбомов для группировки')

    const exampleRows = await scrapingQuery(`
      SELECT example
      FROM scraping_v2_training_examples
      WHERE supplier_id=$1
      ORDER BY created_at DESC
      LIMIT 10
    `, [context.supplier_id])
    const examples = compactExportsV2Examples(exampleRows.rows)
    const claimed = new Set<string>()
    const proposedGroups: ReturnType<typeof normalizeGroupingResponse> = []
    const usage: Record<string, number> = {}

    for (let coreStart = 0; coreStart < albums.length; coreStart += EXPORTS_V2_GROUPING_WINDOW) {
      const core = albums.slice(coreStart, coreStart + EXPORTS_V2_GROUPING_WINDOW)
      const windowStart = Math.max(0, coreStart - EXPORTS_V2_GROUPING_OVERLAP)
      const windowEnd = Math.min(albums.length, coreStart + EXPORTS_V2_GROUPING_WINDOW + EXPORTS_V2_GROUPING_OVERLAP)
      const windowAlbums = albums.slice(windowStart, windowEnd)
      const prompts = buildExportsV2GroupingPrompts({
        albums: windowAlbums,
        examples,
        scriptDescription: String(context.post_process_description || ''),
      })
      const contactSheet = await buildExportsV2ContactSheet(windowAlbums)
      const response = await runExportsV2AiJson({
        model,
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        imageDataUrl: contactSheet,
      })
      sumUsage(usage, response.usage)
      proposedGroups.push(...normalizeGroupingResponse(
        response.data,
        windowAlbums,
        new Set(core.map((album) => String(album.id))),
        claimed,
      ))
    }

    const client = await getScrapingClient()
    let created = 0
    try {
      await client.query('BEGIN')
      for (const group of proposedGroups) {
        const ids = group.albums.map((album) => String(album.id))
        const available = await client.query(`
          SELECT a.id
          FROM scraping_v2_albums a
          LEFT JOIN scraping_v2_draft_albums da ON da.album_id=a.id
          WHERE a.run_id=$1 AND a.id=ANY($2::text[]) AND da.album_id IS NULL
          FOR UPDATE OF a
        `, [runId, ids])
        if (available.rows.length !== ids.length) continue

        const draftId = crypto.randomUUID()
        await client.query(`
          INSERT INTO scraping_v2_product_drafts (
            id, run_id, supplier_id, status, name, origin, ai_confidence, ai_group_reason
          ) VALUES ($1,$2,$3,'NEEDS_REVIEW',$4,'AI',$5,$6)
        `, [draftId, runId, context.supplier_id, `AI · Товар из ${ids.length} альб.`, group.confidence, group.reason])
        for (const [index, album] of group.albums.entries()) {
          const role = group.roles[String(album.id)] || (index === 0 ? 'PRIMARY_MEDIA' : 'UNASSIGNED')
          const flags = ROLE_FLAGS[role]
          await client.query(`
            INSERT INTO scraping_v2_draft_albums (
              draft_id, album_id, role, use_text, use_media, use_photos, use_for_ai, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)
          `, [draftId, album.id, role, flags.text, flags.media, flags.ai, index])
        }
        created += 1
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    await scrapingQuery(`
      UPDATE scraping_v2_ai_jobs
      SET status='COMPLETED', input_count=$2, output_count=$3, usage=$4::jsonb,
          result=$5::jsonb, completed_at=NOW()
      WHERE id=$1
    `, [jobId, albums.length, created, JSON.stringify(usage), JSON.stringify({ created, claimed: claimed.size })])
    revalidatePath(`/admin/exports-v2/${runId}`)
    revalidatePath('/admin/exports-v2')
    return { success: true, data: { created, analyzed: albums.length, model, usage } }
  } catch (error: any) {
    await scrapingQuery(`
      UPDATE scraping_v2_ai_jobs SET status='FAILED', error=$2, completed_at=NOW() WHERE id=$1
    `, [jobId, String(error.message || error).slice(0, 4000)]).catch(() => undefined)
    return { success: false, error: error.message }
  }
}

function normalizeProductResult(raw: any, context: any, validIds: Record<string, Set<string>>, attributeCodes: string[]) {
  const result = raw?.product || raw || {}
  const chooseId = (kind: string, value: unknown, fallback: unknown) => {
    const requested = String(value || '')
    if (requested && validIds[kind]?.has(requested)) return requested
    const defaultValue = String(fallback || '')
    return validIds[kind]?.has(defaultValue) ? defaultValue : null
  }
  const attributes: Record<string, any> = {}
  for (const code of attributeCodes) {
    const value = result.attributes?.[code]
    if (value !== undefined && value !== null && value !== '') attributes[code] = value
  }
  const gender = ['male', 'female', 'unisex'].includes(String(result.gender))
    ? String(result.gender)
    : (['male', 'female', 'unisex'].includes(String(context.default_gender)) ? context.default_gender : null)
  return {
    name: String(result.name || '').trim().slice(0, 250),
    description: String(result.description || '').trim().slice(0, 8000),
    price: Number.isFinite(Number(result.price)) && Number(result.price) > 0
      ? Number(result.price)
      : Number(context.default_price || 0),
    brand: chooseId('brand', result.brand, context.default_brand),
    category: chooseId('category', result.category, context.default_category),
    subcategory: chooseId('subcategory', result.subcategory, context.default_subcategory),
    gender,
    attributes,
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

export async function runExportsV2ProductAiAction(runId: string): Promise<ActionResponse> {
  await requireAdmin()
  const context = await loadRunAiContext(runId)
  if (!context) return { success: false, error: 'Выгрузка V2 не найдена' }
  const model = String(context.product_model)
  const jobId = crypto.randomUUID()
  await scrapingQuery(`
    INSERT INTO scraping_v2_ai_jobs (id, run_id, supplier_id, stage, status, model, prompt_version)
    VALUES ($1,$2,$3,'PRODUCT_PROCESSING','RUNNING',$4,$5)
  `, [jobId, runId, context.supplier_id, model, EXPORTS_V2_PRODUCT_PROMPT_VERSION])

  try {
    const draftsResult = await scrapingQuery(`
      SELECT id, name
      FROM scraping_v2_product_drafts
      WHERE run_id=$1 AND status IN ('GROUPED', 'READY_FOR_AI')
      ORDER BY created_at
    `, [runId])
    const drafts = draftsResult.rows
    if (drafts.length === 0) throw new Error('Нет подтверждённых групп для обработки')

    const lookupsResult = await scrapingQuery(`
      SELECT entity_type, canonical_id AS id, name, canonical_parent_id AS parent_id
      FROM catalog_id_mappings
      ORDER BY entity_type, name
    `)
    const lookups = {
      brands: lookupsResult.rows.filter((row) => row.entity_type === 'brand').map((row) => ({ id: row.id, name: row.name })),
      categories: lookupsResult.rows.filter((row) => row.entity_type === 'category').map((row) => ({ id: row.id, name: row.name })),
      subcategories: lookupsResult.rows.filter((row) => row.entity_type === 'subcategory').map((row) => ({ id: row.id, name: row.name, parent_id: row.parent_id })),
    }
    const validIds = {
      brand: new Set<string>(lookups.brands.map((item) => String(item.id))),
      category: new Set<string>(lookups.categories.map((item) => String(item.id))),
      subcategory: new Set<string>(lookups.subcategories.map((item) => String(item.id))),
    }
    const attributeCodes = normalizeSupplierAttributeCodes(context.default_attributes)
    const attributeHints = attributeCodes.map((code) => {
      const definition = getSupplierAttributeDefinition(code)
      return { code, label: definition?.label || code, description: definition?.description || '' }
    })
    const usage: Record<string, number> = {}
    let cacheHits = 0
    const errors: string[] = []
    const concurrency = context.ai_parallel_enabled ? Math.min(10, Math.max(1, Number(context.ai_parallel_count || 5))) : 1

    const results = await mapWithConcurrency(drafts, concurrency, async (draft) => {
      try {
        const albumsResult = await scrapingQuery(`
          SELECT
            a.id, a.external_id, a.name, a.description, a.photos, a.media, a.source_order,
            da.sort_order AS draft_sort_order, da.role, da.use_text, da.use_media,
            da.use_photos, da.use_for_ai
          FROM scraping_v2_draft_albums da
          JOIN scraping_v2_albums a ON a.id=da.album_id
          WHERE da.draft_id=$1
          ORDER BY da.sort_order
        `, [draft.id])
        const albums = albumsResult.rows as V2DraftAlbum[]
        const primary = albums.find((album) => album.role === 'PRIMARY_MEDIA')
        if (!primary) throw new Error('нет основных медиа')
        const sources = albums.filter((album) => album.use_for_ai).map((album) => ({
          external_id: album.external_id,
          role: album.role,
          name: album.name,
          description: album.use_text ? album.description : '',
          media_count: album.media?.length || album.photos?.length || 0,
        }))
        const prompts = buildExportsV2ProductPrompts({
          globalRules: context.general_ai_rules,
          supplierInstructions: context.ai_instructions,
          supplierDefaults: {
            default_price: context.default_price,
            default_gender: context.default_gender,
            default_brand: context.default_brand,
            default_category: context.default_category,
            default_subcategory: context.default_subcategory,
          },
          attributeHints,
          lookups,
          sources,
        })
        const visualInputs = context.ai_photo_enabled
          ? [primary, ...albums.filter((album) => album.role === 'SIZE_CHART')]
            .map((album) => album.media?.[0]?.preview_url || album.photos?.[0] || null)
            .filter(Boolean)
            .slice(0, 4) as string[]
          : []
        const cacheHash = exportsV2CacheHash({
          stage: 'exports-v2-product',
          version: EXPORTS_V2_PRODUCT_PROMPT_VERSION,
          model,
          supplier_id: context.supplier_id,
          supplier_instructions: context.ai_instructions,
          general_rules: context.general_ai_rules,
          defaults: {
            price: context.default_price,
            gender: context.default_gender,
            brand: context.default_brand,
            category: context.default_category,
            subcategory: context.default_subcategory,
          },
          attributeCodes,
          sources: sources.map((source) => ({
            external_id: source.external_id,
            role: source.role,
            name: String(source.name || '').trim().toLowerCase(),
            description: String(source.description || '').trim().toLowerCase(),
            media_count: source.media_count,
          })),
          visual_inputs: visualInputs,
        })
        let rawResult: any
        let itemUsage: Record<string, any> = {}
        let cacheHit = false
        if (context.ai_cache_enabled) {
          const cached = await scrapingQuery('SELECT result FROM ai_cache WHERE hash=$1', [cacheHash])
          rawResult = cached.rows[0]?.result
          if (rawResult) {
            cacheHit = true
            cacheHits += 1
          }
        }
        if (!rawResult) {
          const response = await runExportsV2AiJson({
            model,
            systemPrompt: prompts.systemPrompt,
            userPrompt: prompts.userPrompt,
            imageUrls: visualInputs,
          })
          rawResult = response.data
          itemUsage = response.usage
          sumUsage(usage, response.usage)
          if (context.ai_cache_enabled) {
            await scrapingQuery(`
              INSERT INTO ai_cache (hash, result, created_at, updated_at)
              VALUES ($1,$2::jsonb,NOW(),NOW())
              ON CONFLICT (hash) DO UPDATE SET result=EXCLUDED.result, updated_at=NOW()
            `, [cacheHash, JSON.stringify(rawResult)])
          }
        }
        const product = normalizeProductResult(rawResult, context, validIds, attributeCodes)
        if (!product.name) throw new Error('ИИ не сформировал название')
        const mediaPlan = buildExportsV2MediaPlan(albums, Number(context.max_on_model_media || 5))
        const externalId = `v2-${context.supplier_id}-${primary.external_id}`
        const aiProduct = {
          ...product,
          external_id: externalId,
          media: mediaPlan.items,
          source_album_ids: albums.map((album) => album.external_id),
        }
        await scrapingQuery(`
          UPDATE scraping_v2_product_drafts
          SET status='AI_PROCESSED', external_id=$2, ai_product=$3::jsonb,
              ai_usage=$4::jsonb, updated_at=NOW()
          WHERE id=$1 AND status IN ('GROUPED','READY_FOR_AI')
        `, [draft.id, externalId, JSON.stringify(aiProduct), JSON.stringify({ ...itemUsage, cache_hit: cacheHit })])
        return { ok: true, id: draft.id }
      } catch (error: any) {
        errors.push(`${draft.name}: ${error.message}`)
        return { ok: false, id: draft.id }
      }
    })

    const processed = results.filter((result) => result.ok).length
    await scrapingQuery(`
      UPDATE scraping_v2_ai_jobs
      SET status=$2, input_count=$3, output_count=$4, cache_hits=$5,
          usage=$6::jsonb, result=$7::jsonb, error=$8, completed_at=NOW()
      WHERE id=$1
    `, [jobId, processed > 0 ? 'COMPLETED' : 'FAILED', drafts.length, processed, cacheHits,
      JSON.stringify(usage), JSON.stringify({ processed, errors }), errors.length ? errors.join('\n').slice(0, 4000) : null])
    revalidatePath(`/admin/exports-v2/${runId}`)
    return { success: processed > 0, data: { processed, failed: errors.length, cacheHits, model, usage }, error: errors.length ? errors.join('\n') : undefined }
  } catch (error: any) {
    await scrapingQuery(`UPDATE scraping_v2_ai_jobs SET status='FAILED', error=$2, completed_at=NOW() WHERE id=$1`, [jobId, String(error.message || error).slice(0, 4000)]).catch(() => undefined)
    return { success: false, error: error.message }
  }
}

export async function updateExportsV2SupplierAiSettingsAction(runId: string, input: {
  ai_instructions: string
  ai_cache_enabled: boolean
  ai_photo_enabled: boolean
  post_process_description: string
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await scrapingQuery(`
      UPDATE suppliers s
      SET ai_instructions=$2, ai_cache_enabled=$3, ai_photo_enabled=$4,
          post_process_description=$5, updated_at=NOW()
      FROM scraping_v2_runs r
      WHERE r.id=$1 AND r.supplier_id=s.id
      RETURNING s.id
    `, [runId, String(input.ai_instructions || '').slice(0, 20_000), Boolean(input.ai_cache_enabled),
      Boolean(input.ai_photo_enabled), String(input.post_process_description || '').slice(0, 20_000)])
    if (!result.rows[0]) return { success: false, error: 'Поставщик не найден' }
    revalidatePath(`/admin/exports-v2/${runId}`)
    revalidatePath('/admin/suppliers')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function confirmExportsV2ProductAction(draftId: string, product: Record<string, any>): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const name = String(product.name || '').trim()
    if (!name) return { success: false, error: 'Название товара обязательно' }
    const existingResult = await scrapingQuery(`
      SELECT ai_product FROM scraping_v2_product_drafts
      WHERE id=$1 AND status='AI_PROCESSED'
    `, [draftId])
    const existing = existingResult.rows[0]?.ai_product
    if (!existing) return { success: false, error: 'Карточка не найдена или уже подтверждена' }
    const editable = {
      name,
      description: String(product.description || '').slice(0, 8000),
      price: Math.max(0, Number(product.price || 0)),
      brand: product.brand ? String(product.brand) : null,
      category: product.category ? String(product.category) : null,
      subcategory: product.subcategory ? String(product.subcategory) : null,
      gender: ['male', 'female', 'unisex'].includes(String(product.gender)) ? String(product.gender) : null,
      attributes: product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes) ? product.attributes : {},
    }
    const result = await scrapingQuery(`
      UPDATE scraping_v2_product_drafts
      SET ai_product=$2::jsonb, status='READY_TO_PUSH', updated_at=NOW()
      WHERE id=$1 AND status='AI_PROCESSED'
      RETURNING run_id
    `, [draftId, JSON.stringify({ ...existing, ...editable })])
    const runId = result.rows[0]?.run_id
    if (!runId) return { success: false, error: 'Карточка не найдена или уже подтверждена' }
    revalidatePath(`/admin/exports-v2/${runId}`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function pushExportsV2ProductsAction(runId: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const draftsResult = await scrapingQuery(`
      SELECT id, supplier_id, external_id, ai_product
      FROM scraping_v2_product_drafts
      WHERE run_id=$1 AND status='READY_TO_PUSH'
      ORDER BY created_at
    `, [runId])
    if (draftsResult.rows.length === 0) return { success: false, error: 'Нет подтверждённых карточек для пуша' }

    const errors: string[] = []
    let pushed = 0
    for (const draft of draftsResult.rows) {
      const product = draft.ai_product || {}
      try {
        const formData = new FormData()
        formData.set('productId', String(product.external_id || draft.external_id || draft.id))
        formData.set('name', String(product.name || ''))
        formData.set('description', String(product.description || ''))
        formData.set('price', String(Number(product.price || 0)))
        formData.set('status', 'active')
        if (product.brand) formData.set('brand', String(product.brand))
        if (product.category) formData.set('category', String(product.category))
        if (product.subcategory) formData.set('subcategory', String(product.subcategory))
        if (product.gender) formData.set('gender', String(product.gender))
        formData.set('catalog_attributes', JSON.stringify(product.attributes || {}))
        const videos = (product.media || []).filter((item: any) => item.type === 'video')
        formData.set('productMetadata', JSON.stringify({
          exports_v2_run_id: runId,
          exports_v2_draft_id: draft.id,
          supplier_id: draft.supplier_id,
          source_album_ids: product.source_album_ids || [],
          source_videos: videos.map((item: any) => item.url),
        }))
        formData.set('media', JSON.stringify((product.media || [])
          .filter((item: any) => item.type !== 'video')
          .map((item: any) => ({
            original_url: item.url,
            preview_url: item.preview_url || item.url,
            thumb_url: item.preview_url || item.url,
            sort_order: item.sort_order,
            processing_status: 'processed',
          }))))
        const railsProduct = await createRailsAdminProduct(formData)
        await scrapingQuery(`
          UPDATE scraping_v2_product_drafts
          SET status='PUSHED', pushed_product_id=$2, pushed_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND status='READY_TO_PUSH'
        `, [draft.id, String(railsProduct.id || '')])
        pushed += 1
      } catch (error: any) {
        errors.push(`${product.name || draft.id}: ${error.message}`)
      }
    }
    if (pushed > 0) {
      await scrapingQuery('UPDATE scraping_v2_runs SET production_push_enabled=TRUE, updated_at=NOW() WHERE id=$1', [runId])
    }
    revalidatePath(`/admin/exports-v2/${runId}`)
    revalidatePath('/admin/exports-v2')
    return { success: errors.length === 0, data: { pushed, failed: errors.length }, error: errors.length ? errors.join('\n') : undefined }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

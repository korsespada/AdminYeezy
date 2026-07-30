'use server'

import crypto from 'crypto'
import sharp from 'sharp'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'
import {
  DEFAULT_BATCH_AI_SYSTEM_PROMPT,
  buildBatchAiContactSheets,
  buildBatchAiUserPrompt,
  matchingPriceRule,
  normalizeBatchAiOutput,
  runBatchAiOpenRouter,
  runBatchAiOpenRouterRefinement,
  type BatchAiProvider,
  type BatchAiSettings,
} from '@/lib/batch-ai'
import {
  createRailsCatalogSubcategory,
  getRailsCatalogAttributeRegistry,
  getRailsCatalogLookups,
  syncRailsCatalogAttributeRegistry,
  upsertRailsCatalogAttributeValue,
} from '@/lib/rails-admin'
import { recordBatchSnapshot } from '@/lib/batch-snapshots'
import { normalizeProductsCatalogReferences, type CatalogIdMapping } from '@/lib/catalog-reference-normalizer'
import { uploadToS3 } from '@/lib/s3'
import {
  canonicalColorFamilyKey,
  reconcileBatchColorFamilySuggestions,
  reconcileKnownAttributeSuggestions,
  reconcileBatchSubcategorySuggestions,
  saveBatchAiSuggestions,
} from '@/lib/batch-ai-suggestions'

const SETTINGS_KEYS = [
  'batch_ai_provider',
  'batch_ai_openrouter_model',
  'batch_ai_temperature',
  'batch_ai_max_tokens',
  'batch_ai_concurrency',
  'batch_ai_system_prompt',
]

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function getBatchAiSettingsAction() {
  await requireAdmin()
  const result = await scrapingQuery('SELECT key, value FROM app_settings WHERE key=ANY($1::text[])', [SETTINGS_KEYS])
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]))
  const provider: BatchAiProvider = values.batch_ai_provider === 'cockpit' ? 'cockpit' : 'openrouter'
  const worker = await scrapingQuery(`
    SELECT worker_id, provider, model, heartbeat_at, metadata,
           heartbeat_at > NOW() - INTERVAL '30 seconds' AS available
    FROM batch_ai_worker_state
    WHERE provider='cockpit'
    ORDER BY heartbeat_at DESC LIMIT 1
  `).catch(() => ({ rows: [] }))
  return {
    success: true,
    data: {
      provider,
      openrouterModel: values.batch_ai_openrouter_model || 'google/gemini-2.5-flash',
      temperature: finiteNumber(values.batch_ai_temperature, 0.1),
      maxTokens: Math.max(1000, finiteNumber(values.batch_ai_max_tokens, 5000)),
      concurrency: Math.max(1, Math.min(10, Math.round(finiteNumber(values.batch_ai_concurrency, 5)))),
      systemPrompt: values.batch_ai_system_prompt || DEFAULT_BATCH_AI_SYSTEM_PROMPT,
      cockpitWorker: worker.rows[0] || null,
    },
  }
}

export async function updateBatchAiSettingsAction(settings: BatchAiSettings) {
  await requireAdmin()
  const provider: BatchAiProvider = settings.provider === 'cockpit' ? 'cockpit' : 'openrouter'
  const values: Record<string, string> = {
    batch_ai_provider: provider,
    batch_ai_openrouter_model: String(settings.openrouterModel || '').trim() || 'google/gemini-2.5-flash',
    batch_ai_temperature: String(Math.max(0, Math.min(2, finiteNumber(settings.temperature, 0.1)))),
    batch_ai_max_tokens: String(Math.max(1000, Math.min(20000, Math.round(finiteNumber(settings.maxTokens, 5000))))),
    batch_ai_concurrency: String(Math.max(1, Math.min(10, Math.round(finiteNumber(settings.concurrency, 5))))),
    batch_ai_system_prompt: String(settings.systemPrompt || '').trim() || DEFAULT_BATCH_AI_SYSTEM_PROMPT,
  }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(values)) {
      await client.query(`
        INSERT INTO app_settings(key, value, updated_at) VALUES($1,$2,NOW())
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
      `, [key, value])
    }
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    revalidatePath('/admin/ai-rules')
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function getExportFoldersAction() {
  await requireAdmin()
  const result = await scrapingQuery(`
    SELECT f.*, COUNT(b.id)::int AS batches_count
    FROM export_folders f
    LEFT JOIN scraping_batches b ON b.folder_id=f.id AND b.stage <> 'ADMIN_DELETED'
    GROUP BY f.id ORDER BY f.created_at DESC
  `)
  return { success: true, data: result.rows }
}

export async function createExportFolderAction(name: string) {
  await requireAdmin()
  const clean = name.trim()
  if (!clean) return { success: false, error: 'Введите название папки' }
  const id = crypto.randomUUID()
  const result = await scrapingQuery(
    'INSERT INTO export_folders(id,name) VALUES($1,$2) RETURNING *',
    [id, clean.slice(0, 160)],
  )
  revalidatePath('/admin/batches')
  return { success: true, data: result.rows[0] }
}

export async function renameExportFolderAction(id: string, name: string) {
  await requireAdmin()
  const clean = name.trim()
  if (!clean) return { success: false, error: 'Введите название папки' }
  await scrapingQuery('UPDATE export_folders SET name=$2, updated_at=NOW() WHERE id=$1', [id, clean.slice(0, 160)])
  revalidatePath('/admin/batches')
  return { success: true }
}

export async function deleteExportFolderAction(id: string) {
  await requireAdmin()
  await scrapingQuery('DELETE FROM export_folders WHERE id=$1', [id])
  revalidatePath('/admin/batches')
  return { success: true }
}

export async function moveBatchToFolderAction(batchId: string, folderId: string | null) {
  await requireAdmin()
  await scrapingQuery('UPDATE scraping_batches SET folder_id=$2, updated_at=NOW() WHERE id=$1', [batchId, folderId || null])
  revalidatePath('/admin/batches')
  return { success: true }
}

export async function getSupplierPriceRulesAction(supplierId: number) {
  await requireAdmin()
  const result = await scrapingQuery(
    'SELECT * FROM supplier_price_rules WHERE supplier_id=$1 ORDER BY priority DESC, id',
    [supplierId],
  )
  return { success: true, data: result.rows }
}

export async function saveSupplierPriceRulesAction(supplierId: number, rules: any[]) {
  await requireAdmin()
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM supplier_price_rules WHERE supplier_id=$1', [supplierId])
    for (const [index, rule] of rules.entries()) {
      const price = finiteNumber(rule.price, 0)
      if (price < 0) throw new Error(`Правило ${index + 1}: цена не может быть отрицательной`)
      const ruleKey = String(rule.rule_key || `rule_${crypto.randomUUID()}`).trim().slice(0, 100)
      const referenceImages = Array.isArray(rule.reference_images)
        ? [...new Set(rule.reference_images.map(String).filter((url: string) => /^https:\/\//i.test(url)))].slice(0, 9)
        : []
      await client.query(`
        INSERT INTO supplier_price_rules(supplier_id,name,priority,conditions,price,enabled,rule_key,visual_hint,reference_images)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
      `, [
        supplierId,
        String(rule.name || `Правило ${index + 1}`).slice(0, 160),
        Math.round(finiteNumber(rule.priority, 0)),
        JSON.stringify(rule.conditions || {}),
        price,
        rule.enabled !== false,
        ruleKey,
        String(rule.visual_hint || '').trim().slice(0, 2000) || null,
        JSON.stringify(referenceImages),
      ])
    }
    await client.query('COMMIT')
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function uploadPriceRuleReferenceAction(supplierId: number, formData: FormData) {
  await requireAdmin()
  const file = formData.get('file')
  if (!(file instanceof File)) return { success: false, error: 'Файл не выбран' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return { success: false, error: 'Поддерживаются JPG, PNG и WebP' }
  }
  if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
    return { success: false, error: 'Размер фотографии должен быть не больше 12 МБ' }
  }
  try {
    const normalized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    const url = await uploadToS3(`supplier-price-rules/${supplierId}/${crypto.randomUUID()}.jpg`, normalized, 'image/jpeg')
    return { success: true, data: { url } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

async function loadSettings(): Promise<BatchAiSettings> {
  const result = await getBatchAiSettingsAction()
  return result.data as BatchAiSettings
}

async function snapshotBatch(batchId: string, stage: string, label: string, settings: any = {}) {
  return recordBatchSnapshot(batchId, stage, label, settings)
}

function priceRuleHints(rules: any[]) {
  return rules.map((rule) => ({
    rule_key: String(rule.rule_key || `rule_${rule.id}`),
    name: String(rule.name || ''),
    conditions: rule.conditions || {},
    visual_hint: String(rule.visual_hint || ''),
    reference_images: Array.isArray(rule.reference_images) ? rule.reference_images.map(String).slice(0, 9) : [],
    price: Number(rule.price || 0),
    priority: Number(rule.priority || 0),
  }))
}

async function syncCurrentRailsCatalogMappings() {
  try {
    const catalog = await getRailsCatalogLookups()
    const rows = [
      ...catalog.brands.map((item: any) => ({ entity_type: 'brand', id: String(item.id), name: String(item.name || ''), parent_id: '' })),
      ...catalog.categories.map((item: any) => ({ entity_type: 'category', id: String(item.id), name: String(item.name || ''), parent_id: '' })),
      ...catalog.subcategories.map((item: any) => ({
        entity_type: 'subcategory',
        id: String(item.id),
        name: String(item.name || ''),
        parent_id: String(item.category || item.parent_id || ''),
      })),
    ]
    if (!rows.length) return
    await scrapingQuery(`
      INSERT INTO catalog_id_mappings(entity_type,legacy_id,canonical_id,name,canonical_parent_id,updated_at)
      SELECT entity_type,id,id,name,NULLIF(parent_id,''),NOW()
      FROM jsonb_to_recordset($1::jsonb)
        AS x(entity_type text,id text,name text,parent_id text)
      ON CONFLICT(entity_type,canonical_id) DO UPDATE SET
        name=EXCLUDED.name,
        canonical_parent_id=EXCLUDED.canonical_parent_id,
        updated_at=NOW()
    `, [JSON.stringify(rows)])
  } catch (error) {
    console.warn('Не удалось обновить справочник Rails перед AI-обработкой', error)
  }
}

async function batchContext(batchId: string, mode: 'sample' | 'full' | 'retry', productId?: number) {
  await syncCurrentRailsCatalogMappings()
  const batch = await scrapingQuery(`
    SELECT b.*, s.ai_instructions, s.ai_photo_instructions, s.ai_photo_models, s.default_price, s.ai_photo_enabled, s.ai_deep_search_enabled,
           s.ai_parallel_enabled, s.allowed_brand_ids, s.allowed_category_ids, s.allowed_subcategory_ids
    FROM scraping_batches b JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=$1
  `, [batchId])
  if (!batch.rows[0]) throw new Error('Выгрузка не найдена')
  let predicate = ''
  const params: any[] = [batchId]
  if (mode === 'sample') predicate = 'AND COALESCE(ai_processed,false)=false ORDER BY random() LIMIT 10'
  if (mode === 'full') predicate = 'AND COALESCE(ai_processed,false)=false ORDER BY source_position ASC NULLS LAST, id'
  if (mode === 'retry') {
    params.push(productId)
    predicate = `AND id=$${params.length} ORDER BY id`
  }
  const products = await scrapingQuery(`SELECT * FROM products WHERE batch_id=$1 ${predicate}`, params)
  const mappings = await scrapingQuery(`
    SELECT entity_type, canonical_id AS id, name, canonical_parent_id AS parent_id
    FROM catalog_id_mappings ORDER BY entity_type, name
  `)
  const definitions = await getCatalogAttributeDefinitions()
  const priceRules = await scrapingQuery(
    'SELECT * FROM supplier_price_rules WHERE supplier_id=$1 AND enabled=true ORDER BY priority DESC,id',
    [batch.rows[0].supplier_id],
  )
  const allowedIds = (value: unknown) => Array.isArray(value) ? new Set(value.map(String)) : new Set<string>()
  const allowedBrands = allowedIds(batch.rows[0].allowed_brand_ids)
  const allowedCategories = allowedIds(batch.rows[0].allowed_category_ids)
  const brands = mappings.rows.filter((row) => row.entity_type === 'brand')
  const categories = mappings.rows.filter((row) => row.entity_type === 'category')
  const subcategories = mappings.rows.filter((row) => row.entity_type === 'subcategory')
  return {
    batch: batch.rows[0], products: products.rows, definitions,
    brands: allowedBrands.size ? brands.filter((row) => allowedBrands.has(String(row.id))) : brands,
    categories: allowedCategories.size ? categories.filter((row) => allowedCategories.has(String(row.id))) : categories,
    // Всегда передаём полный справочник подкатегорий: ограничения поставщика помогают
    // классификации, но не должны заставлять AI повторно предлагать уже существующее.
    subcategories,
    priceRules: priceRules.rows,
  }
}

export async function startBatchAiAction(batchId: string, mode: 'sample' | 'full' | 'retry' = 'full', productId?: number) {
  await requireAdmin()
  try {
    let settings = await loadSettings()
    const context = await batchContext(batchId, mode, productId)
    if (context.products.length === 0) return { success: false, error: 'Нет товаров для обработки' }

    if (mode === 'full') {
      const sample = await scrapingQuery(`
        SELECT settings_snapshot FROM batch_ai_runs
        WHERE batch_id=$1 AND mode='sample' AND status='completed'
        ORDER BY created_at DESC LIMIT 1
      `, [batchId])
      if (sample.rows[0]?.settings_snapshot) settings = sample.rows[0].settings_snapshot
    }

    if (settings.provider === 'cockpit') {
      const worker = await scrapingQuery(`
        SELECT * FROM batch_ai_worker_state
        WHERE provider='cockpit' AND heartbeat_at > NOW() - INTERVAL '30 seconds'
        ORDER BY heartbeat_at DESC LIMIT 1
      `)
      if (!worker.rows[0]) return { success: false, error: 'Cockpit worker недоступен: heartbeat старше 30 секунд' }
    }

    const runId = crypto.randomUUID()
    const supplierInstructions = (settings as any).supplierInstructions ?? [
      context.batch.ai_instructions,
      context.batch.ai_photo_enabled && context.batch.ai_photo_instructions ? `Особенности фото: ${context.batch.ai_photo_instructions}` : '',
      context.batch.ai_photo_enabled && context.batch.ai_photo_models ? `Ориентиры по моделям товаров: ${context.batch.ai_photo_models}` : '',
    ].filter(Boolean).join('\n')
    const snapshot = {
      ...settings,
      systemPrompt: settings.systemPrompt || DEFAULT_BATCH_AI_SYSTEM_PROMPT,
      supplierInstructions,
    }
    await snapshotBatch(batchId, context.batch.stage || 'SCRAPED', `До AI · ${mode}`, snapshot)
    await scrapingQuery(`
      INSERT INTO batch_ai_runs(id,batch_id,provider,mode,status,settings_snapshot,total_count,started_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())
    `, [runId, batchId, settings.provider, mode, settings.provider === 'cockpit' ? 'queued' : 'running', JSON.stringify(snapshot), context.products.length])

    const priceRules = priceRuleHints(context.priceRules)
    const priceReferenceUrls = priceRules.flatMap((rule) => rule.reference_images || [])
    for (const product of context.products) {
      const userPrompt = buildBatchAiUserPrompt({
        product,
        supplierInstructions,
        brands: context.brands,
        categories: context.categories,
        subcategories: context.subcategories,
        attributes: context.definitions,
        priceRules,
      })
      await scrapingQuery(`
        INSERT INTO batch_ai_items(id,run_id,product_id,external_id,input_snapshot)
        VALUES($1,$2,$3,$4,$5::jsonb)
      `, [crypto.randomUUID(), runId, product.id, product.external_id, JSON.stringify({
        product, userPrompt, systemPrompt: snapshot.systemPrompt,
        photoUrls: context.batch.ai_photo_enabled ? product.photos || [] : [],
        photoEnabled: context.batch.ai_photo_enabled === true,
        fullSizeRefinementEnabled: context.batch.ai_photo_enabled === true && context.batch.ai_deep_search_enabled === true,
        brands: context.brands,
        categories: context.categories,
        subcategories: context.subcategories,
        attributeCodes: context.definitions.map((item: any) => item.code),
        priceRules,
        priceReferenceUrls,
      })])
    }

    revalidatePath('/admin/batches')
    if (settings.provider === 'openrouter') {
      after(async () => {
        await processOpenRouterRun(runId, context, settings)
      })
    }
    return { success: true, data: { runId, queued: context.products.length, provider: settings.provider } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

async function processOpenRouterRun(runId: string, context: any, settings: BatchAiSettings) {
  const items = await scrapingQuery('SELECT * FROM batch_ai_items WHERE run_id=$1 ORDER BY created_at', [runId])
  let cursor = 0
  const concurrency = context.batch.ai_parallel_enabled === false
    ? 1
    : Math.max(1, Math.min(10, Math.round(finiteNumber(settings.concurrency, 5))))
  const workers = Array.from({ length: Math.min(concurrency, items.rows.length) }, async () => {
    while (cursor < items.rows.length) {
      const item = items.rows[cursor++]
      await processOpenRouterItem(item, context, settings)
    }
  })
  await Promise.all(workers)
  await finalizeRun(runId)
}

async function processOpenRouterItem(item: any, context: any, settings: BatchAiSettings) {
  try {
    const claimed = await scrapingQuery(`
      UPDATE batch_ai_items i SET status='running',attempts=attempts+1,updated_at=NOW()
      FROM batch_ai_runs r
      WHERE i.id=$1 AND i.run_id=r.id AND i.status='queued' AND r.status IN ('queued','running')
      RETURNING i.id
    `, [item.id])
    if (!claimed.rows[0]) return
    const input = item.input_snapshot
    const sheets = await buildBatchAiContactSheets(input.photoUrls || [])
    context.priceReferenceSheetsPromise ||= buildBatchAiContactSheets(input.priceReferenceUrls || [])
    const referenceSheets = await context.priceReferenceSheetsPromise
    let raw = await runBatchAiOpenRouter({
      settings,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      contactSheets: sheets,
      referenceSheets,
    })
    if (input.fullSizeRefinementEnabled && Number(raw?.product?.confidence || 0) < 0.75 && Array.isArray(raw?.inspect_full_size_indexes) && raw.inspect_full_size_indexes.length) {
      raw = await runBatchAiOpenRouterRefinement({
        settings,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        previousOutput: raw,
        photoUrls: input.photoUrls || [],
        indexes: raw.inspect_full_size_indexes,
      })
    }
    const normalized = normalizeBatchAiOutput(raw, {
      product: input.product,
      brandIds: new Set(context.brands.map((row: any) => String(row.id))),
      categoryIds: new Set(context.categories.map((row: any) => String(row.id))),
      subcategoryIds: new Set(context.subcategories.map((row: any) => String(row.id))),
      subcategoryParents: new Map(context.subcategories.map((row: any) => [String(row.id), String(row.parent_id || '')])),
      attributeCodes: new Set(context.definitions.map((row: any) => String(row.code))),
      priceRuleKeys: new Set((input.priceRules || []).map((row: any) => String(row.rule_key))),
    })
    await applyCompletedItem(item, normalized, context)
  } catch (error: any) {
    const failed = await scrapingQuery(`
      UPDATE batch_ai_items i SET status='failed',error_message=$2,completed_at=NOW(),updated_at=NOW()
      FROM batch_ai_runs r
      WHERE i.id=$1 AND i.run_id=r.id AND i.status='running' AND r.status <> 'cancelled'
      RETURNING i.product_id
    `, [item.id, String(error.message || error).slice(0, 4000)])
    if (failed.rows[0]) {
      await scrapingQuery('UPDATE products SET ai_error=$2,updated_at=NOW() WHERE id=$1', [item.product_id, String(error.message || error).slice(0, 4000)])
    }
  }
}

async function applyCompletedItem(item: any, normalized: any, context: any) {
  const product = normalized.product
  const rule = product.price_source === 'manual' ? null : matchingPriceRule(product, context.priceRules)
  if (rule) {
    product.price = Number(rule.price)
    product.price_source = 'rule'
  } else if (!Number(product.price) && Number(context.batch.default_price)) {
    product.price = Number(context.batch.default_price)
    product.price_source = 'default'
  }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [item.run_id])
    if (!run.rows[0] || run.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return
    }
    await client.query(`
      UPDATE products SET
        name=$2,description=$3,h1=$4,seo_title=$5,seo_description=$6,
        brand=$7,category=$8,subcategory=$9,gender=$10,photos=$11::jsonb,
        attributes=$12::jsonb,price=$13,price_source=$14,ai_processed=true,
        ai_error=NULL,ai_confidence=$15,updated_at=NOW()
      WHERE id=$1
    `, [
      item.product_id, product.name, product.description, product.h1, product.seo_title,
      product.seo_description, product.brand, product.category, product.subcategory || null,
      product.gender || null, JSON.stringify(product.photos || []), JSON.stringify(product.attributes || {}),
      Number(product.price || 0), product.price_source || 'legacy', product.ai_confidence,
    ])
    await client.query(`
      UPDATE batch_ai_items SET status='completed',output=$2::jsonb,error_message=NULL,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1
    `, [item.id, JSON.stringify(normalized)])
    await saveBatchAiSuggestions(client, item.run_id, item.product_id, normalized)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function finalizeRun(runId: string) {
  const runState = await scrapingQuery('SELECT status FROM batch_ai_runs WHERE id=$1', [runId])
  if (!runState.rows[0] || ['completed', 'failed', 'cancelled'].includes(runState.rows[0].status)) return
  const counts = await scrapingQuery(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER(WHERE status='completed')::int AS completed,
           COUNT(*) FILTER(WHERE status='failed')::int AS failed,
           COUNT(*) FILTER(WHERE status IN ('queued','running'))::int AS pending
    FROM batch_ai_items WHERE run_id=$1
  `, [runId])
  const row = counts.rows[0]
  const status = row.pending > 0 ? 'running' : row.completed > 0 ? 'completed' : 'failed'
  await scrapingQuery(`
    UPDATE batch_ai_runs SET status=$2,completed_count=$3,failed_count=$4,
      completed_at=CASE WHEN $5=0 THEN NOW() ELSE completed_at END,updated_at=NOW()
    WHERE id=$1 AND status <> 'cancelled'
  `, [runId, status, row.completed, row.failed, row.pending])
  if (status === 'completed') {
    const run = await scrapingQuery('SELECT * FROM batch_ai_runs WHERE id=$1', [runId])
    if (run.rows[0]?.mode !== 'sample') {
      await scrapingQuery("UPDATE scraping_batches SET stage='AI_PROCESSED',updated_at=NOW() WHERE id=$1", [run.rows[0].batch_id])
    }
    await snapshotBatch(run.rows[0].batch_id, 'AI_PROCESSED', 'Обработано ИИ', run.rows[0].settings_snapshot)
  }
}

async function getBatchAiRun(runId: string) {
  const run = await scrapingQuery('SELECT * FROM batch_ai_runs WHERE id=$1', [runId])
  const errors = await scrapingQuery(`
    SELECT product_id,external_id,error_message FROM batch_ai_items
    WHERE run_id=$1 AND status='failed' ORDER BY created_at
  `, [runId])
  return { ...run.rows[0], errors: errors.rows }
}

export async function getBatchAiRunAction(runId: string) {
  await requireAdmin()
  await finalizeRun(runId)
  return { success: true, data: await getBatchAiRun(runId) }
}

export async function getLatestBatchAiRunAction(batchId: string) {
  await requireAdmin()
  const latest = await scrapingQuery(`
    SELECT id FROM batch_ai_runs
    WHERE batch_id=$1
    ORDER BY created_at DESC LIMIT 1
  `, [batchId])
  if (!latest.rows[0]) return { success: true, data: null }
  await finalizeRun(String(latest.rows[0].id))
  return { success: true, data: await getBatchAiRun(String(latest.rows[0].id)) }
}

export async function stopBatchAiRunAction(runId: string) {
  await requireAdmin()
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT id,status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [runId])
    if (!run.rows[0]) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Запуск ИИ не найден' }
    }
    if (['queued', 'running'].includes(run.rows[0].status)) {
      await client.query(`
        UPDATE batch_ai_items SET status='cancelled',lease_token=NULL,leased_at=NULL,
          completed_at=NOW(),updated_at=NOW()
        WHERE run_id=$1 AND status IN ('queued','running')
      `, [runId])
      await client.query(`
        UPDATE batch_ai_runs SET status='cancelled',completed_at=NOW(),updated_at=NOW()
        WHERE id=$1
      `, [runId])
    }
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function getBatchSnapshotsAction(batchId: string) {
  await requireAdmin()
  const result = await scrapingQuery(`
    SELECT id,stage,label,jsonb_array_length(products)::int AS items_count,settings_snapshot,created_at
    FROM batch_snapshots WHERE batch_id=$1 ORDER BY created_at DESC
  `, [batchId])
  return { success: true, data: result.rows }
}

export async function rollbackBatchAction(batchId: string, snapshotId: string) {
  await requireAdmin()
  const snapshot = await scrapingQuery('SELECT * FROM batch_snapshots WHERE id=$1 AND batch_id=$2', [snapshotId, batchId])
  if (!snapshot.rows[0]) return { success: false, error: 'Снимок не найден' }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const mappingResult = await client.query(`
      SELECT entity_type, legacy_id, canonical_id, name, canonical_parent_id
      FROM catalog_id_mappings
    `)
    const products = normalizeProductsCatalogReferences(
      snapshot.rows[0].products,
      mappingResult.rows as CatalogIdMapping[],
    )
    await client.query('DELETE FROM products WHERE batch_id=$1', [batchId])
    for (let position = 0; position < products.length; position++) {
      const row = products[position]
      await client.query(`
        INSERT INTO products(external_id,name,description,price,status,brand,category,subcategory,gender,photos,attributes,
          ai_processed,batch_id,h1,seo_title,seo_description,price_source,variant_group_key,ai_error,ai_confidence,source_position,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `, [
        row.external_id, row.name, row.description, row.price, row.status, row.brand, row.category,
        row.subcategory, row.gender, JSON.stringify(row.photos || []), JSON.stringify(row.attributes || {}),
        row.ai_processed || false, batchId, row.h1, row.seo_title, row.seo_description,
        row.price_source || 'legacy', row.variant_group_key, row.ai_error, row.ai_confidence,
        row.source_position ?? position, row.created_at || new Date(), new Date(),
      ])
    }
    await client.query('UPDATE scraping_batches SET stage=$2,items_count=$3,updated_at=NOW() WHERE id=$1', [batchId, snapshot.rows[0].stage, products.length])
    await client.query('DELETE FROM batch_snapshots WHERE batch_id=$1 AND created_at>$2', [batchId, snapshot.rows[0].created_at])
    await client.query('DELETE FROM batch_ai_runs WHERE batch_id=$1 AND created_at>$2', [batchId, snapshot.rows[0].created_at])
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function reviewBatchAiSuggestionAction(id: string, decision: 'approved' | 'rejected', editedPayload?: any) {
  try {
    return await reviewBatchAiSuggestion(id, decision, editedPayload)
  } catch (error: any) {
    console.error('Failed to review batch AI suggestion', { id, decision, error })
    return { success: false, error: error?.message || 'Не удалось применить предложение ИИ' }
  }
}

async function reviewBatchAiSuggestion(id: string, decision: 'approved' | 'rejected', editedPayload?: any) {
  await requireAdmin()
  const suggestion = await scrapingQuery('SELECT * FROM batch_ai_suggestions WHERE id=$1', [id])
  const row = suggestion.rows[0]
  if (!row) return { success: false, error: 'Предложение не найдено' }
  if (editedPayload && typeof editedPayload === 'object' && !Array.isArray(editedPayload)) {
    row.payload = editedPayload
    await scrapingQuery('UPDATE batch_ai_suggestions SET payload=$2::jsonb WHERE id=$1', [id, JSON.stringify(editedPayload)])
  }
  if (decision === 'approved' && row.kind === 'color_family') {
    const colors = Array.isArray(row.payload?.observed_colors) ? row.payload.observed_colors : []
    if (row.affected_product_ids.length < 2 || colors.length < 2) {
      return { success: false, error: 'Для цветового семейства нужны минимум два товара разных цветов' }
    }
    const familyKey = canonicalColorFamilyKey(row.payload)
    const key = crypto.createHash('sha256').update(familyKey || row.canonical_key).digest('hex').slice(0, 32)
    await scrapingQuery(
      'UPDATE products SET variant_group_key=$1,updated_at=NOW() WHERE id=ANY($2::int[])',
      [key, row.affected_product_ids.map(Number)],
    )
  }
  if (decision === 'approved' && row.kind === 'subcategory') {
    const reconcileClient = await getScrapingClient()
    try {
      await reconcileClient.query('BEGIN')
      const run = await reconcileClient.query('SELECT batch_id FROM batch_ai_runs WHERE id=$1', [row.run_id])
      if (run.rows[0]?.batch_id) {
        await reconcileBatchSubcategorySuggestions(reconcileClient, String(run.rows[0].batch_id))
      }
      const current = await reconcileClient.query('SELECT status FROM batch_ai_suggestions WHERE id=$1', [id])
      await reconcileClient.query('COMMIT')
      if (current.rows[0]?.status === 'approved') {
        revalidatePath('/admin/batches')
        return { success: true }
      }
    } catch (error) {
      await reconcileClient.query('ROLLBACK')
      throw error
    } finally {
      reconcileClient.release()
    }
    const parentId = String(row.payload.parent_category_id || '')
    if (!parentId) return { success: false, error: 'AI не указал родительскую категорию' }
    const category = await createRailsCatalogSubcategory({ name: String(row.payload.name), parent_category_id: parentId })
    await scrapingQuery(`
      INSERT INTO catalog_id_mappings(entity_type,legacy_id,canonical_id,name,legacy_parent_id,canonical_parent_id,updated_at)
      VALUES('subcategory',$1,$1,$2,$3,$3,NOW())
      ON CONFLICT(entity_type,legacy_id) DO UPDATE SET canonical_id=EXCLUDED.canonical_id,name=EXCLUDED.name,
        canonical_parent_id=EXCLUDED.canonical_parent_id,updated_at=NOW()
    `, [String(category.id), category.name, String(category.parent_id)])
    const productIds = row.affected_product_ids.map(Number)
    await scrapingQuery('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=ANY($2::int[])', [String(category.id), productIds])
    const products = await scrapingQuery(`
      SELECT p.*,b.supplier_id FROM products p JOIN scraping_batches b ON b.id=p.batch_id
      WHERE p.id=ANY($1::int[])
    `, [productIds])
    for (const product of products.rows) {
      if (product.price_source === 'manual') continue
      const rules = await scrapingQuery('SELECT * FROM supplier_price_rules WHERE supplier_id=$1 AND enabled=true', [product.supplier_id])
      const rule = matchingPriceRule(product, rules.rows)
      await scrapingQuery('UPDATE products SET price=$2,price_source=$3,updated_at=NOW() WHERE id=$1', [
        product.id,
        rule ? Number(rule.price) : 0,
        rule ? 'rule' : 'unpriced',
      ])
    }
  }
  if (decision === 'approved' && row.kind === 'attribute') {
    const payload = row.payload || {}
    const code = String(payload.code || row.canonical_key).trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 64)
    if (!code) return { success: false, error: 'Некорректный код атрибута' }
    const registry = await getRailsCatalogAttributeRegistry()
    if (!registry.definitions.some((definition: any) => definition.code === code)) {
      registry.definitions.push({
        code,
        label: String(payload.label || code),
        category_scope: 'Все категории',
        value_type: String(payload.value_type || 'text'),
        unit: payload.unit || null,
        aliases: Array.isArray(payload.aliases) ? payload.aliases : [],
        parser_rules: [],
        sort_order: registry.definitions.length * 10 + 100,
        show_as_characteristic: true,
        use_as_filter: false,
        use_as_variant_dimension: false,
        active: true,
      })
      await syncRailsCatalogAttributeRegistry(registry)
    }
    for (const [index, value] of (Array.isArray(payload.allowed_values) ? payload.allowed_values : []).entries()) {
      const canonicalValue = String(value).trim()
      if (!canonicalValue) continue
      const filterValue = `ai_${crypto.createHash('sha256').update(`${code}:${canonicalValue.toLowerCase()}`).digest('hex').slice(0, 12)}`
      await upsertRailsCatalogAttributeValue({
        attribute_code: code,
        filter_value: filterValue,
        canonical_value: canonicalValue,
        aliases: [],
        sort_order: (index + 1) * 10,
        active: true,
      })
    }
    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      for (const productId of row.affected_product_ids.map(Number)) {
        const product = await client.query('SELECT attributes FROM products WHERE id=$1 FOR UPDATE', [productId])
        const attributes = { ...(product.rows[0]?.attributes || {}), [code]: payload.value }
        await client.query('UPDATE products SET attributes=$2::jsonb,updated_at=NOW() WHERE id=$1', [productId, JSON.stringify(attributes)])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  await scrapingQuery('UPDATE batch_ai_suggestions SET status=$2,reviewed_at=NOW() WHERE id=$1', [id, decision])
  revalidatePath('/admin/batches')
  return { success: true }
}

export async function getBatchAiSuggestionsAction(batchId: string, syncCatalog = true) {
  await requireAdmin()
  if (syncCatalog) await syncCurrentRailsCatalogMappings()
  const knownAttributeCodes = syncCatalog
    ? new Set((await getCatalogAttributeDefinitions()).map((definition) => definition.code))
    : null
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    await reconcileBatchSubcategorySuggestions(client, batchId)
    await reconcileBatchColorFamilySuggestions(client, batchId)
    if (knownAttributeCodes) {
      await reconcileKnownAttributeSuggestions(client, batchId, knownAttributeCodes)
    }
    const result = await client.query(`
      SELECT s.* FROM batch_ai_suggestions s
      JOIN batch_ai_runs r ON r.id=s.run_id WHERE r.batch_id=$1
        AND (
          s.kind <> 'color_family'
          OR s.status <> 'pending'
          OR (
            jsonb_array_length(s.affected_product_ids) >= 2
            AND COALESCE(jsonb_array_length(s.payload->'observed_colors'),0) >= 2
          )
        )
      ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.created_at DESC
    `, [batchId])
    await client.query('COMMIT')
    return { success: true, data: result.rows }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message, data: [] }
  } finally {
    client.release()
  }
}

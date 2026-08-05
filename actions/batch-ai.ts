'use server'

import crypto from 'crypto'
import sharp from 'sharp'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import {
  filterCatalogAttributeDefinitionsForCategory,
  getCatalogAttributeDefinitions,
} from '@/lib/catalog-attribute-registry'
import {
  DEFAULT_BATCH_AI_SYSTEM_PROMPT,
  GLOBAL_BATCH_AI_CATALOG_RULES,
  buildBatchAiContactSheets,
  buildBatchAiFamilyDefinition,
  buildBatchAiShadeRepairPrompt,
  buildBatchAiUserPrompt,
  buildBatchAiShadePrompt,
  buildBatchAiVisualFamilyPrompt,
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
  refreshRailsProductSlugs,
  syncRailsCatalogAttributeRegistry,
  upsertRailsCatalogAttributeValue,
} from '@/lib/rails-admin'
import { recordBatchSnapshot } from '@/lib/batch-snapshots'
import { activeBatchOperation, claimBatchOperation, releaseBatchOperation, touchBatchOperation } from '@/lib/batch-operation-lock'
import {
  normalizeProductsCatalogReferences,
  sanitizeSupplierAiInstructions,
  type CatalogIdMapping,
} from '@/lib/catalog-reference-normalizer'
import { uploadToS3 } from '@/lib/s3'
import {
  applyShadeVariantsToSuggestion,
  canonicalColorFamilyKey,
  colorFamilyRebuildPlan,
  ensureUniqueFamilyColors,
  inferBaseColor,
  normalizeShadeScanOutput,
  normalizeVisualFamilyScanOutput,
  normalizedColorFamilyValue,
  reconcileBatchColorFamilySuggestions,
  reconcileKnownAttributeSuggestions,
  reconcileBatchSubcategorySuggestions,
  saveBatchAiSuggestions,
  savePreparedColorFamilySuggestion,
} from '@/lib/batch-ai-suggestions'
import { byesuApiKeyStatus, byesuModelGroup } from '@/lib/byesu'
import { buildProductSeoSlug, normalizeMediaSeoOutput } from '@/lib/product-media-seo'

const SETTINGS_KEYS = [
  'batch_ai_provider',
  'batch_ai_openrouter_model',
  'batch_ai_byesu_model',
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
  const provider: BatchAiProvider = ['openrouter', 'byesu', 'cockpit'].includes(values.batch_ai_provider)
    ? values.batch_ai_provider as BatchAiProvider
    : 'openrouter'
  const worker = await scrapingQuery(`
    SELECT worker_id, provider, model, heartbeat_at, metadata,
           heartbeat_at > NOW() - INTERVAL '30 seconds' AS available
    FROM batch_ai_worker_state
    WHERE provider='cockpit'
    ORDER BY heartbeat_at DESC LIMIT 1
  `).catch(() => ({ rows: [] }))
  const byesuKeys = byesuApiKeyStatus()
  return {
    success: true,
    data: {
      provider,
      openrouterModel: values.batch_ai_openrouter_model || 'google/gemini-2.5-flash',
      byesuModel: values.batch_ai_byesu_model || 'gemini-3.1-flash-lite',
      temperature: finiteNumber(values.batch_ai_temperature, 0.1),
      maxTokens: Math.max(1000, finiteNumber(values.batch_ai_max_tokens, 5000)),
      concurrency: Math.max(1, Math.min(10, Math.round(finiteNumber(values.batch_ai_concurrency, 5)))),
      systemPrompt: values.batch_ai_system_prompt || DEFAULT_BATCH_AI_SYSTEM_PROMPT,
      cockpitWorker: worker.rows[0] || null,
      credentials: {
        openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        byesuGemini: byesuKeys.gemini,
        byesuOpenai: byesuKeys.openai,
        byesuLegacy: byesuKeys.legacy,
      },
    },
  }
}

export async function updateBatchAiSettingsAction(settings: BatchAiSettings) {
  await requireAdmin()
  const provider: BatchAiProvider = ['openrouter', 'byesu', 'cockpit'].includes(settings.provider)
    ? settings.provider
    : 'openrouter'
  const values: Record<string, string> = {
    batch_ai_provider: provider,
    batch_ai_openrouter_model: String(settings.openrouterModel || '').trim() || 'google/gemini-2.5-flash',
    batch_ai_byesu_model: String(settings.byesuModel || '').trim() || 'gemini-3.1-flash-lite',
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
  const settings = result.data as BatchAiSettings
  return {
    ...settings,
    systemPrompt: `${settings.systemPrompt || DEFAULT_BATCH_AI_SYSTEM_PROMPT}\n\n${GLOBAL_BATCH_AI_CATALOG_RULES}`,
  }
}

async function snapshotBatch(batchId: string, stage: string, label: string, settings: any = {}) {
  return recordBatchSnapshot(batchId, stage, label, settings)
}

function scalarPriceRuleValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarPriceRuleValues)
  if (value && typeof value === 'object') {
    return scalarPriceRuleValues((value as any).value ?? (value as any).values ?? (value as any).display_value ?? [])
  }
  return value === undefined || value === null ? [] : [String(value).trim().toLowerCase()]
}

function priceRuleConditionMatchesKnownProductValue(product: any, key: string, expected: unknown) {
  const actual = key.startsWith('attributes.')
    ? product?.attributes?.[key.slice('attributes.'.length)]
    : product?.[key]
  const actualValues = scalarPriceRuleValues(actual).filter(Boolean)
  if (!actualValues.length) return true
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && ('min' in expected || 'max' in expected)) {
    const numbers = actualValues
      .map((value) => Number(value.replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]))
      .filter(Number.isFinite)
    if (!numbers.length) return true
    const min = Number((expected as any).min)
    const max = Number((expected as any).max)
    return numbers.some((value) =>
      (!Number.isFinite(min) || value >= min) && (!Number.isFinite(max) || value <= max),
    )
  }
  const expectedValues = scalarPriceRuleValues(expected).filter(Boolean)
  return !expectedValues.length || expectedValues.some((value) => actualValues.includes(value))
}

function priceRuleCanApplyToKnownProduct(rule: any, product: any) {
  return Object.entries(rule.conditions || {}).every(([key, expected]) =>
    priceRuleConditionMatchesKnownProductValue(product, key, expected),
  )
}

function priceRuleHints(rules: any[], product?: any) {
  return rules.map((rule) => ({
    rule_key: String(rule.rule_key || `rule_${rule.id}`),
    name: String(rule.name || ''),
    conditions: rule.conditions || {},
    visual_hint: String(rule.visual_hint || ''),
    // Текстовые условия передаём всегда. Фото-эталоны не прикладываем, если
    // уже известные поля товара явно противоречат правилу.
    reference_images: priceRuleCanApplyToKnownProduct(rule, product)
      ? (Array.isArray(rule.reference_images) ? rule.reference_images.map(String).slice(0, 9) : [])
      : [],
    price: Number(rule.price || 0),
    priority: Number(rule.priority || 0),
  }))
}

function promptSubcategoriesForContext(context: any) {
  if (context.categories.length === 1) {
    const fixedCategoryId = String(context.categories[0].id)
    const scoped = context.subcategories.filter((row: any) => String(row.parent_id || '') === fixedCategoryId)
    if (scoped.length) return scoped
  }
  return context.subcategories
}

async function syncCurrentRailsCatalogMappings() {
  const catalog = await getRailsCatalogLookups()
  const currentSubcategoryName = (name: unknown) => ({
    'Пальто': 'Пальто и плащи',
    'Худи': 'Худи и толстовки',
    'Головные уборы': 'Шапки',
  }[String(name || '').trim()] || String(name || ''))
  const rows = [
    ...catalog.brands.map((item: any) => ({ entity_type: 'brand', id: String(item.id), name: String(item.name || ''), parent_id: '' })),
    ...catalog.categories.map((item: any) => ({ entity_type: 'category', id: String(item.id), name: String(item.name || ''), parent_id: '' })),
    ...catalog.subcategories.map((item: any) => ({
      entity_type: 'subcategory',
      id: String(item.id),
      name: currentSubcategoryName(item.name),
      parent_id: String(item.category || item.parent_id || ''),
    })),
  ]
  if (rows.length) {
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
  }
  return catalog
}

type BatchAiRunMode = 'sample' | 'full' | 'retry' | 'variants' | 'selection' | 'reprocess' | 'recover_measurements' | 'media_seo'

const MEDIA_SEO_SYSTEM_PROMPT = `Ты создаёшь SEO-данные фотографий каталога. Верни строго JSON без markdown. Для каждой фотографии напиши отдельный точный alt на русском длиной обычно 60–120 символов и не более 160 символов: подтверждённый бренд, товар, видимый ракурс и 1–2 различимые детали. Бренд товара обязателен в каждом alt. Не добавляй неподтверждённые свойства, рекламные обещания, слова «на фото» и упоминания реплики. Если товар лежит рядом с упаковкой или другим товаром, описывай только основной товар.`

function buildBatchMediaSeoPrompt(product: any, brandName: string, slug: string) {
  return [
    'Верни объект следующей формы:',
    JSON.stringify({ photo_alts: [''] }),
    'photo_alts должен содержать ровно по одному alt-тексту на каждую фотографию, в том же порядке, что и номера на contact sheet. Целевая длина каждого alt 60–120 символов, абсолютный максимум 160 символов.',
    'В каждом alt обязательно укажи подтверждённый бренд товара. Имя файла будет автоматически получено транслитерацией этого alt.',
    'Крупный рекламный текст, цены и промо на кадре не описывай.',
    `Товар: ${JSON.stringify({ name: product.name, brand: brandName, attributes: product.attributes || {} })}`,
    `Slug товара уже сформирован автоматически: ${slug}`,
  ].join('\n\n')
}

function catalogName(value: unknown, entityType: string, mappings: CatalogIdMapping[]) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  const mapping = mappings.find((item) => item.entity_type === entityType && (
    String(item.canonical_id || '') === raw
    || String(item.legacy_id || '') === raw
    || String(item.name || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ') === normalized
  ))
  return String(mapping?.name || raw).trim()
}

function productAttributeDefinitions(product: any, context: any) {
  const mappedCategory = catalogName(product.category, 'category', context.mappings)
  const categoryName = context.categories.length === 1
    ? String(context.categories[0].name || mappedCategory)
    : mappedCategory
  const subcategoryName = catalogName(product.subcategory, 'subcategory', context.mappings)
  return filterCatalogAttributeDefinitionsForCategory(context.definitions, categoryName, subcategoryName)
}

async function batchContext(batchId: string, mode: BatchAiRunMode, productId?: number | number[]) {
  const currentCatalog = await syncCurrentRailsCatalogMappings()
  const batch = await scrapingQuery(`
    SELECT b.*, s.ai_instructions, s.ai_photo_models, s.default_price, s.ai_photo_enabled, s.ai_deep_search_enabled,
           s.ai_parallel_enabled, s.allowed_brand_ids, s.allowed_category_ids, s.allowed_subcategory_ids
    FROM scraping_batches b JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=$1
  `, [batchId])
  if (!batch.rows[0]) throw new Error('Выгрузка не найдена')
  let predicate = ''
  const params: any[] = [batchId]
  if (mode === 'sample') predicate = 'AND COALESCE(ai_processed,false)=false ORDER BY source_position ASC NULLS LAST, id LIMIT 10'
  if (mode === 'full') predicate = 'AND COALESCE(ai_processed,false)=false ORDER BY source_position ASC NULLS LAST, id'
  if (mode === 'reprocess') predicate = 'ORDER BY source_position ASC NULLS LAST, id'
  if (mode === 'media_seo') {
    const productIds = [...new Set((Array.isArray(productId) ? productId : [productId]).map(Number).filter(Number.isInteger))]
    if (productIds.length > 0) {
      params.push(productIds)
      predicate = `AND id=ANY($${params.length}::int[]) ORDER BY source_position ASC NULLS LAST, id`
    } else {
      predicate = 'ORDER BY source_position ASC NULLS LAST, id'
    }
  }
  if (mode === 'variants') predicate = 'AND COALESCE(ai_processed,false)=true ORDER BY source_position ASC NULLS LAST, id'
  if (mode === 'selection') {
    const productIds = [...new Set((Array.isArray(productId) ? productId : [productId]).map(Number).filter(Number.isInteger))]
    params.push(productIds)
    predicate = `AND id=ANY($${params.length}::int[]) ORDER BY source_position ASC NULLS LAST, id`
  }
  if (mode === 'retry') {
    params.push(productId)
    predicate = `AND id=$${params.length} ORDER BY id`
  }
  const products = await scrapingQuery(`SELECT * FROM products WHERE batch_id=$1 ${predicate}`, params)
  let selectedProducts = products.rows
  if (mode === 'recover_measurements') {
    const sourceSnapshots = await scrapingQuery(`
      SELECT products
      FROM batch_snapshots
      WHERE batch_id=$1 AND label='Обработан скриптом'
      ORDER BY created_at DESC
    `, [batchId])
    const rawSnapshot = await scrapingQuery(`
      SELECT products
      FROM batch_snapshots
      WHERE batch_id=$1 AND stage='SCRAPED'
      ORDER BY created_at ASC
      LIMIT 1
    `, [batchId])
    const rawProducts = Array.isArray(rawSnapshot.rows[0]?.products)
      ? rawSnapshot.rows[0].products
      : []
    const sourceByExternalId = new Map<string, any>()
    for (const snapshot of sourceSnapshots.rows) {
      const snapshotProducts = Array.isArray(snapshot.products) ? snapshot.products : []
      for (const product of snapshotProducts) {
        const externalId = String(product?.external_id || '').trim()
        const attributes = product?.attributes && typeof product.attributes === 'object' ? product.attributes : {}
        const hasSizeChart = Boolean(attributes.size_chart_source_id || attributes.size_chart_source_ids)
        if (externalId && hasSizeChart && !sourceByExternalId.has(externalId)) {
          sourceByExternalId.set(externalId, product)
        }
      }
    }
    const rawByExternalId = new Map<string, any>(rawProducts.map((product: any) => [String(product?.external_id || '').trim(), product]))
    const recoverableCategories = await scrapingQuery(`
      SELECT legacy_id,canonical_id
      FROM catalog_id_mappings
      WHERE entity_type='category' AND LOWER(name) IN ('одежда','обувь')
    `)
    const recoverableCategoryIds = new Set(recoverableCategories.rows.flatMap((row) => [
      String(row.legacy_id || '').trim(),
      String(row.canonical_id || '').trim(),
    ]).filter(Boolean))
    const recoveryGroups = new Map<string, { product: any, targetIds: number[], photoUrls: string[] }>()
    for (const product of products.rows) {
      if (!recoverableCategoryIds.has(String(product.category || '').trim())) continue
      if (product?.attributes?.measurements) continue
      const source = sourceByExternalId.get(String(product.external_id || '').trim())
      const sourceAttributes = source?.attributes && typeof source.attributes === 'object' ? source.attributes : {}
      const chartIds = [...new Set([
        ...(Array.isArray(sourceAttributes.size_chart_source_ids) ? sourceAttributes.size_chart_source_ids : []),
        ...(sourceAttributes.size_chart_source_id ? [sourceAttributes.size_chart_source_id] : []),
      ].map((value) => String(value || '').trim()).filter(Boolean))].sort()
      if (!source || chartIds.length === 0) continue
      const photoUrls = [...new Set(chartIds.flatMap((chartId) => {
        const chart = rawByExternalId.get(chartId)
        return Array.isArray(chart?.photos) ? chart.photos.map(String).filter(Boolean) : []
      }))]
      if (photoUrls.length === 0) continue
      const groupKey = chartIds.join('|')
      const group = recoveryGroups.get(groupKey)
      if (group) {
        group.targetIds.push(Number(product.id))
        continue
      }
      recoveryGroups.set(groupKey, {
        product: {
          ...product,
          attributes: { ...(product.attributes || {}), ...sourceAttributes },
        },
        targetIds: [Number(product.id)],
        photoUrls,
      })
    }
    selectedProducts = [...recoveryGroups.values()].map((group) => ({
      ...group.product,
      __measurementTargetProductIds: group.targetIds,
      __measurementPhotoUrls: group.photoUrls,
    }))
  }
  const mappings = await scrapingQuery(`
    SELECT entity_type, legacy_id, canonical_id, canonical_id AS id, name,
           legacy_parent_id, canonical_parent_id, canonical_parent_id AS parent_id
    FROM catalog_id_mappings ORDER BY entity_type, name
  `)
  const definitions = await getCatalogAttributeDefinitions()
  const priceRules = await scrapingQuery(
    'SELECT * FROM supplier_price_rules WHERE supplier_id=$1 AND enabled=true ORDER BY priority DESC,id',
    [batch.rows[0].supplier_id],
  )
  const allowedIds = (value: unknown) => Array.isArray(value) ? new Set(value.map(String)) : new Set<string>()
  const allowedIdsToCurrent = (value: unknown, entityType: string, currentRows: any[]) => {
    const rawIds = allowedIds(value)
    if (!rawIds.size) return null
    const currentIds = new Set<string>()
    for (const row of mappings.rows) {
      if (row.entity_type !== entityType) continue
      if (rawIds.has(String(row.legacy_id)) || rawIds.has(String(row.canonical_id))) {
        currentIds.add(String(row.canonical_id))
      }
    }
    const resolved = new Set(currentRows.map((row) => String(row.id)).filter((id) => currentIds.has(id)))
    return resolved.size ? resolved : null
  }
  const brands = currentCatalog.brands.map((row: any) => ({ id: String(row.id), name: String(row.name || '') }))
  const categories = currentCatalog.categories.map((row: any) => ({ id: String(row.id), name: String(row.name || '') }))
  const subcategories = currentCatalog.subcategories.map((row: any) => ({
    id: String(row.id),
    name: String(row.name || ''),
    parent_id: String(row.category || row.parent_id || ''),
  }))
  const allowedBrands = allowedIdsToCurrent(batch.rows[0].allowed_brand_ids, 'brand', brands)
  const allowedCategories = allowedIdsToCurrent(batch.rows[0].allowed_category_ids, 'category', categories)
  const allowedSubcategories = allowedIdsToCurrent(batch.rows[0].allowed_subcategory_ids, 'subcategory', subcategories)
  return {
    batch: batch.rows[0], products: selectedProducts, definitions, mappings: mappings.rows,
    brands: allowedBrands ? brands.filter((row) => allowedBrands.has(String(row.id))) : brands,
    categories: allowedCategories ? categories.filter((row) => allowedCategories.has(String(row.id))) : categories,
    subcategories: allowedSubcategories
      ? subcategories.filter((row) => allowedSubcategories.has(String(row.id)))
      : subcategories,
    priceRules: priceRules.rows,
  }
}

export async function startBatchAiAction(batchId: string, mode: BatchAiRunMode = 'full', productId?: number | number[]) {
  await requireAdmin()
  const runId = crypto.randomUUID()
  let operationClaimed = false
  try {
    const active = await scrapingQuery("SELECT id FROM batch_ai_runs WHERE batch_id=$1 AND status IN ('preparing','queued','running') LIMIT 1", [batchId])
    if (active.rows[0]) return { success: false, error: 'Для этой выгрузки уже выполняется AI-обработка' }
    let settings = await loadSettings()
    const context = await batchContext(batchId, mode, productId)
    let variantPlan: ReturnType<typeof colorFamilyRebuildPlan> | null = null
    if (mode === 'variants') {
      const approved = await scrapingQuery(`
        SELECT DISTINCT jsonb_array_elements_text(s.affected_product_ids)::int AS product_id
        FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id
        WHERE r.batch_id=$1 AND s.kind='color_family' AND s.status='approved'
      `, [batchId])
      const approvedIds = new Set(approved.rows.map((row) => Number(row.product_id)))
      const completePlan = colorFamilyRebuildPlan(context.products)
      // Уже принятые товары остаются якорями семьи. Иначе частично принятое
      // семейство невозможно дополнить пропущенными цветами при пересборке.
      const needsRebuild = (family: { products: any[] }) => {
        if (family.products.some((product: any) => !approvedIds.has(Number(product.id)))) return true
        const appliedKeys = new Set(family.products.map((product: any) => String(product.variant_group_key || '')).filter(Boolean))
        return appliedKeys.size !== 1
      }
      variantPlan = {
        deterministicFamilies: completePlan.deterministicFamilies.filter(needsRebuild),
        visualCandidates: completePlan.visualCandidates.filter(needsRebuild),
        shadeCandidates: completePlan.shadeCandidates.filter(needsRebuild),
      }
    }
    if (context.products.length === 0) {
      return {
        success: false,
        error: mode === 'variants'
          ? 'Нет обработанных ИИ товаров без созданных вариантов'
          : 'Нет товаров для обработки',
      }
    }
    if (mode === 'variants' && variantPlan
      && variantPlan.deterministicFamilies.length === 0
      && variantPlan.visualCandidates.length === 0
      && variantPlan.shadeCandidates.length === 0) {
      return { success: false, error: 'Нет новых кандидатов для цветовых семейств' }
    }
    const needsAiProvider = mode !== 'variants'
      || Boolean((variantPlan?.visualCandidates.length || 0) + (variantPlan?.shadeCandidates.length || 0))

    if (needsAiProvider && settings.provider === 'byesu') {
      const group = byesuModelGroup(settings.byesuModel)
      const keys = byesuApiKeyStatus()
      if (!keys[group]) {
        return {
          success: false,
          error: group === 'gemini'
            ? 'Для этой модели нужен BYESU_GEMINI_API_KEY (группа Gemini Business)'
            : 'Для этой модели нужен BYESU_OPENAI_API_KEY (группа OpenAI Codex)',
        }
      }
    }
    if (needsAiProvider && settings.provider === 'openrouter' && !process.env.OPENROUTER_API_KEY?.trim()) {
      return { success: false, error: 'OPENROUTER_API_KEY не задан в окружении AdminYeezy' }
    }

    if (mode === 'full') {
      const sample = await scrapingQuery(`
        SELECT settings_snapshot FROM batch_ai_runs
        WHERE batch_id=$1 AND mode='sample' AND status='completed'
        ORDER BY created_at DESC LIMIT 1
      `, [batchId])
      if (sample.rows[0]?.settings_snapshot) settings = sample.rows[0].settings_snapshot
    }

    if (needsAiProvider && settings.provider === 'cockpit') {
      const worker = await scrapingQuery(`
        SELECT * FROM batch_ai_worker_state
        WHERE provider='cockpit' AND heartbeat_at > NOW() - INTERVAL '30 seconds'
        ORDER BY heartbeat_at DESC LIMIT 1
      `)
      if (!worker.rows[0]) return { success: false, error: 'Cockpit worker недоступен: heartbeat старше 30 секунд' }
    }

    operationClaimed = Boolean(await claimBatchOperation(batchId, 'ai', runId))
    if (!operationClaimed) return { success: false, error: 'Для этой выгрузки уже выполняется другое действие' }
    const rawSupplierInstructions = mode === 'variants' ? String(context.batch.ai_instructions || '') : (settings as any).supplierInstructions ?? [
      context.batch.ai_instructions,
      context.batch.ai_photo_enabled && context.batch.ai_photo_models ? `Ориентиры по моделям товаров: ${context.batch.ai_photo_models}` : '',
    ].filter(Boolean).join('\n')
    const supplierInstructions = sanitizeSupplierAiInstructions(
      rawSupplierInstructions,
      context.mappings as CatalogIdMapping[],
    )
    const snapshot = {
      ...settings,
      systemPrompt: mode === 'media_seo'
        ? MEDIA_SEO_SYSTEM_PROMPT
        : mode === 'variants'
        ? 'Ты сравниваешь фотографии товаров и находишь только точные цветовые варианты одной физической модели. Не изменяй товары. Не объединяй по одному бренду или общему названию. Верни строго запрошенный JSON.'
        : settings.systemPrompt || DEFAULT_BATCH_AI_SYSTEM_PROMPT,
      supplierInstructions,
    }
    if (!['variants', 'media_seo'].includes(mode)) {
      await snapshotBatch(
        batchId,
        context.batch.stage || 'SCRAPED',
        mode === 'reprocess' ? 'До повторной AI-обработки' : mode === 'recover_measurements' ? 'До восстановления замеров' : `До AI · ${mode}`,
        snapshot,
      )
    }
    await scrapingQuery(`
      INSERT INTO batch_ai_runs(id,batch_id,provider,mode,status,settings_snapshot,total_count,started_at)
      VALUES($1,$2,$3,$4,'preparing',$5::jsonb,$6,NOW())
    `, [
      runId,
      batchId,
      settings.provider,
      mode,
      JSON.stringify(snapshot),
      mode === 'variants'
        ? (variantPlan?.visualCandidates.length || 0) + (variantPlan?.shadeCandidates.length || 0)
        : context.products.length,
    ])

    if (mode === 'variants' && variantPlan) {
      const client = await getScrapingClient()
      try {
        await client.query('BEGIN')
        await client.query(`
          DELETE FROM batch_ai_suggestions s
          USING batch_ai_runs r
          WHERE s.run_id=r.id AND r.batch_id=$1 AND s.kind='color_family' AND s.status='pending'
        `, [batchId])
        for (const family of variantPlan.deterministicFamilies) {
          await savePreparedColorFamilySuggestion(client, runId, {
            identityKey: family.identityKey,
            products: family.products,
            source: 'internal_code',
            sourceCode: family.sourceCode,
            confidence: 1,
            matchingEvidence: `Совпали внутренний артикул ${family.sourceCode}, бренд и тип товара.`,
            duplicateProducts: family.duplicateProducts,
            colorConflicts: family.colorConflicts,
            familyDefinition: buildBatchAiFamilyDefinition('internal_code'),
          })
        }
        for (const [index, candidate] of variantPlan.visualCandidates.entries()) {
          const first = candidate.products[0]
          const familyDefinition = buildBatchAiFamilyDefinition('visual_comparison')
          await client.query(`
            INSERT INTO batch_ai_items(id,run_id,product_id,external_id,input_snapshot)
            VALUES($1,$2,$3,$4,$5::jsonb)
          `, [crypto.randomUUID(), runId, first.id, `visual-family-${index + 1}`, JSON.stringify({
            product: first,
            candidateProducts: candidate.products,
            familyDefinition,
            userPrompt: buildBatchAiVisualFamilyPrompt(candidate.products, familyDefinition),
            systemPrompt: snapshot.systemPrompt,
            variantScanOnly: true,
            visualFamilyScan: true,
            photoUrls: candidate.products.map((product: any) => product.photos[0]),
            photoEnabled: true,
            fullSizeRefinementEnabled: false,
            priceReferenceUrls: [],
          })])
        }
        for (const [index, candidate] of variantPlan.shadeCandidates.entries()) {
          const first = candidate.products[0]
          const familyDefinition = buildBatchAiFamilyDefinition('internal_code')
          await client.query(`
            INSERT INTO batch_ai_items(id,run_id,product_id,external_id,input_snapshot)
            VALUES($1,$2,$3,$4,$5::jsonb)
          `, [crypto.randomUUID(), runId, first.id, `shade-family-${index + 1}`, JSON.stringify({
            product: first,
            candidateProducts: candidate.products,
            familyIdentityKey: candidate.identityKey,
            familyDefinition,
            userPrompt: buildBatchAiShadePrompt(candidate.products, familyDefinition),
            systemPrompt: snapshot.systemPrompt,
            variantScanOnly: true,
            shadeFamilyScan: true,
            photoUrls: candidate.products.map((product: any) => `${product.photos[0]}#shade-${product.id}`),
            photoEnabled: true,
            fullSizeRefinementEnabled: false,
            priceReferenceUrls: [],
          })])
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    } else {
      for (const product of context.products) {
        const measurementTargetProductIds = mode === 'recover_measurements'
          ? product.__measurementTargetProductIds || []
          : undefined
        const measurementPhotoUrls = mode === 'recover_measurements'
          ? product.__measurementPhotoUrls || []
          : undefined
        const promptProduct = mode === 'recover_measurements'
          ? (() => {
              const clean = Object.fromEntries(Object.entries(product).filter(([key]) => !key.startsWith('__measurement'))) as any
              clean.attributes = { ...(clean.attributes || {}) }
              delete clean.attributes.measurements
              return clean
            })()
          : product
        const attributeDefinitions = productAttributeDefinitions(product, context)
        const brandName = catalogName(product.brand, 'brand', context.mappings)
        const generatedSlug = mode === 'media_seo'
          ? String(product.slug || '').trim()
          : buildProductSeoSlug(product, brandName)
        const promptSubcategories = promptSubcategoriesForContext(context)
        const priceRules = mode === 'variants' || mode === 'media_seo' || mode === 'recover_measurements'
          ? []
          : priceRuleHints(context.priceRules, promptProduct)
        const priceReferenceUrls = priceRules.flatMap((rule) => rule.reference_images || [])
        const userPrompt = mode === 'media_seo'
          ? buildBatchMediaSeoPrompt(promptProduct, brandName, generatedSlug)
          : buildBatchAiUserPrompt({
          product: promptProduct,
          supplierInstructions: mode === 'recover_measurements'
            ? `${supplierInstructions}\nРЕЖИМ ВОССТАНОВЛЕНИЯ ЗАМЕРОВ: на приложенных фото находится таблица размеров именно для этого товара. Распознай её и заполни catalog_attributes.measurements. Не меняй название, описание, цену, классификацию, цвет, материалы и публичную галерею.`.trim()
            : supplierInstructions,
          brands: context.brands,
          categories: context.categories,
          subcategories: promptSubcategories,
          attributes: attributeDefinitions,
          priceRules,
        })
        await scrapingQuery(`
          INSERT INTO batch_ai_items(id,run_id,product_id,external_id,input_snapshot)
          VALUES($1,$2,$3,$4,$5::jsonb)
        `, [crypto.randomUUID(), runId, product.id, product.external_id, JSON.stringify({
          product: promptProduct, userPrompt, systemPrompt: snapshot.systemPrompt,
          variantScanOnly: false,
          mediaSeoOnly: mode === 'media_seo',
          generatedSlug,
          measurementRecoveryOnly: mode === 'recover_measurements',
          measurementTargetProductIds,
          photoUrls: mode === 'recover_measurements' ? measurementPhotoUrls : mode === 'media_seo' ? product.photos || [] : context.batch.ai_photo_enabled ? product.photos || [] : [],
          photoEnabled: mode === 'recover_measurements' || mode === 'media_seo' || context.batch.ai_photo_enabled === true,
          fullSizeRefinementEnabled: mode === 'recover_measurements' || (mode !== 'media_seo' && context.batch.ai_photo_enabled === true && context.batch.ai_deep_search_enabled === true),
          preserveExistingPrice: mode === 'reprocess' || context.batch.stage === 'PUSHED' || product.ai_processed === true,
          brands: context.brands,
          categories: context.categories,
          subcategories: promptSubcategories,
          attributeCodes: attributeDefinitions.map((item: any) => item.code),
          knownAttributeCodes: context.definitions.map((item: any) => item.code),
          attributeDictionaryValues: attributeDefinitions.flatMap((item: any) => item.dictionary_values || []),
          priceRules,
          priceReferenceUrls,
        })])
      }
    }

    if (['reprocess', 'selection', 'retry'].includes(mode)) {
      const targetIds = context.products.map((product: any) => Number(product.id)).filter(Number.isInteger)
      if (targetIds.length > 0) {
        await scrapingQuery(`
          UPDATE products SET ai_processed=false,ai_error=NULL,updated_at=NOW()
          WHERE batch_id=$1 AND id=ANY($2::int[])
        `, [batchId, targetIds])
        await scrapingQuery(`
          UPDATE scraping_batches SET stage='SCRIPT_PROCESSED',updated_at=NOW()
          WHERE id=$1 AND stage IN ('AI_PROCESSED','PUSHED')
        `, [batchId])
      }
    }

    const queuedCount = mode === 'variants'
      ? (variantPlan?.visualCandidates.length || 0) + (variantPlan?.shadeCandidates.length || 0)
      : context.products.length
    if (mode === 'variants' && queuedCount === 0) {
      await scrapingQuery(`
        UPDATE batch_ai_runs SET status='completed',completed_at=NOW(),updated_at=NOW()
        WHERE id=$1
      `, [runId])
      await releaseBatchOperation(batchId, runId)
      revalidatePath('/admin/batches')
      return {
        success: true,
        data: {
          runId,
          queued: 0,
          deterministic: variantPlan?.deterministicFamilies.length || 0,
          provider: settings.provider,
        },
      }
    }

    await scrapingQuery(
      'UPDATE batch_ai_runs SET status=$2,updated_at=NOW() WHERE id=$1',
      [runId, settings.provider === 'cockpit' ? 'queued' : 'running'],
    )

    revalidatePath('/admin/batches')
    if (settings.provider !== 'cockpit') {
      after(async () => {
        try {
          await processOpenRouterRun(runId, context, settings)
        } catch (error) {
          await scrapingQuery(`
            UPDATE batch_ai_runs SET status='failed',error_message=$2,completed_at=NOW(),updated_at=NOW()
            WHERE id=$1 AND status IN ('queued','running')
          `, [runId, String((error as any)?.message || error).slice(0, 4000)]).catch(() => undefined)
          await releaseBatchOperation(batchId, runId).catch(() => undefined)
          throw error
        }
      })
    }
    return {
      success: true,
      data: {
        runId,
        queued: queuedCount,
        deterministic: variantPlan?.deterministicFamilies.length || 0,
        provider: settings.provider,
      },
    }
  } catch (error: any) {
    await scrapingQuery(`
      UPDATE batch_ai_runs SET status='failed',error_message=$2,completed_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND status IN ('preparing','queued','running')
    `, [runId, String(error.message || error).slice(0, 4000)]).catch(() => undefined)
    if (operationClaimed) await releaseBatchOperation(batchId, runId).catch(() => undefined)
    return { success: false, error: error.message }
  }
}

async function isLatestBatch(batchId: string) {
  const latest = await scrapingQuery(`
    SELECT id FROM scraping_batches
    WHERE COALESCE(stage, '') <> 'ADMIN_DELETED'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `)
  return String(latest.rows[0]?.id || '') === String(batchId)
}

async function syncBatchProductSlugsFromRails(batchId: string) {
  const products = await scrapingQuery(`
    SELECT external_id FROM products
    WHERE batch_id=$1
    ORDER BY source_position ASC NULLS LAST, id
  `, [batchId])
  const externalIds = products.rows.map((row) => String(row.external_id || '').trim()).filter(Boolean)
  if (externalIds.length === 0) throw new Error('В выгрузке нет товаров для генерации alt и slug')

  const refreshed = await refreshRailsProductSlugs(externalIds)
  const invalid = refreshed.products.filter((product) => !product.slug || !product.seo_article)
  if (refreshed.missingExternalIds.length > 0 || invalid.length > 0 || refreshed.products.length !== new Set(externalIds).size) {
    throw new Error('Сначала опубликуйте выгрузку в каталог: для части товаров Rails не вернул внутренний артикул')
  }

  await scrapingQuery(`
    UPDATE products AS product SET slug=source.slug,updated_at=NOW()
    FROM jsonb_to_recordset($2::jsonb) AS source(external_id text,slug text)
    WHERE product.batch_id=$1 AND product.external_id=source.external_id
  `, [batchId, JSON.stringify(refreshed.products.map((product) => ({
    external_id: product.external_id,
    slug: product.slug,
  })))])
}

export async function getBatchMediaSeoStatusAction(batchId: string) {
  await requireAdmin()
  return { success: true, data: { allowed: await isLatestBatch(batchId) } }
}

export async function startBatchMediaSeoAction(batchId: string, productIds?: number[]) {
  await requireAdmin()
  if (!await isLatestBatch(batchId)) {
    return { success: false, error: 'Alt и slug можно сгенерировать только для самой последней выгрузки' }
  }
  try {
    await syncBatchProductSlugsFromRails(batchId)
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось получить slug товаров из каталога' }
  }
  return startBatchAiAction(batchId, 'media_seo', productIds)
}

async function processOpenRouterRun(runId: string, context: any, settings: BatchAiSettings) {
  const items = await scrapingQuery("SELECT * FROM batch_ai_items WHERE run_id=$1 AND status='queued' ORDER BY created_at", [runId])
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
  let rawOutput: any = null
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
    rawOutput = raw
    if (input.fullSizeRefinementEnabled && Array.isArray(raw?.inspect_full_size_indexes) && raw.inspect_full_size_indexes.length) {
      raw = await runBatchAiOpenRouterRefinement({
        settings,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        previousOutput: raw,
        photoUrls: input.photoUrls || [],
        indexes: raw.inspect_full_size_indexes,
      })
      rawOutput = raw
    }
    let normalized: any = input.mediaSeoOnly
      ? normalizeMediaSeoOutput(raw, input)
      : input.variantScanOnly
      ? variantScanResult(raw, input)
      : normalizeBatchAiOutput(raw, {
      product: input.product,
      brandIds: new Set(context.brands.map((row: any) => String(row.id))),
      categoryIds: new Set(context.categories.map((row: any) => String(row.id))),
      subcategoryIds: new Set(context.subcategories.map((row: any) => String(row.id))),
      subcategoryParents: new Map(context.subcategories.map((row: any) => [String(row.id), String(row.parent_id || '')])),
      categoryNames: new Map(context.categories.map((row: any) => [String(row.id), String(row.name || '')])),
      subcategoryNames: new Map(context.subcategories.map((row: any) => [String(row.id), String(row.name || '')])),
      attributeCodes: new Set((input.attributeCodes || []).map(String)),
      knownAttributeCodes: new Set((input.knownAttributeCodes || []).map(String)),
      attributeDictionaryValues: input.attributeDictionaryValues || [],
      priceRuleKeys: new Set((input.priceRules || []).map((row: any) => String(row.rule_key))),
    })
    if (input.shadeFamilyScan && shadeScanHasColorConflicts(normalized.shadeVariants)) {
      const repairedRaw = await runBatchAiOpenRouter({
        settings,
        systemPrompt: input.systemPrompt,
        userPrompt: buildBatchAiShadeRepairPrompt(input.candidateProducts || [], normalized.shadeVariants || []),
        contactSheets: sheets,
      })
      const repaired = variantScanResult(repairedRaw, input)
      if (repaired.shadeVariants.length === (input.candidateProducts || []).length
        && !shadeScanHasColorConflicts(repaired.shadeVariants)) {
        normalized = repaired
        rawOutput = repairedRaw
      }
    }
    if (input.mediaSeoOnly) await applyCompletedMediaSeoItem(item, normalized)
    else if (input.variantScanOnly) await applyCompletedVariantScan(item, normalized)
    else await applyCompletedItem(item, normalized, context)
  } catch (error: any) {
    const failed = await scrapingQuery(`
      UPDATE batch_ai_items i SET status='failed',error_message=$2,output=$3::jsonb,completed_at=NOW(),updated_at=NOW()
      FROM batch_ai_runs r
      WHERE i.id=$1 AND i.run_id=r.id AND i.status='running' AND r.status <> 'cancelled'
      RETURNING i.product_id
    `, [item.id, String(error.message || error).slice(0, 4000), JSON.stringify(rawOutput ?? null)])
    if (failed.rows[0] && !item.input_snapshot?.variantScanOnly && !item.input_snapshot?.measurementRecoveryOnly && !item.input_snapshot?.mediaSeoOnly) {
      await scrapingQuery('UPDATE products SET ai_error=$2,updated_at=NOW() WHERE id=$1', [item.product_id, String(error.message || error).slice(0, 4000)])
    }
  } finally {
    await touchBatchOperation(String(context.batch.id), String(item.run_id)).catch(() => undefined)
  }
}

function variantScanResult(raw: any, input: any) {
  const product = input.product
  if (input.shadeFamilyScan) {
    const candidates = Array.isArray(input.candidateProducts) ? input.candidateProducts : []
    return {
      product,
      shadeVariants: normalizeShadeScanOutput(raw, candidates),
      familyIdentityKey: String(input.familyIdentityKey || ''),
      suggestions: [],
      subcategorySuggestion: null,
      colorFamily: null,
      mediaDecision: { discard: [], sizeCharts: [] },
    }
  }
  if (input.visualFamilyScan) {
    const candidates = Array.isArray(input.candidateProducts) ? input.candidateProducts : []
    const colorFamilies = normalizeVisualFamilyScanOutput(raw, candidates)
    return { product, colorFamilies, suggestions: [], subcategorySuggestion: null, colorFamily: null, mediaDecision: { discard: [], sizeCharts: [] } }
  }
  return {
    product,
    suggestions: [],
    subcategorySuggestion: null,
    colorFamily: raw?.color_family || null,
    mediaDecision: { discard: [], sizeCharts: [] },
  }
}

function shadeScanHasColorConflicts(variants: any[]) {
  const counts = new Map<string, number>()
  for (const variant of Array.isArray(variants) ? variants : []) {
    if (variant?.duplicateOfProductId) continue
    const color = normalizedColorFamilyValue(variant?.color)
    if (color) counts.set(color, (counts.get(color) || 0) + 1)
  }
  return [...counts.values()].some((count) => count > 1)
}

async function applyCompletedVariantScan(item: any, normalized: any) {
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [item.run_id])
    if (!run.rows[0] || run.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return
    }
    await client.query(`
      UPDATE batch_ai_items SET status='completed',output=$2::jsonb,error_message=NULL,
        completed_at=NOW(),updated_at=NOW()
      WHERE id=$1
    `, [item.id, JSON.stringify(normalized)])
    if (Array.isArray(normalized.shadeVariants)) {
      await applyShadeVariantsToSuggestion(client, item.run_id, normalized)
    } else if (Array.isArray(normalized.colorFamilies)) {
      for (const family of normalized.colorFamilies) {
        const ids = family.products.map((product: any) => Number(product.id)).sort((a: number, b: number) => a - b)
        await savePreparedColorFamilySuggestion(client, item.run_id, {
          identityKey: `visual|${crypto.createHash('sha256').update(ids.join(':')).digest('hex')}`,
          products: family.products,
          source: 'visual_comparison',
          confidence: family.confidence,
          matchingEvidence: family.matchingEvidence,
          duplicateProducts: family.duplicateProducts,
          suggestedColors: family.suggestedColors,
          familyDefinition: item.input_snapshot?.familyDefinition,
        })
      }
    } else {
      await saveBatchAiSuggestions(client, item.run_id, item.product_id, normalized)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function applyCompletedMediaSeoItem(item: any, normalized: any) {
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [item.run_id])
    if (!run.rows[0] || run.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return
    }
    await client.query(`
      UPDATE products SET slug=$2,photo_alts=$3::jsonb,photo_slugs=$4::jsonb,updated_at=NOW()
      WHERE id=$1
    `, [item.product_id, normalized.slug, JSON.stringify(normalized.photo_alts || []), JSON.stringify(normalized.photo_slugs || [])])
    await client.query(`
      UPDATE batch_ai_items SET status='completed',output=$2::jsonb,error_message=NULL,
        completed_at=NOW(),updated_at=NOW()
      WHERE id=$1
    `, [item.id, JSON.stringify(normalized)])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function applyCompletedItem(item: any, normalized: any, context: any) {
  const product = normalized.product
  const measurementRecoveryOnly = item.input_snapshot?.measurementRecoveryOnly === true
  const recoveredMeasurements = product?.attributes?.measurements
  if (measurementRecoveryOnly && (!recoveredMeasurements || typeof recoveredMeasurements !== 'object')) {
    throw new Error('ИИ не распознал таблицу замеров')
  }
  if (item.input_snapshot?.preserveExistingPrice) {
    product.price = Number(item.input_snapshot.product?.price || 0)
    product.price_source = item.input_snapshot.product?.price_source || 'legacy'
  } else {
    const rule = product.price_source === 'manual' ? null : matchingPriceRule(product, context.priceRules)
    if (rule) {
      product.price = Number(rule.price)
      product.price_source = 'rule'
    } else if (!Number(product.price) && Number(context.batch.default_price)) {
      product.price = Number(context.batch.default_price)
      product.price_source = 'default'
    }
  }
  if (!String(item.input_snapshot?.product?.slug || '').trim()) {
    product.slug = buildProductSeoSlug(product, catalogName(product.brand, 'brand', context.mappings))
  }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [item.run_id])
    if (!run.rows[0] || run.rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return
    }
    if (measurementRecoveryOnly) {
      const targetIds = [...new Set((item.input_snapshot?.measurementTargetProductIds || [])
        .map(Number)
        .filter(Number.isInteger))]
      if (targetIds.length === 0) throw new Error('Не найдены товары для привязки таблицы замеров')
      await client.query(`
        UPDATE products SET
          attributes=jsonb_set(COALESCE(attributes,'{}'::jsonb),'{measurements}',$2::jsonb,true),
          updated_at=NOW()
        WHERE batch_id=$1 AND id=ANY($3::int[])
      `, [context.batch.id, JSON.stringify(recoveredMeasurements), targetIds])
      await client.query(`
        UPDATE batch_ai_items SET status='completed',output=$2::jsonb,error_message=NULL,completed_at=NOW(),updated_at=NOW()
        WHERE id=$1
      `, [item.id, JSON.stringify(normalized)])
      await client.query('COMMIT')
      return
    }
    await client.query(`
      UPDATE products SET
        name=$2,description=$3,h1=$4,seo_title=$5,seo_description=$6,slug=$7,
        brand=$8,category=$9,subcategory=$10,gender=$11,photos=$12::jsonb,
        photo_alts=$13::jsonb,attributes=$14::jsonb,price=$15,price_source=$16,ai_processed=true,
        ai_error=NULL,ai_confidence=$17,updated_at=NOW()
      WHERE id=$1
    `, [
      item.product_id, product.name, product.description, product.h1, product.seo_title,
      product.seo_description, product.slug, product.brand, product.category, product.subcategory || null,
      product.gender || null, JSON.stringify(product.photos || []), JSON.stringify(product.photo_alts || []), JSON.stringify(product.attributes || {}),
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
  if (!runState.rows[0] || ['preparing', 'completed', 'failed', 'cancelled'].includes(runState.rows[0].status)) return
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
    const currentRun = run.rows[0]
    try {
      if (currentRun?.mode === 'recover_measurements') {
        await snapshotBatch(currentRun.batch_id, 'PUSHED', 'Замеры восстановлены', currentRun.settings_snapshot)
        return
      }
      let promoteBatch = false
      if (!['variants', 'media_seo'].includes(currentRun?.mode)) {
        const remaining = await scrapingQuery(`
          SELECT 1 FROM products
          WHERE batch_id=$1 AND COALESCE(ai_processed, false)=false
          LIMIT 1
        `, [currentRun.batch_id])
        promoteBatch = remaining.rows.length === 0
      }
      if (promoteBatch) {
        await scrapingQuery("UPDATE scraping_batches SET stage='AI_PROCESSED',updated_at=NOW() WHERE id=$1", [currentRun.batch_id])
      }
      if (!['variants', 'media_seo'].includes(currentRun?.mode)) {
        await snapshotBatch(currentRun.batch_id, promoteBatch ? 'AI_PROCESSED' : 'SCRIPT_PROCESSED', promoteBatch ? 'Обработано ИИ' : 'Частично обработано ИИ', currentRun.settings_snapshot)
      }
    } finally {
      await releaseBatchOperation(String(currentRun.batch_id), runId)
    }
  } else if (row.pending === 0) {
    const finishedRun = await scrapingQuery('SELECT batch_id FROM batch_ai_runs WHERE id=$1', [runId])
    if (finishedRun.rows[0]) await releaseBatchOperation(String(finishedRun.rows[0].batch_id), runId)
  }
}

async function resumeStaleOpenRouterRun(runId: string) {
  const locked = await scrapingQuery(`
    UPDATE batch_ai_runs r SET started_at=NOW(),updated_at=NOW()
    WHERE r.id=$1 AND r.provider IN ('openrouter','byesu') AND r.status='running'
      AND COALESCE(r.started_at,r.created_at) < NOW() - INTERVAL '60 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM batch_ai_items i
        WHERE i.run_id=r.id AND i.status='running' AND i.updated_at > NOW() - INTERVAL '90 seconds'
      )
      AND EXISTS (
        SELECT 1 FROM batch_ai_items i
        WHERE i.run_id=r.id AND (
          i.status='queued'
          OR (i.status='running' AND i.updated_at <= NOW() - INTERVAL '90 seconds')
          OR (i.status='failed' AND i.attempts < 2 AND i.error_message='ИИ вернул невалидный JSON')
        )
      )
    RETURNING r.batch_id,r.mode,r.settings_snapshot
  `, [runId])
  const run = locked.rows[0]
  if (!run) return
  const operation = await scrapingQuery('SELECT owner_id FROM batch_operation_locks WHERE batch_id=$1', [run.batch_id])
  if (!operation.rows[0]) {
    const claimed = await claimBatchOperation(String(run.batch_id), 'ai', runId)
    if (!claimed) return
  } else if (String(operation.rows[0].owner_id) !== runId) {
    await scrapingQuery(`
      UPDATE batch_ai_runs SET status='failed',error_message='Выгрузка занята другой операцией',completed_at=NOW(),updated_at=NOW()
      WHERE id=$1
    `, [runId])
    return
  }
  await scrapingQuery(`
    UPDATE batch_ai_items SET status='queued',error_message=NULL,completed_at=NULL,updated_at=NOW()
    WHERE run_id=$1 AND (
      (status='running' AND updated_at <= NOW() - INTERVAL '90 seconds')
      OR (status='failed' AND attempts < 2 AND error_message='ИИ вернул невалидный JSON')
    )
  `, [runId])
  const context = await batchContext(String(run.batch_id), run.mode as BatchAiRunMode)
  const settings = run.settings_snapshot as BatchAiSettings
  after(async () => {
    await processOpenRouterRun(runId, context, settings)
  })
}

async function getBatchAiRun(runId: string) {
  const run = await scrapingQuery('SELECT * FROM batch_ai_runs WHERE id=$1', [runId])
  const errors = await scrapingQuery(`
    SELECT i.product_id,i.external_id,i.error_message,i.attempts,i.updated_at,
           p.name,p.photos,i.output
    FROM batch_ai_items i
    LEFT JOIN products p ON p.id=i.product_id
    WHERE i.run_id=$1 AND i.status='failed' ORDER BY i.created_at
  `, [runId])
  const queue = await scrapingQuery(`
    SELECT i.product_id,i.external_id,i.status,p.name,p.photos
    FROM batch_ai_items i
    LEFT JOIN products p ON p.id=i.product_id
    WHERE i.run_id=$1 AND i.status IN ('running','queued')
    ORDER BY CASE WHEN i.status='running' THEN 0 ELSE 1 END,i.created_at
    LIMIT 12
  `, [runId])
  const normalizeQueuePhotos = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
    if (typeof value !== 'string' || !value.trim()) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return {
    ...run.rows[0],
    errors: errors.rows,
    queue_items: queue.rows.map((item) => ({ ...item, photos: normalizeQueuePhotos(item.photos) })),
  }
}

export async function getBatchAiRunAction(runId: string) {
  await requireAdmin()
  await finalizeRun(runId)
  await resumeStaleOpenRouterRun(runId)
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
  await resumeStaleOpenRouterRun(String(latest.rows[0].id))
  return { success: true, data: await getBatchAiRun(String(latest.rows[0].id)) }
}

export async function getBatchAiRunLogsAction(runId: string, limit = 500) {
  await requireAdmin()
  const safeLimit = Math.min(1000, Math.max(50, Number(limit) || 500))
  const result = await scrapingQuery(`
    SELECT i.product_id,i.external_id,i.status,i.error_message,i.attempts,
           i.created_at,i.updated_at,i.completed_at,i.output,p.name,p.slug,p.photo_alts
    FROM batch_ai_items i
    LEFT JOIN products p ON p.id=i.product_id
    WHERE i.run_id=$1
    ORDER BY i.created_at ASC
    LIMIT $2
  `, [runId, safeLimit])
  return { success: true, data: result.rows }
}

export async function stopBatchAiRunAction(runId: string) {
  await requireAdmin()
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const run = await client.query('SELECT id,batch_id,status FROM batch_ai_runs WHERE id=$1 FOR UPDATE', [runId])
    if (!run.rows[0]) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Запуск ИИ не найден' }
    }
    await client.query('DELETE FROM batch_operation_locks WHERE batch_id=$1 AND owner_id=$2', [run.rows[0].batch_id, runId])
    if (['preparing', 'queued', 'running'].includes(run.rows[0].status)) {
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
  const operationOwnerId = await claimBatchOperation(batchId, 'rollback')
  if (!operationOwnerId) return { success: false, error: 'Выгрузка занята другой операцией' }
  const client = await getScrapingClient()
  try {
    const snapshot = await client.query('SELECT * FROM batch_snapshots WHERE id=$1 AND batch_id=$2', [snapshotId, batchId])
    if (!snapshot.rows[0]) return { success: false, error: 'Снимок не найден' }
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
          ai_processed,batch_id,h1,seo_title,seo_description,price_source,variant_group_key,variant_group_name,ai_error,ai_confidence,source_position,supplier_published_on,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      `, [
        row.external_id, row.name, row.description, row.price, row.status, row.brand, row.category,
        row.subcategory, row.gender, JSON.stringify(row.photos || []), JSON.stringify(row.attributes || {}),
        row.ai_processed || false, batchId, row.h1, row.seo_title, row.seo_description,
        row.price_source || 'legacy', row.variant_group_key, row.variant_group_name || null, row.ai_error, row.ai_confidence,
        row.source_position ?? position, row.supplier_published_on || null, row.created_at || new Date(), new Date(),
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
    await releaseBatchOperation(batchId, operationOwnerId).catch(() => undefined)
  }
}

export async function rollbackBatchProductAiAction(batchId: string, productId: number) {
  await requireAdmin()
  const operationOwnerId = await claimBatchOperation(batchId, 'rollback')
  if (!operationOwnerId) return { success: false, error: 'Выгрузка занята другой операцией' }
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const current = await client.query(
      'SELECT * FROM products WHERE id=$1 AND batch_id=$2 FOR UPDATE',
      [productId, batchId],
    )
    if (!current.rows[0]) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Товар не найден' }
    }
    const item = await client.query(`
      SELECT i.input_snapshot
      FROM batch_ai_items i
      JOIN batch_ai_runs r ON r.id=i.run_id
      WHERE r.batch_id=$1
        AND (i.product_id=$2 OR i.external_id=$3)
        AND i.status='completed'
        AND COALESCE(i.input_snapshot->>'variantScanOnly','false') <> 'true'
      ORDER BY i.completed_at DESC NULLS LAST,i.created_at DESC
      LIMIT 1
    `, [batchId, productId, current.rows[0].external_id])
    const source = item.rows[0]?.input_snapshot?.product
    if (!source) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Для этого товара нет состояния до ИИ' }
    }
    const mappingResult = await client.query(`
      SELECT entity_type,legacy_id,canonical_id,name,canonical_parent_id
      FROM catalog_id_mappings
    `)
    const restored = normalizeProductsCatalogReferences(
      [source],
      mappingResult.rows as CatalogIdMapping[],
    )[0]
    await client.query(`
      UPDATE products SET
        external_id=$3,name=$4,description=$5,h1=$6,seo_title=$7,seo_description=$8,
        price=$9,status=$10,brand=$11,category=$12,subcategory=$13,gender=$14,
        photos=$15::jsonb,attributes=$16::jsonb,ai_processed=false,ai_error=NULL,
        ai_confidence=NULL,price_source=$17,variant_group_key=$18,variant_group_name=$19,source_position=$20,supplier_published_on=$21,updated_at=NOW()
      WHERE id=$1 AND batch_id=$2
    `, [
      productId, batchId, restored.external_id || current.rows[0].external_id,
      restored.name || '', restored.description || '', restored.h1 || '',
      restored.seo_title || '', restored.seo_description || '', Number(restored.price || 0),
      restored.status || 'inactive', restored.brand || null, restored.category || null,
      restored.subcategory || null, restored.gender || null, JSON.stringify(restored.photos || []),
      JSON.stringify(restored.attributes || {}), restored.price_source || 'legacy',
      restored.variant_group_key || null, restored.variant_group_name || current.rows[0].variant_group_name || null, restored.source_position ?? current.rows[0].source_position, restored.supplier_published_on || null,
    ])
    await client.query(`
      UPDATE scraping_batches SET
        stage=CASE WHEN stage IN ('AI_PROCESSED','PUSHED') THEN 'SCRIPT_PROCESSED' ELSE stage END,
        updated_at=NOW()
      WHERE id=$1
    `, [batchId])
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    revalidatePath(`/admin/batches/${batchId}`)
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
    await releaseBatchOperation(batchId, operationOwnerId).catch(() => undefined)
  }
}

export async function reviewBatchAiSuggestionAction(
  id: string,
  decision: 'approved' | 'rejected',
  editedPayload?: any,
  selectedProductIds?: number[],
  colorOverrides?: Record<string, string>,
) {
  try {
    return await reviewBatchAiSuggestion(id, decision, editedPayload, selectedProductIds, colorOverrides)
  } catch (error: any) {
    console.error('Failed to review batch AI suggestion', { id, decision, error })
    return { success: false, error: error?.message || 'Не удалось применить предложение ИИ' }
  }
}

async function reviewBatchAiSuggestion(
  id: string,
  decision: 'approved' | 'rejected',
  editedPayload?: any,
  selectedProductIds?: number[],
  colorOverrides?: Record<string, string>,
) {
  await requireAdmin()
  const suggestion = await scrapingQuery('SELECT * FROM batch_ai_suggestions WHERE id=$1', [id])
  const row = suggestion.rows[0]
  if (!row) return { success: false, error: 'Предложение не найдено' }
  if (decision === 'approved') {
    const run = await scrapingQuery('SELECT batch_id FROM batch_ai_runs WHERE id=$1', [row.run_id])
    const batchId = run.rows[0]?.batch_id ? String(run.rows[0].batch_id) : ''
    if (batchId && await activeBatchOperation(batchId)) {
      return { success: false, error: 'Дождитесь завершения обработки выгрузки перед применением предложения' }
    }
  }
  if (editedPayload && typeof editedPayload === 'object' && !Array.isArray(editedPayload)) {
    row.payload = editedPayload
    await scrapingQuery('UPDATE batch_ai_suggestions SET payload=$2::jsonb WHERE id=$1', [id, JSON.stringify(editedPayload)])
  }
  if (decision === 'approved' && row.kind === 'color_family' && Array.isArray(selectedProductIds)) {
    const allowed = new Set((row.affected_product_ids || []).map(Number))
    const selected = [...new Set(selectedProductIds.map(Number).filter((id) => allowed.has(id)))]
    if (selected.length < 2) return { success: false, error: 'Выберите минимум два товара разных цветов' }
    row.affected_product_ids = selected
  }
  if (decision === 'approved' && row.kind === 'color_family') {
    if (row.affected_product_ids.length < 2) {
      return { success: false, error: 'Для цветового семейства нужны минимум два товара разных цветов' }
    }
    const familyProducts = await scrapingQuery(
      'SELECT id,attributes FROM products WHERE id=ANY($1::int[])',
      [row.affected_product_ids.map(Number)],
    )
    const resolvedColors = familyProducts.rows.map((product) => {
      const override = String(colorOverrides?.[String(product.id)] || '').trim().slice(0, 80)
      const suggested = String(row.payload?.suggested_colors?.[String(product.id)]?.color || '').trim().slice(0, 80)
      const current = Array.isArray(product.attributes?.colors) ? String(product.attributes.colors[0] || '').trim() : ''
      return { product, color: override || suggested || current }
    })
    const actualColors = resolvedColors.map(({ color }) => normalizedColorFamilyValue(color))
    const uniqueColors = new Set(actualColors.filter(Boolean))
    const finalResolvedColors = actualColors.some((color) => !color) || uniqueColors.size !== actualColors.length
      ? (() => {
          const unique = ensureUniqueFamilyColors(
            resolvedColors.map(({ product, color }) => ({ ...product, attributes: { ...(product.attributes || {}), colors: [color] } })),
            Object.fromEntries(resolvedColors.map(({ product, color }) => [String(product.id), { color }])),
          )
          return resolvedColors.map(({ product }) => ({ product, color: unique[String(product.id)]?.color || '' }))
        })()
      : resolvedColors
    const finalActualColors = finalResolvedColors.map(({ color }) => normalizedColorFamilyValue(color))
    if (finalActualColors.some((color) => !color) || new Set(finalActualColors).size !== finalActualColors.length) {
      return { success: false, error: 'Укажите разные названия оттенков или исключите настоящие дубли.' }
    }
    for (const { product, color } of finalResolvedColors) {
      const baseColor = inferBaseColor(color)
      await scrapingQuery(`
        UPDATE products SET attributes=jsonb_set(
          jsonb_set(COALESCE(attributes,'{}'::jsonb),'{colors}',$2::jsonb,true),
          '{base_colors}',$3::jsonb,true
        ),updated_at=NOW()
        WHERE id=$1
      `, [Number(product.id), JSON.stringify([color]), JSON.stringify(baseColor ? [baseColor] : [])])
    }
    row.payload = {
      ...row.payload,
      observed_colors: finalResolvedColors.map(({ color }) => color).sort(),
      base_colors: [...new Set(finalResolvedColors.map(({ color }) => inferBaseColor(color)).filter(Boolean))].sort(),
      color_conflicts: [],
    }
    const familyKey = String(row.payload?.product_identity_key || canonicalColorFamilyKey(row.payload))
    const key = crypto.createHash('sha256').update(familyKey || row.canonical_key).digest('hex').slice(0, 32)
    const sourceModelCode = String(row.payload?.source_model_code || '').trim()
    if (sourceModelCode) {
      await scrapingQuery(`
        UPDATE products SET
          variant_group_key=$1,
          attributes=jsonb_set(COALESCE(attributes,'{}'::jsonb),'{model_code}',$3::jsonb,true),
          updated_at=NOW()
        WHERE id=ANY($2::int[])
      `, [key, row.affected_product_ids.map(Number), JSON.stringify(sourceModelCode)])
    } else {
      await scrapingQuery(
        'UPDATE products SET variant_group_key=$1,updated_at=NOW() WHERE id=ANY($2::int[])',
        [key, row.affected_product_ids.map(Number)],
      )
    }
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
  await scrapingQuery(`
    UPDATE batch_ai_suggestions
    SET status=$2,affected_product_ids=$3::jsonb,payload=$4::jsonb,reviewed_at=NOW()
    WHERE id=$1
  `, [id, decision, JSON.stringify(row.affected_product_ids || []), JSON.stringify(row.payload || {})])
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
    const bagCatalog = await client.query(`
      SELECT entity_type,canonical_id,name
      FROM catalog_id_mappings
      WHERE (entity_type='category' AND lower(name)='сумки')
         OR (entity_type='subcategory' AND lower(name) IN (
           'сумки','сумки-косметички','сумки-кейсы','сумки с клапаном','сумки на плечо'
           ,'сумки-багет','мини-сумки','сумки-боулинг','пляжные сумки'
         ))
    `)
    const bagCategoryId = bagCatalog.rows.find((row) => row.entity_type === 'category')?.canonical_id
    const genericBagId = bagCatalog.rows.find((row) => row.entity_type === 'subcategory' && String(row.name).toLowerCase() === 'сумки')?.canonical_id
    const shoulderBagId = bagCatalog.rows.find((row) => row.entity_type === 'subcategory' && String(row.name).toLowerCase() === 'сумки на плечо')?.canonical_id
    const redirectedIds = bagCatalog.rows
      .filter((row) => row.entity_type === 'subcategory' && [
        'сумки-косметички',
        'сумки-кейсы',
        'сумки с клапаном',
        'сумки-багет',
        'мини-сумки',
        'сумки-боулинг',
        'пляжные сумки',
      ].includes(String(row.name).toLowerCase()))
      .map((row) => String(row.canonical_id))
    if (bagCategoryId && shoulderBagId && redirectedIds.length) {
      await client.query(`
        UPDATE products SET subcategory=$3,updated_at=NOW()
        WHERE batch_id=$1 AND category=$2 AND subcategory=ANY($4::text[])
      `, [batchId, String(bagCategoryId), String(shoulderBagId), redirectedIds])
    }
    if (bagCategoryId && genericBagId) {
      await client.query(`
        UPDATE products SET ai_processed=false,
          ai_error='Для категории «Сумки» требуется конкретная подкатегория',updated_at=NOW()
        WHERE batch_id=$1 AND category=$2 AND subcategory=$3 AND COALESCE(ai_processed,false)=true
      `, [batchId, String(bagCategoryId), String(genericBagId)])
    }
    await reconcileBatchSubcategorySuggestions(client, batchId)
    await reconcileBatchColorFamilySuggestions(client, batchId)
    if (knownAttributeCodes) {
      await reconcileKnownAttributeSuggestions(client, batchId, knownAttributeCodes)
    }
    const result = await client.query(`
      SELECT * FROM (
        SELECT s.*,
          ROW_NUMBER() OVER (
            PARTITION BY s.kind,s.canonical_key,s.status
            ORDER BY s.created_at DESC
          ) AS duplicate_rank
        FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id WHERE r.batch_id=$1
      ) s
      WHERE s.duplicate_rank=1
        AND (
          s.kind <> 'color_family'
          OR s.status <> 'pending'
          OR (
            jsonb_array_length(s.affected_product_ids) >= 2
            AND (
              COALESCE(jsonb_array_length(s.payload->'observed_colors'),0) >= 2
              OR COALESCE(jsonb_array_length(s.payload->'color_conflicts'),0) >= 1
            )
          )
        )
      ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.created_at DESC
    `, [batchId])
    const affectedProductIds = [...new Set(
      result.rows.flatMap((suggestion: any) =>
        Array.isArray(suggestion.affected_product_ids) ? suggestion.affected_product_ids : []
      )
    )]
    const affectedProducts = affectedProductIds.length
      ? await client.query(`
          SELECT id,name,external_id,description,brand,category,subcategory,gender,price,photos,attributes,variant_group_key,source_position
          FROM products
          WHERE id=ANY($1::int[])
        `, [affectedProductIds])
      : { rows: [] }
    const productsById = new Map(
      affectedProducts.rows.map((product: any) => [Number(product.id), product])
    )
    const suggestions = result.rows.map((suggestion: any) => ({
      ...suggestion,
      affected_products: (suggestion.affected_product_ids || [])
        .map((id: number) => productsById.get(Number(id)))
        .filter(Boolean),
    }))
    await client.query('COMMIT')
    return { success: true, data: suggestions }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message, data: [] }
  } finally {
    client.release()
  }
}

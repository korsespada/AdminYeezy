'use server';

import { revalidatePath } from 'next/cache'
import { query, scrapingQuery, getScrapingClient, redis, describeScrapingDatabaseConnection } from '@/lib/db'
import { deleteS3Folder } from '@/lib/s3'
import type { ActionResponse } from '@/lib/types'
import { requireAdmin } from '@/lib/admin-session'
import { resolveSafeRuntimePath } from '@/lib/runtime-paths'
import { extractProductAttributes } from '@/lib/product-attributes'
import { normalizeSupplierAttributeCodes } from '@/lib/supplier-attributes'
import { runCustomSupplierScriptAction } from '@/actions/csv-import'
import { deleteRailsAdminProductsByExternalIds, getRailsCatalogLookups } from '@/lib/rails-admin'
import { claimBatchOperation, releaseBatchOperation } from '@/lib/batch-operation-lock'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import nodeFetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  deleteScrapingFileArtifactForTask,
  deleteScrapingFileArtifactsForBatch,
} from '@/lib/scraping-files'
import { currentBatchHistoryStatus, effectiveBatchHistoryStage } from '@/lib/batch-history'
import { BATCH_PUBLISH_STALE_MS, parseBatchPublishProgress } from '@/lib/batch-publish-progress'

// --- Suppliers CRUD ---

async function requireAdminOrWorker(workerSecret?: string) {
  if (process.env.NODE_ENV !== 'production' && workerSecret === 'dev-api-route') {
    return
  }

  if (
    workerSecret &&
    process.env.SCRAPER_WORKER_SECRET &&
    workerSecret === process.env.SCRAPER_WORKER_SECRET
  ) {
    return
  }

  await requireAdmin()
}

export async function getSuppliersAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery(`
      SELECT
        s.*,
        brand_mapping.name AS default_brand_name,
        category_mapping.name AS default_category_name,
        subcategory_mapping.name AS default_subcategory_name
      FROM suppliers s
      LEFT JOIN catalog_id_mappings brand_mapping
        ON brand_mapping.entity_type = 'brand'
        AND (brand_mapping.canonical_id = s.default_brand OR brand_mapping.legacy_id = s.default_brand)
      LEFT JOIN catalog_id_mappings category_mapping
        ON category_mapping.entity_type = 'category'
        AND (category_mapping.canonical_id = s.default_category OR category_mapping.legacy_id = s.default_category)
      LEFT JOIN catalog_id_mappings subcategory_mapping
        ON subcategory_mapping.entity_type = 'subcategory'
        AND (subcategory_mapping.canonical_id = s.default_subcategory OR subcategory_mapping.legacy_id = s.default_subcategory)
      ORDER BY s.name ASC
    `)
    const unresolved = res.rows.some((row) =>
      (row.default_brand && !row.default_brand_name) ||
      (row.default_category && !row.default_category_name) ||
      (row.default_subcategory && !row.default_subcategory_name),
    )
    if (unresolved) {
      const [brands, categories, subcategories] = await Promise.all([
        query('SELECT id::text, name FROM brands'),
        query('SELECT id::text, name FROM categories'),
        query('SELECT id::text, name FROM subcategories'),
      ])
      const brandNames = new Map(brands.rows.map((row) => [String(row.id), row.name]))
      const categoryNames = new Map(categories.rows.map((row) => [String(row.id), row.name]))
      const subcategoryNames = new Map(subcategories.rows.map((row) => [String(row.id), row.name]))
      for (const row of res.rows) {
        row.default_brand_name ||= brandNames.get(String(row.default_brand || '')) || null
        row.default_category_name ||= categoryNames.get(String(row.default_category || '')) || null
        row.default_subcategory_name ||= subcategoryNames.get(String(row.default_subcategory || '')) || null
      }
    }
    const mappings = await scrapingQuery(`
      SELECT entity_type, canonical_id AS id, name FROM catalog_id_mappings
      WHERE entity_type IN ('brand','category','subcategory')
    `)
    const names = new Map(mappings.rows.map((row) => [`${row.entity_type}:${row.id}`, row.name]))
    for (const row of res.rows) {
      row.allowed_brand_ids = Array.isArray(row.allowed_brand_ids) && row.allowed_brand_ids.length
        ? row.allowed_brand_ids.map(String)
        : row.default_brand ? [String(row.default_brand)] : []
      row.allowed_category_ids = Array.isArray(row.allowed_category_ids) && row.allowed_category_ids.length
        ? row.allowed_category_ids.map(String)
        : row.default_category ? [String(row.default_category)] : []
      row.allowed_subcategory_ids = Array.isArray(row.allowed_subcategory_ids) && row.allowed_subcategory_ids.length
        ? row.allowed_subcategory_ids.map(String)
        : row.default_subcategory ? [String(row.default_subcategory)] : []
      row.allowed_brand_names = row.allowed_brand_ids.map((id: string) => names.get(`brand:${id}`) || id)
      row.allowed_category_names = row.allowed_category_ids.map((id: string) => names.get(`category:${id}`) || id)
      row.allowed_subcategory_names = row.allowed_subcategory_ids.map((id: string) => names.get(`subcategory:${id}`) || id)
    }
    return { success: true, data: res.rows }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getSupplierCatalogLookupsAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await getRailsCatalogLookups()
    return {
      success: true,
      data: {
        brands: result.brands,
        categories: result.categories,
        subcategories: result.subcategories.map((item: any) => ({ ...item, parent_id: item.category || item.parent_id || null })),
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function normalizeSupplierGender(value: FormDataEntryValue | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (['male', 'мужской', 'для мужчин'].includes(normalized)) return 'male'
  if (['female', 'женский', 'для женщин'].includes(normalized)) return 'female'
  if (['unisex', 'унисекс'].includes(normalized)) return 'unisex'
  return null
}

function normalizeMaxOnModelMedia(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 5
  return Math.min(20, Math.max(0, parsed))
}

function normalizeSupplierIdList(value: FormDataEntryValue | null, fallback?: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    if (Array.isArray(parsed)) return [...new Set(parsed.map(String).map((item) => item.trim()).filter(Boolean))]
  } catch { /* use scalar fallback */ }
  const scalar = String(fallback || '').trim()
  return scalar ? [scalar] : []
}

async function canonicalizeSupplierIdList(entityType: 'brand' | 'category' | 'subcategory', ids: string[]) {
  if (!ids.length) return ids
  const mappings = await scrapingQuery(`
    SELECT legacy_id,canonical_id FROM catalog_id_mappings
    WHERE entity_type=$1 AND (legacy_id=ANY($2::text[]) OR canonical_id=ANY($2::text[]))
  `, [entityType, ids])
  const canonicalById = new Map<string, string>()
  for (const row of mappings.rows) {
    canonicalById.set(String(row.legacy_id), String(row.canonical_id))
    canonicalById.set(String(row.canonical_id), String(row.canonical_id))
  }
  return [...new Set(ids.map((id) => canonicalById.get(id) || id))]
}

function mergeSupplierPhotoInstructions(mainInstructions: unknown, photoInstructions: unknown) {
  const main = String(mainInstructions || '').trim()
  const photo = String(photoInstructions || '').trim()
  if (!photo || main.includes(photo)) return main
  return [main, `Особенности фотографий:\n${photo}`].filter(Boolean).join('\n\n')
}

export async function createSupplierAction(formData: FormData): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const name = formData.get('name') as string
    const album_id = formData.get('album_id') as string
    const szwego_parse_mode = formData.get('szwego_parse_mode') === 'all' ? 'all' : 'images'
    const group_id = formData.get('group_id') as string || ''
    const tag_id = formData.get('tag_id') as string || ''
    const allowed_category_ids = await canonicalizeSupplierIdList('category', normalizeSupplierIdList(formData.get('allowed_category_ids'), formData.get('default_category')))
    const allowed_subcategory_ids = await canonicalizeSupplierIdList('subcategory', normalizeSupplierIdList(formData.get('allowed_subcategory_ids'), formData.get('default_subcategory')))
    const allowed_brand_ids = await canonicalizeSupplierIdList('brand', normalizeSupplierIdList(formData.get('allowed_brand_ids'), formData.get('default_brand')))
    const default_category = allowed_category_ids[0] || null
    const default_subcategory = allowed_subcategory_ids[0] || null
    const default_brand = allowed_brand_ids[0] || null
    
    const min_photos_raw = formData.get('min_photos') as string
    const min_photos = (min_photos_raw && min_photos_raw.trim() !== '') ? parseInt(min_photos_raw) : 0
    const max_on_model_media = normalizeMaxOnModelMedia(formData.get('max_on_model_media'))
    const min_desc_raw = formData.get('min_desc_len') as string
    const min_desc_len = (min_desc_raw && min_desc_raw.trim() !== '') ? parseInt(min_desc_raw) : 0
    const brand_tags = formData.get('brand_tags') as string || ''

    const default_price = formData.get('default_price') ? parseFloat(formData.get('default_price') as string) : null
    const default_gender = normalizeSupplierGender(formData.get('default_gender'))
    const ai_deep_search_enabled = formData.get('ai_deep_search_enabled') === 'on'
    const ai_resize_enabled = formData.get('ai_resize_enabled') === 'on'
    const ai_photo_enabled = formData.get('ai_photo_enabled') === 'on'
    const ai_cache_enabled = formData.get('ai_cache_enabled') === 'on'
    const ai_instructions = formData.get('ai_instructions') as string || ''

    const avatar_url = formData.get('avatar_url') as string || null
    const cookie = formData.get('cookie') as string || null
    const post_process_script = formData.get('post_process_script') as string || null
    const post_process_enabled = formData.get('post_process_enabled') === 'on'
    const ai_photo_models = formData.get('ai_photo_models') as string || ''
    const ai_photo_instructions = ''
    const ai_parallel_enabled = formData.get('ai_parallel_enabled') === 'on'
    const ai_parallel_count = parseInt(formData.get('ai_parallel_count') as string || '5')
    const parse_tags_enabled = formData.get('parse_tags_enabled') === 'on'
    const default_attributes = normalizeSupplierAttributeCodes(formData.get('default_attributes'))

    const res = await scrapingQuery(
      `INSERT INTO suppliers (name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, allowed_category_ids, allowed_subcategory_ids, allowed_brand_ids, min_photos, max_on_model_media, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, post_process_enabled, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled, default_attributes, szwego_parse_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32) RETURNING id`,
      [name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, JSON.stringify(allowed_category_ids), JSON.stringify(allowed_subcategory_ids), JSON.stringify(allowed_brand_ids), min_photos, max_on_model_media, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, post_process_enabled, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled, JSON.stringify(default_attributes), szwego_parse_mode]
    )

    revalidatePath('/admin/suppliers')
    return { success: true, data: res.rows[0].id }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function updateSupplierAction(id: number, formData: FormData): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const name = formData.get('name') as string
    const album_id = formData.get('album_id') as string
    const szwego_parse_mode = formData.get('szwego_parse_mode') === 'all' ? 'all' : 'images'
    const group_id = formData.get('group_id') as string || ''
    const tag_id = formData.get('tag_id') as string || ''
    const allowed_category_ids = await canonicalizeSupplierIdList('category', normalizeSupplierIdList(formData.get('allowed_category_ids'), formData.get('default_category')))
    const allowed_subcategory_ids = await canonicalizeSupplierIdList('subcategory', normalizeSupplierIdList(formData.get('allowed_subcategory_ids'), formData.get('default_subcategory')))
    const allowed_brand_ids = await canonicalizeSupplierIdList('brand', normalizeSupplierIdList(formData.get('allowed_brand_ids'), formData.get('default_brand')))
    const default_category = allowed_category_ids[0] || null
    const default_subcategory = allowed_subcategory_ids[0] || null
    const default_brand = allowed_brand_ids[0] || null
    
    const min_photos_raw = formData.get('min_photos') as string
    const min_photos = (min_photos_raw && min_photos_raw.trim() !== '') ? parseInt(min_photos_raw) : 0
    const max_on_model_media = normalizeMaxOnModelMedia(formData.get('max_on_model_media'))
    const min_desc_raw = formData.get('min_desc_len') as string
    const min_desc_len = (min_desc_raw && min_desc_raw.trim() !== '') ? parseInt(min_desc_raw) : 0
    const brand_tags = formData.get('brand_tags') as string || ''

    const default_price = formData.get('default_price') ? parseFloat(formData.get('default_price') as string) : null
    const default_gender = normalizeSupplierGender(formData.get('default_gender'))
    const ai_deep_search_enabled = formData.get('ai_deep_search_enabled') === 'on'
    const ai_resize_enabled = formData.get('ai_resize_enabled') === 'on'
    const ai_photo_enabled = formData.get('ai_photo_enabled') === 'on'
    const ai_cache_enabled = formData.get('ai_cache_enabled') === 'on'
    const currentInstructions = await scrapingQuery(
      'SELECT ai_photo_instructions FROM suppliers WHERE id=$1',
      [id],
    )
    const ai_instructions = mergeSupplierPhotoInstructions(
      formData.get('ai_instructions'),
      currentInstructions.rows[0]?.ai_photo_instructions,
    )

    const avatar_url = formData.get('avatar_url') as string || null
    const cookie = formData.get('cookie') as string || null
    const post_process_script = formData.get('post_process_script') as string || null
    const post_process_enabled = formData.get('post_process_enabled') === 'on'
    const ai_photo_models = formData.get('ai_photo_models') as string || ''
    const ai_photo_instructions = ''
    const ai_parallel_enabled = formData.get('ai_parallel_enabled') === 'on'
    const ai_parallel_count = parseInt(formData.get('ai_parallel_count') as string || '5')
    const parse_tags_enabled = formData.get('parse_tags_enabled') === 'on'
    const default_attributes = normalizeSupplierAttributeCodes(formData.get('default_attributes'))

    await scrapingQuery(
      `UPDATE suppliers SET name=$1, album_id=$2, group_id=$3, tag_id=$4, 
       default_category=$5,default_subcategory=$6,default_brand=$7,
       allowed_category_ids=$8::jsonb,allowed_subcategory_ids=$9::jsonb,allowed_brand_ids=$10::jsonb,
       min_photos=$11,max_on_model_media=$12,min_desc_len=$13,brand_tags=$14,
       default_price=$15,default_gender=$16,
       ai_photo_enabled=$17,ai_cache_enabled=$18,ai_deep_search_enabled=$19,ai_resize_enabled=$20,ai_instructions=$21,avatar_url=$22,cookie=$23,post_process_script=$24,post_process_enabled=$25,ai_photo_models=$26,ai_photo_instructions=$27,ai_parallel_enabled=$28,ai_parallel_count=$29,parse_tags_enabled=$30,default_attributes=$31::jsonb,szwego_parse_mode=$32,updated_at=NOW()
       WHERE id=$33`,
      [name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, JSON.stringify(allowed_category_ids), JSON.stringify(allowed_subcategory_ids), JSON.stringify(allowed_brand_ids), min_photos, max_on_model_media, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, post_process_enabled, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled, JSON.stringify(default_attributes), szwego_parse_mode, id]
    )

    revalidatePath('/admin/suppliers')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function fetchSupplierAvatarAction(supplierId: number): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery('SELECT album_id, cookie FROM suppliers WHERE id=$1', [supplierId])
    const supplier = res.rows[0]
    if (!supplier) return { success: false, error: 'Supplier not found' }

    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParser.py')
    const cookie = supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || ''
    
    return new Promise((resolve) => {
      const pythonProcess = spawn('python', [
        /*turbopackIgnore: true*/ scriptPath,
        '--album_id', supplier.album_id,
        '--cookie', cookie,
        '--get_avatar'
      ])

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      pythonProcess.on('close', async (code) => {
        if (code !== 0) {
          return resolve({ success: false, error: stderr || `Exit code ${code}` })
        }

        const match = stdout.match(/AVATAR_RESULT:(.+)/)
        if (match && match[1]) {
          const avatarUrl = match[1].trim()
          await scrapingQuery('UPDATE suppliers SET avatar_url=$1 WHERE id=$2', [avatarUrl, supplierId])
          revalidatePath('/admin/suppliers')
          return resolve({ success: true, data: avatarUrl })
        } else {
          return resolve({ success: false, error: 'Avatar not found in output' })
        }
      })
    })
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function deleteSupplierAction(id: number): Promise<ActionResponse> {
  try {
    await requireAdmin()
    await scrapingQuery('DELETE FROM suppliers WHERE id=$1', [id])
    revalidatePath('/admin/suppliers')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// --- Scraping Tasks ---

export async function getTasksAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery(`
      SELECT t.*, s.name as supplier_name, s.avatar_url as supplier_avatar, b.stage as batch_stage
      FROM scraping_tasks t
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN scraping_batches b ON b.id = t.batch_id
      ORDER BY t.created_at DESC
      LIMIT 100
    `)
    return { success: true, data: res.rows }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export interface ExportHistoryFile {
  id: number | string
  supplier_id: number | null
  supplier_name: string | null
  supplier_avatar: string | null
  batch_id: string | null
  status: string
  result_path: string | null
  items_count: number
  error_message: string | null
  end_date: string | null
  created_at: string
  updated_at: string
  is_virtual?: boolean
  label?: string
  snapshot_id?: string | null
  snapshot_label?: string | null
  snapshot_missing?: boolean
  is_current?: boolean
}

export interface ExportHistoryBatch {
  id: string
  isSynthetic: boolean
  name: string
  supplier_id: number | null
  supplier_name: string | null
  supplier_avatar: string | null
  items_count: number
  stage?: string | null
  status: string
  end_date: string | null
  created_at: string
  updated_at: string
  raw_path: string | null
  ai_path: string | null
  files: ExportHistoryFile[]
  folder_id: string | null
  folder_name: string | null
  ai_run_status?: string | null
  ai_run_id?: string | null
  ai_completed_count?: number
  ai_failed_count?: number
  product_count?: number
  ai_product_count?: number
  active_operation?: string | null
}

function normalizeTaskStatus(status: string | null, resultPath: string | null) {
  if (resultPath?.includes('task_ai_')) return 'Обработано ИИ'
  if (status === 'running' || status === 'pending') return 'Запущено'
  if (status === 'completed' || status === 'Сырой CSV') return 'Сырой товар'
  if (status === 'Обработано скриптом') return 'Обработан скриптом'
  return status || 'Запущено'
}

function normalizeBatchStatus(stage: string | null, files: ExportHistoryFile[]) {
  if (stage === 'DELETED_FROM_DB') return 'Удалено из БД'
  if (stage === 'PUSHED') return 'Запушено в БД'
  if (stage === 'AI_PROCESSED') return 'Обработано ИИ'
  if (files.some((file) => file.status === 'Запущено')) return 'Запущено'
  if (files[0]?.status === 'failed') return 'failed'
  if (files.some((file) => file.status === 'Обработано ИИ')) return 'Обработано ИИ'
  if (files.some((file) => file.status === 'Обработан скриптом')) return 'Обработан скриптом'
  return 'Сырой товар'
}

function parseDelimitedLine(line: string, delimiter = ';') {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  values.push(current.trim())
  return values
}

function isScrapingConnectionError(err: any) {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '').toLowerCase()

  return (
    code === 'etimeout' ||
    code === 'econnrefused' ||
    code === 'enotfound' ||
    code === 'econnreset' ||
    message.includes('connection terminated due to connection timeout') ||
    message.includes('connection timeout') ||
    message.includes('connection refused') ||
    message.includes('connect etimedout') ||
    message.includes('getaddrinfo enotfound')
  )
}

function formatScrapingConnectionError(err: any) {
  const db = describeScrapingDatabaseConnection()
  const original = err?.message || 'неизвестная ошибка подключения'

  console.error('scraping db unreachable', {
    source: db.source,
    host: db.host,
    port: db.port,
    database: db.database,
    code: err?.code,
    message: original,
  })

  return [
    `Не удалось подключиться к технической базе выгрузок ${db.database} (${db.source}: ${db.host}:${db.port}).`,
    'Проверьте env AdminYeezy в Coolify, доступ контейнера к Postgres, firewall/allowlist и внутреннюю сеть сервиса.',
    `Postgres вернул: ${original}`,
  ].join(' ')
}

export async function getExportHistoryAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery(`
      SELECT
        t.id,
        t.supplier_id,
        t.batch_id,
        t.status,
        t.result_path,
        COALESCE(t.items_count, 0) as items_count,
        t.error_message,
        t.end_date,
        t.created_at,
        t.updated_at,
        s.name as supplier_name,
        s.avatar_url as supplier_avatar,
        b.id as batch_real_id,
        b.name as batch_name,
        b.items_count as batch_items_count,
        b.stage as batch_stage,
        b.created_at as batch_created_at,
        b.folder_id,
        f.name as folder_name,
        ai.id as ai_run_id,
        ai.status as ai_run_status,
        ai.completed_count as ai_completed_count,
        ai.failed_count as ai_failed_count,
        pc.product_count,
        pc.ai_product_count,
        pc.ai_updated_at,
        op.operation as active_operation
      FROM scraping_tasks t
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN scraping_batches b ON b.id = t.batch_id
      LEFT JOIN export_folders f ON f.id = b.folder_id
      LEFT JOIN LATERAL (
        SELECT id, status, completed_count, failed_count FROM batch_ai_runs
        WHERE batch_id=b.id ORDER BY created_at DESC LIMIT 1
      ) ai ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS product_count,
               COUNT(*) FILTER (WHERE COALESCE(ai_processed, false))::int AS ai_product_count,
               MAX(updated_at) FILTER (WHERE COALESCE(ai_processed, false)) AS ai_updated_at
        FROM products WHERE batch_id=b.id
      ) pc ON TRUE
      LEFT JOIN batch_operation_locks op
        ON op.batch_id=b.id AND op.updated_at > NOW() - INTERVAL '2 minutes'
      WHERE COALESCE(b.stage, '') <> 'ADMIN_DELETED'
      ORDER BY COALESCE(b.created_at, t.created_at) DESC, t.created_at DESC
      LIMIT 500
    `)

    const grouped = new Map<string, { batch: any, files: ExportHistoryFile[] }>()

    for (const row of res.rows) {
      const key = row.batch_id || `task-${row.id}`
      const status = normalizeTaskStatus(row.status, row.result_path)
      const file: ExportHistoryFile = {
        id: row.id,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        supplier_avatar: row.supplier_avatar,
        batch_id: row.batch_id,
        status,
        result_path: row.result_path,
        items_count: Number(row.items_count || 0),
        error_message: row.error_message,
        end_date: row.end_date,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }

      if (!grouped.has(key)) {
        grouped.set(key, {
          batch: {
            id: key,
            isSynthetic: !row.batch_id,
            name: row.batch_name || row.supplier_name || `Выгрузка #${row.id}`,
            supplier_id: row.supplier_id,
            supplier_name: row.supplier_name,
            supplier_avatar: row.supplier_avatar,
            items_count: Number(row.batch_items_count || row.items_count || 0),
            stage: row.batch_stage,
            created_at: row.batch_created_at || row.created_at,
            updated_at: row.updated_at,
            folder_id: row.folder_id || null,
            folder_name: row.folder_name || null,
            ai_run_status: row.ai_run_status || null,
            ai_run_id: row.ai_run_id || null,
            ai_completed_count: Number(row.ai_completed_count || 0),
            ai_failed_count: Number(row.ai_failed_count || 0),
            product_count: Number(row.product_count || 0),
            ai_product_count: Number(row.ai_product_count || 0),
            ai_updated_at: row.ai_updated_at || null,
            active_operation: row.active_operation || null,
          },
          files: [],
        })
      }

      grouped.get(key)!.files.push(file)
    }

    const realBatchIds = [...grouped.values()]
      .map(({ batch }) => batch.isSynthetic ? null : String(batch.id))
      .filter((id): id is string => Boolean(id))
    const snapshotsByBatch = new Map<string, any[]>()
    if (realBatchIds.length > 0) {
      const snapshots = await scrapingQuery(`
        SELECT id,batch_id,stage,label,jsonb_array_length(products)::int AS items_count,created_at
        FROM batch_snapshots
        WHERE batch_id=ANY($1::text[])
        ORDER BY created_at ASC
      `, [realBatchIds])
      for (const snapshot of snapshots.rows) {
        const list = snapshotsByBatch.get(String(snapshot.batch_id)) || []
        list.push(snapshot)
        snapshotsByBatch.set(String(snapshot.batch_id), list)
      }
    }

    const snapshotStageByStatus: Record<string, string> = {
      'Сырой товар': 'SCRAPED',
      'Обработан скриптом': 'SCRIPT_PROCESSED',
      'Обработано ИИ': 'AI_PROCESSED',
    }
    const attachSnapshot = (file: ExportHistoryFile) => {
      if (!file.batch_id) return file
      const stage = snapshotStageByStatus[file.status]
      if (!stage) return file
      const stageCandidates = (snapshotsByBatch.get(file.batch_id) || []).filter((snapshot) => snapshot.stage === stage)
      const labeled = stageCandidates.filter((snapshot) => String(snapshot.label || '').trim() === file.status)
      const candidates = labeled.length ? labeled : stageCandidates
      const exact = candidates.filter((snapshot) => Number(snapshot.items_count) === Number(file.items_count))
      const snapshot = [...(exact.length ? exact : candidates)].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0]
      if (snapshot) {
        file.snapshot_id = String(snapshot.id)
        file.snapshot_label = String(snapshot.label || file.status)
      } else if (file.result_path?.startsWith('db://')) {
        file.snapshot_missing = true
      }
      return file
    }

    const data: ExportHistoryBatch[] = Array.from(grouped.values()).map(({ batch, files }) => {
      const allAiProcessed = batch.product_count > 0 && batch.ai_product_count === batch.product_count
      if (allAiProcessed && !files.some((file) => file.status === 'Обработано ИИ')) {
        files.push({
          id: `ai-${batch.id}`,
          supplier_id: batch.supplier_id,
          supplier_name: batch.supplier_name,
          supplier_avatar: batch.supplier_avatar,
          batch_id: batch.id,
          status: 'Обработано ИИ',
          result_path: `db://batch/${batch.id}/ai`,
          items_count: batch.product_count,
          error_message: null,
          end_date: null,
          created_at: batch.ai_updated_at || batch.updated_at,
          updated_at: batch.ai_updated_at || batch.updated_at,
          is_virtual: true,
          label: 'Обработано ИИ',
        })
      }
      files.forEach(attachSnapshot)
      const currentStatus = currentBatchHistoryStatus(batch.stage)
      const currentFile = [...files]
        .filter((file) => file.status === currentStatus)
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0]
      if (currentFile) {
        currentFile.snapshot_id = null
        currentFile.snapshot_missing = false
        currentFile.is_current = true
      }
      const stageRank: Record<string, number> = { 'Сырой товар': 0, 'Обработан скриптом': 1, 'Обработано ИИ': 2 }
      const sortedFiles = files.sort((a, b) => (stageRank[a.status] ?? 9) - (stageRank[b.status] ?? 9) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const rawFile = sortedFiles.find((file) => file.status === 'Сырой товар')
      const aiFile = sortedFiles.find((file) => file.status === 'Обработано ИИ')
      const latestFile = [...sortedFiles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      const latestEndDate = sortedFiles.find((file) => file.end_date)?.end_date || null
      const latestItemsCount = latestFile?.items_count || 0

      return {
        id: batch.id,
        isSynthetic: batch.isSynthetic,
        name: batch.name,
        supplier_id: batch.supplier_id,
        supplier_name: batch.supplier_name,
        supplier_avatar: batch.supplier_avatar,
        items_count: Math.max(Number(batch.items_count || 0), latestItemsCount),
        stage: batch.stage,
        status: normalizeBatchStatus(effectiveBatchHistoryStage(batch.stage, allAiProcessed), sortedFiles),
        end_date: latestEndDate,
        created_at: batch.created_at,
        updated_at: latestFile?.updated_at || batch.updated_at,
        raw_path: rawFile?.result_path || null,
        ai_path: aiFile?.result_path || null,
        files: sortedFiles,
        folder_id: batch.folder_id,
        folder_name: batch.folder_name,
        ai_run_status: batch.ai_run_status,
        ai_run_id: batch.ai_run_id,
        ai_completed_count: batch.ai_completed_count,
        ai_failed_count: batch.ai_failed_count,
        product_count: batch.product_count,
        ai_product_count: batch.ai_product_count,
        active_operation: batch.active_operation,
      }
    })

    return { success: true, data }
  } catch (err: any) {
    if (isScrapingConnectionError(err)) {
      return {
        success: false,
        error: formatScrapingConnectionError(err),
        data: { kind: 'scraping_db_unreachable', db: describeScrapingDatabaseConnection() },
      }
    }

    return { success: false, error: err.message }
  }
}

async function forwardScrapingToWorker(supplierId: number, endDate?: string, overrideTag?: string, overrideGroup?: string): Promise<ActionResponse | null> {
  const workerUrl = process.env.SCRAPER_WORKER_URL?.replace(/\/+$/, '')
  if (!workerUrl) return null

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (process.env.SCRAPER_WORKER_SECRET) {
      headers.Authorization = `Bearer ${process.env.SCRAPER_WORKER_SECRET}`
    }

    const response = await fetch(`${workerUrl}/api/scraping/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ supplierId, endDate, overrideTag, overrideGroup }),
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return {
        success: false,
        error: payload?.error || `Worker returned ${response.status}`,
      }
    }

    return payload
  } catch (err: any) {
    return {
      success: false,
      error: `Не удалось отправить выгрузку на worker: ${err.message}`,
    }
  }
}

async function importScrapedProductsTransaction(taskId: number, supplier: any, parserDefaults: any, items: any[]) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Парсер не вернул товары')
  const client = await getScrapingClient()
  const batchId = crypto.randomUUID()
  try {
    await client.query('BEGIN')
    const batchName = `${supplier.name} - ${new Date().toLocaleString('ru-RU')}`
    await client.query(
      'INSERT INTO scraping_batches(id,name,supplier_id,items_count,stage) VALUES($1,$2,$3,$4,$5)',
      [batchId, batchName, supplier.id, items.length, 'SCRAPED'],
    )
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      const externalId = String(item.external_id || '').trim()
      if (!externalId) throw new Error(`Товар ${index + 1}: отсутствует external_id`)
      const photos = Array.isArray(item.photos)
        ? item.photos.map(String).filter(Boolean)
        : (() => { try { return item.photos ? JSON.parse(item.photos) : [] } catch { return [] } })()
      await client.query(`
        INSERT INTO products(external_id,name,description,price,price_source,status,brand,category,subcategory,gender,photos,attributes,batch_id,source_position,supplier_published_on,created_at,updated_at)
        VALUES($1,$2,$3,$4,'default','inactive',$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,NOW(),NOW())
        ON CONFLICT(batch_id,external_id) DO UPDATE SET
          name=EXCLUDED.name,description=EXCLUDED.description,price=EXCLUDED.price,price_source=EXCLUDED.price_source,
          status=EXCLUDED.status,brand=EXCLUDED.brand,category=EXCLUDED.category,subcategory=EXCLUDED.subcategory,
          gender=EXCLUDED.gender,photos=EXCLUDED.photos,attributes=EXCLUDED.attributes,supplier_published_on=EXCLUDED.supplier_published_on,
          source_position=EXCLUDED.source_position,updated_at=NOW()
      `, [
        externalId, item.name || 'Без названия', item.description || '',
        parseFloat(item.price) || supplier.default_price || 0,
        item.brand || parserDefaults.brand || '', item.category || parserDefaults.category || '',
        item.subcategory || parserDefaults.subcategory || null, item.gender || supplier.default_gender || '',
        JSON.stringify(Array.isArray(photos) ? photos : []), JSON.stringify(extractProductAttributes(item)),
        batchId, Number.isFinite(Number(item.source_position)) ? Number(item.source_position) : index,
        item.supplier_published_on || null,
      ])
    }
    const actual = await client.query('SELECT COUNT(*)::int AS count FROM products WHERE batch_id=$1', [batchId])
    if (Number(actual.rows[0]?.count) !== items.length) throw new Error(`Импортировано ${actual.rows[0]?.count || 0} из ${items.length} товаров`)
    await client.query(`
      INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
      SELECT $1,$2,'SCRAPED','Сырой товар',COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb),'{}'::jsonb
      FROM products p WHERE p.batch_id=$2
    `, [crypto.randomUUID(), batchId])
    const linkedTask = await client.query(`
      UPDATE scraping_tasks SET batch_id=$1,status='Сырой товар',result_path=$2,error_message=NULL,items_count=$3,updated_at=NOW()
      WHERE id=$4
    `, [batchId, `db://batch/${batchId}/raw`, items.length, taskId])
    if (linkedTask.rowCount !== 1) throw new Error('Задача выгрузки была удалена до завершения импорта')
    await client.query('COMMIT')
    return batchId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function toggleSupplierFavoriteAction(id: number): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery(
      `UPDATE suppliers
       SET is_favorite = NOT COALESCE(is_favorite, FALSE), updated_at = NOW()
       WHERE id = $1
       RETURNING is_favorite`,
      [id],
    )
    revalidatePath('/admin/suppliers')
    return { success: true, data: res.rows[0]?.is_favorite === true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function startScrapingAction(supplierId: number, endDate?: string, overrideTag?: string, overrideGroup?: string): Promise<ActionResponse> {
  await requireAdmin()
  const workerResult = await forwardScrapingToWorker(supplierId, endDate, overrideTag, overrideGroup)
  if (workerResult) return workerResult
  return startScrapingLocalAction(supplierId, endDate, overrideTag, overrideGroup)
}

export async function startScrapingLocalAction(supplierId: number, endDate?: string, overrideTag?: string, overrideGroup?: string, workerSecret?: string): Promise<ActionResponse> {
  try {
    await requireAdminOrWorker(workerSecret)

    // 1. Получаем данные поставщика
    const supplierRes = await scrapingQuery('SELECT * FROM suppliers WHERE id=$1', [supplierId])
    const supplier = supplierRes.rows[0]
    if (!supplier) return { success: false, error: 'Supplier not found' }
    const parserDefaults = {
      brand: supplier.default_brand,
      category: supplier.default_category,
      subcategory: supplier.default_subcategory,
    }

    // 2. Создаем задачу в БД
    await scrapingQuery(`
      UPDATE scraping_tasks SET status='failed',error_message='Остановлено: нет обновлений более 12 часов',updated_at=NOW()
      WHERE supplier_id=$1 AND status='running' AND updated_at<NOW()-INTERVAL '12 hours'
    `, [supplierId])
    const taskRes = await scrapingQuery(
      `INSERT INTO scraping_tasks (supplier_id, status, end_date)
       VALUES ($1, 'running', $2)
       ON CONFLICT (supplier_id) WHERE status='running' DO NOTHING
       RETURNING id`,
      [supplierId, endDate || null]
    )
    if (!taskRes.rows[0]) return { success: false, error: 'Для этого поставщика выгрузка уже запущена' }
    const taskId = taskRes.rows[0].id

    // 3. Подготавливаем пути
    const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp')
    const outputFileName = `task_${taskId}.json`
    const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, outputFileName)
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParser.py')
    
    // 4. Запускаем Python процесс
    const cookie = supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || ''
    const args = [
      scriptPath,
      '--album_id', supplier.album_id,
      '--cookie', cookie,
      '--output', outputPath,
      '--format', 'json'
    ]
    args.push('--parse_mode', supplier.szwego_parse_mode === 'all' ? 'all' : 'images')
    if (endDate) args.push('--end_date', endDate)
    
    let finalGroup = supplier.group_id
    let finalTag = supplier.tag_id

    if (overrideTag || overrideGroup) {
      finalGroup = overrideGroup || ''
      finalTag = overrideTag || ''
    }
    
    if (finalGroup) args.push('--group_id', finalGroup)
    if (finalTag) args.push('--tag_id', finalTag)
    
    if (supplier.min_photos) args.push('--min_photos', supplier.min_photos.toString())
    if (supplier.min_desc_len) args.push('--min_desc', supplier.min_desc_len.toString())
    if (parserDefaults.category) args.push('--category', parserDefaults.category)
    if (parserDefaults.subcategory) args.push('--subcategory', parserDefaults.subcategory)
    if (parserDefaults.brand) args.push('--brand', parserDefaults.brand)
    if (supplier.default_gender) args.push('--gender', supplier.default_gender)
    if (supplier.default_price) args.push('--default_price', supplier.default_price.toString())
    if (supplier.parse_tags_enabled) args.push('--parse_tags')

    console.log(`[Scraper] Starting task ${taskId}: python ${args.join(' ')}`)

    // Capture errors
    let stderr = ''
    
    const pythonProcess = spawn(/*turbopackIgnore: true*/ 'python', args)

    pythonProcess.on('error', (err) => {
      console.error(`[Scraper ${taskId}] Failed to start python:`, err)
      void scrapingQuery(
        `UPDATE scraping_tasks SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [`Failed to start python: ${err.message}`, taskId]
      ).catch((error) => console.error(`[Scraper ${taskId}] Failed to persist spawn error`, error))
    })

    let stdoutBuffer = ''
    let lastProgress = 0
    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString()
      console.log(`[Scraper ${taskId} DEBUG] ${text}`)
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const match = line.match(/^PROGRESS:(\d+)$/)
        if (!match) continue
        const count = Number(match[1])
        if (!Number.isFinite(count) || count < lastProgress) continue
        lastProgress = count
        void scrapingQuery(
          'UPDATE scraping_tasks SET items_count=$1,updated_at=NOW() WHERE id=$2 AND status=\'running\'',
          [count, taskId],
        ).catch((error) => console.error(`[Scraper ${taskId}] Progress update failed`, error))
      }
    })

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString()
      console.error(`[Scraper ${taskId} ERR] ${data}`)
    })

    pythonProcess.on('close', async (code) => {
      let batchId: string | null = null
      let itemsCount = 0
      let finalStatus = 'failed'
      let errorMsg: string | null = code === 0 ? null : (stderr || `Exit code ${code}`)
      try {
        if (code !== 0) throw new Error(errorMsg || `Exit code ${code}`)
        if (!fs.existsSync(/*turbopackIgnore: true*/ outputPath)) throw new Error('Парсер не создал JSON-файл')
        const items = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8'))
        itemsCount = Array.isArray(items) ? items.length : 0
        batchId = await importScrapedProductsTransaction(taskId, supplier, parserDefaults, items)
        finalStatus = 'Сырой товар'
        if (supplier.post_process_enabled && supplier.post_process_script) {
          const postProcessResult = await runCustomSupplierScriptAction(null, supplier.id, batchId)
          if (!postProcessResult?.success) console.error(`[Scraper ${taskId}] Auto post-process failed: ${postProcessResult?.error}`)
        }
      } catch (error: any) {
        errorMsg = String(error?.message || error)
        await scrapingQuery(
          `UPDATE scraping_tasks SET status='failed',error_message=$1,updated_at=NOW() WHERE id=$2`,
          [errorMsg, taskId],
        )
      } finally {
        try { if (fs.existsSync(/*turbopackIgnore: true*/ outputPath)) fs.unlinkSync(/*turbopackIgnore: true*/ outputPath) } catch {}
      }

      // Уведомление в Telegram
      await notifyTelegram(supplier.name, finalStatus, taskId, outputPath, itemsCount)
      
      console.log(`[Scraper ${taskId}] Finished with status: ${finalStatus}`)
      revalidatePath('/admin/batches')
    })

    revalidatePath('/admin/scraping')
    return { success: true, data: { taskId } }

  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function deleteTaskAction(taskId: number): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery('SELECT result_path,status,batch_id FROM scraping_tasks WHERE id=$1', [taskId])
    if (['running', 'pending'].includes(res.rows[0]?.status)) return { success: false, error: 'Нельзя удалить выполняющуюся выгрузку' }
    if (res.rows[0]?.batch_id) {
      const operation = await scrapingQuery('SELECT operation FROM batch_operation_locks WHERE batch_id=$1', [res.rows[0].batch_id])
      if (operation.rows[0]) return { success: false, error: `Выгрузка занята операцией: ${operation.rows[0].operation}` }
    }
    const filePath = res.rows[0]?.result_path
    await deleteScrapingFileArtifactForTask(taskId)
    
    if (filePath) {
      try {
        const safePath = resolveSafeRuntimePath(filePath)
        if (fs.existsSync(/*turbopackIgnore: true*/ safePath)) {
          fs.unlinkSync(/*turbopackIgnore: true*/ safePath)
        }
      } catch (e) {
        console.error('Failed to delete file:', filePath, e)
      }
    }

    await scrapingQuery('DELETE FROM scraping_tasks WHERE id=$1', [taskId])
    revalidatePath('/admin/scraping')
    revalidatePath('/admin/batches')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function deleteExportFileFromAdminAction(taskId: number): Promise<ActionResponse> {
  return deleteTaskAction(taskId)
}

export async function deleteExportBatchFromAdminAction(batchId: string): Promise<ActionResponse> {
    let operationOwnerId: string | null = null
    try {
        await requireAdmin()
        operationOwnerId = await claimBatchOperation(batchId, 'delete')
        if (!operationOwnerId) throw new Error('Выгрузка занята другой операцией')

        const tasksRes = await scrapingQuery(
            'SELECT id, result_path FROM scraping_tasks WHERE batch_id = $1',
            [batchId]
        )

        for (const task of tasksRes.rows) {
            if (task.result_path) {
                try {
                    const safePath = resolveSafeRuntimePath(task.result_path)
                    if (fs.existsSync(/*turbopackIgnore: true*/ safePath)) {
                        fs.unlinkSync(/*turbopackIgnore: true*/ safePath)
                    }
                } catch (e) {
                    console.error('Failed to delete file:', task.result_path, e)
                }
            }
        }

        await scrapingQuery('DELETE FROM scraping_tasks WHERE batch_id = $1', [batchId])
        await deleteScrapingFileArtifactsForBatch(batchId)
        await scrapingQuery("UPDATE scraping_batches SET stage = 'ADMIN_DELETED' WHERE id = $1", [batchId])

        revalidatePath('/admin/scraping')
        revalidatePath('/admin/batches')
        return { success: true, data: { deletedCount: tasksRes.rowCount } }
    } catch (err: any) {
        return { success: false, error: err.message }
    } finally {
        if (operationOwnerId) await releaseBatchOperation(batchId, operationOwnerId).catch(() => undefined)
    }
}

// Вспомогательная функция для уведомлений
async function notifyTelegram(supplierName: string, status: string, taskId: number, filePath: string, itemsCount: number = 0) {
  const token = process.env.BOT_TOKEN
  const chatIds = process.env.MANAGER_CHAT_ID?.split(',') || []
  
  if (!token || chatIds.length === 0) return

  const isSuccess = status === 'completed' || status === 'Сырой CSV' || status === 'Сырой товар'
  const message = isSuccess 
    ? `✅ Выгрузка завершена!\nПоставщик: ${supplierName}\nЗадача: #${taskId}\nВыгружено товаров: ${itemsCount}\n\nТеперь вы можете проверить товары в админке.`
    : `❌ Ошибка выгрузки!\nПоставщик: ${supplierName}\nЗадача: #${taskId}`

  const proxy = process.env.BOT_PROXY;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  for (const chatId of chatIds) {
    try {
      await nodeFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        agent,
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: message,
          reply_markup: isSuccess ? {
            inline_keyboard: [[
              { text: 'Открыть в админке', url: `http://localhost:3000/admin/batches` }
            ]]
          } : undefined
        })
      })
    } catch (e) {
      console.error('Telegram notification error:', e)
    }
  }
}

/**
 * Привязка партии к задаче выгрузки (для истории)
 */
export async function linkBatchToTaskAction(batchId: string, taskId: number) {
    try {
        await requireAdmin()
        const result = await scrapingQuery("UPDATE scraping_tasks SET batch_id=$1 WHERE id=$2 AND batch_id IS NULL AND status NOT IN ('running','pending') RETURNING id", [batchId, taskId])
        if (!result.rows[0]) throw new Error('Задача уже привязана к партии и не может быть перенесена')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

/**
 * Обновление этапа обработки партии
 */
export async function updateBatchStageAction(batchId: string, stage: 'SCRAPED' | 'AI_PROCESSED' | 'PUSHED') {
    try {
        await requireAdmin()
        if (stage === 'PUSHED') throw new Error('Этап PUSHED выставляется только подтверждённой публикацией в Rails')
        const operation = await scrapingQuery('SELECT operation FROM batch_operation_locks WHERE batch_id=$1', [batchId])
        if (operation.rows[0]) throw new Error(`Выгрузка занята операцией: ${operation.rows[0].operation}`)
        if (stage === 'AI_PROCESSED') {
          const remaining = await scrapingQuery(`
            SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE COALESCE(ai_processed,false)=false)::int AS remaining
            FROM products WHERE batch_id=$1
          `, [batchId])
          if (!Number(remaining.rows[0]?.total) || Number(remaining.rows[0]?.remaining)) {
            throw new Error('Нельзя завершить AI-этап: часть товаров не обработана')
          }
        }
        await scrapingQuery('UPDATE scraping_batches SET stage = $1 WHERE id = $2', [stage, batchId])
        revalidatePath('/admin/batches')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

export async function pushBatchToCatalogAction(batchId: string, mode: 'add' | 'upsert' = 'add'): Promise<ActionResponse> {
    try {
        await requireAdmin()
        const workflow = require('../scripts/batch-workflow')
        const lastReported = new Map<string, number>()
        let progressWrite = Promise.resolve()
        const result = await workflow.pushBatchToCatalog(batchId, { mode }, async (progress: any) => {
            const phase = ['lookup', 'media', 'publish'].includes(progress?.phase) ? progress.phase : 'publish'
            const current = Math.max(0, Number(progress?.current || 0))
            const total = Math.max(0, Number(progress?.total || 0))
            const previous = lastReported.get(phase) ?? -5
            if (current !== 0 && current !== total && current - previous < 5) return
            lastReported.set(phase, current)
            progressWrite = progressWrite.then(async () => {
              const persisted = await scrapingQuery(
                `UPDATE batch_operation_locks
                 SET operation=$2,updated_at=NOW()
                 WHERE batch_id=$1 AND operation NOT LIKE 'cancel_requested|%'
                 RETURNING operation`,
                [batchId, `publish|${phase}|${current}|${total}`],
              )
              if (!persisted.rows[0]) throw new Error('Публикация остановлена пользователем')
            })
            await progressWrite
        })
        try {
            await redis.del('catalog:all')
        } catch (redisErr: any) {
            console.warn('Redis clear cache error:', redisErr.message)
        }
        revalidatePath('/admin')
        revalidatePath('/admin/batches')
        revalidatePath('/admin/scraping')
        return { success: true, data: result }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

/**
 * Создание записи о партии
 */
export async function createBatchAction(name: string, supplierId?: number, itemsCount: number = 0): Promise<ActionResponse> {
    try {
        await requireAdmin()
        void name
        void supplierId
        void itemsCount
        return { success: false, error: 'Партия создаётся только транзакционным импортом парсера', data: null }
    } catch (err: any) {
        return { success: false, error: err.message, data: null }
    }
}

export async function getBatchPublishProgressAction(batchId: string): Promise<ActionResponse> {
    try {
        await requireAdmin()
        const result = await scrapingQuery(
          'SELECT operation,updated_at FROM batch_operation_locks WHERE batch_id=$1',
          [batchId],
        )
        return { success: true, data: parseBatchPublishProgress(result.rows[0]?.operation, result.rows[0]?.updated_at) }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

export async function stopBatchPublishAction(batchId: string): Promise<ActionResponse> {
    try {
        await requireAdmin()
        const result = await scrapingQuery(
          'SELECT operation,updated_at FROM batch_operation_locks WHERE batch_id=$1',
          [batchId],
        )
        const row = result.rows[0]
        const progress = parseBatchPublishProgress(row?.operation, row?.updated_at)
        if (!row || (!progress.running && !progress.stale)) {
          return { success: true, data: { released: true, message: 'Активной публикации нет' } }
        }

        if (progress.stale) {
          const released = await scrapingQuery(
            'DELETE FROM batch_operation_locks WHERE batch_id=$1 AND updated_at < NOW() - ($2::int * INTERVAL \'1 millisecond\') RETURNING batch_id',
            [batchId, BATCH_PUBLISH_STALE_MS],
          )
          return released.rows[0]
            ? { success: true, data: { released: true, message: 'Зависшая операция сброшена' } }
            : { success: false, error: 'Операция снова активна. Обновите страницу и повторите при необходимости.' }
        }

        await scrapingQuery(
          `UPDATE batch_operation_locks
           SET operation=CASE WHEN operation LIKE 'cancel_requested|%' THEN operation ELSE 'cancel_requested|' || operation END,
               updated_at=NOW()
           WHERE batch_id=$1`,
          [batchId],
        )
        return { success: true, data: { released: false, message: 'Запрошена остановка публикации' } }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

/**
 * Получение списка всех партий
 */
export async function getBatchesAction() {
    try {
        await requireAdmin()
        const res = await scrapingQuery(`
            SELECT b.id, b.name, b.supplier_id, b.items_count, b.stage, b.created_at, s.name as supplier_name, s.avatar_url as supplier_avatar,
                   (SELECT result_path FROM scraping_tasks WHERE batch_id = b.id AND status IN ('Сырой товар','Сырой CSV') ORDER BY created_at ASC LIMIT 1) as raw_path,
                   (SELECT result_path FROM scraping_tasks WHERE batch_id = b.id AND status = 'Обработано ИИ' ORDER BY created_at DESC LIMIT 1) as ai_path
            FROM scraping_batches b 
            LEFT JOIN suppliers s ON s.id = b.supplier_id 
            ORDER BY b.created_at DESC
        `)
        return { success: true, data: res.rows }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

/**
 * Удаление партии и всех связанных с ней товаров
 */
export async function deleteBatchAction(batchId: string, options: { replaceShared?: boolean } = {}) {
    let operationOwnerId: string | null = null
    try {
        await requireAdmin()
        operationOwnerId = await claimBatchOperation(batchId, 'delete')
        if (!operationOwnerId) throw new Error('Выгрузка занята другой операцией')
        const batchResult = await scrapingQuery('SELECT stage FROM scraping_batches WHERE id=$1', [batchId])
        const batchStage = String(batchResult.rows[0]?.stage || '')

        // Удаляем из Rails только товары, опубликованные исключительно этой партией.
        // Общий external_id другой партии нельзя удалять вместе с историей текущей.
        const publications = await scrapingQuery(`
          SELECT bp.external_id,EXISTS(
            SELECT 1 FROM batch_publications other
            WHERE other.external_id=bp.external_id AND other.batch_id<>bp.batch_id
          ) AS shared
          FROM batch_publications bp
          WHERE bp.batch_id=$1
        `, [batchId])
        const publicationExternalIds = publications.rows
          .filter((row) => !row.shared)
          .map((row) => String(row.external_id))
          .filter(Boolean)

        // Старые PUSHED-партии могли быть опубликованы до появления
        // batch_publications. В этом случае восстанавливаем кандидатов из
        // самой партии, но не трогаем external_id, который встречается в
        // другой технической партии.
        const batchProducts = await scrapingQuery(`
          SELECT p.external_id
          FROM products p
          WHERE p.batch_id=$1 AND p.external_id IS NOT NULL AND BTRIM(p.external_id) <> ''
        `, [batchId])
        const snapshotResult = await scrapingQuery(`
          SELECT products
          FROM batch_snapshots
          WHERE batch_id=$1
          ORDER BY CASE
            WHEN label='Обработано ИИ' THEN 0
            WHEN label='Обработан скриптом' THEN 1
            WHEN label='Сырой товар' THEN 2
            ELSE 3
          END, created_at DESC
          LIMIT 1
        `, [batchId])
        const snapshotProducts = Array.isArray(snapshotResult.rows[0]?.products)
          ? snapshotResult.rows[0].products
          : []
        const legacyCandidates = [...new Set([
          ...batchProducts.rows.map((row) => String(row.external_id).trim()),
          ...snapshotProducts.map((product: any) => String(product?.external_id || '').trim()),
        ].filter(Boolean))]
        const legacyShared = legacyCandidates.length > 0
          ? await scrapingQuery(`
              SELECT p.external_id
              FROM products p
              WHERE p.external_id = ANY($1::text[]) AND p.batch_id <> $2
              GROUP BY p.external_id
              UNION
              SELECT snapshot_product->>'external_id' AS external_id
              FROM batch_snapshots snapshot
              CROSS JOIN LATERAL jsonb_array_elements(snapshot.products) AS snapshot_product
              WHERE snapshot.batch_id <> $2
                AND snapshot_product->>'external_id' = ANY($1::text[])
              GROUP BY snapshot_product->>'external_id'
            `, [legacyCandidates, batchId])
          : { rows: [] }
        const legacySharedIds = new Set(legacyShared.rows.map((row) => String(row.external_id).trim()))
        const legacyExternalIds = legacyCandidates.filter((externalId) => !legacySharedIds.has(externalId))
        const protectedExternalIds = new Set([
          ...legacySharedIds,
          ...publications.rows.filter((row) => row.shared).map((row) => String(row.external_id).trim()),
        ])
        const externalIds = options.replaceShared
          ? [...new Set([
              ...publications.rows.map((row) => String(row.external_id).trim()),
              ...legacyCandidates,
            ].filter(Boolean))]
          : [...new Set([...publicationExternalIds, ...legacyExternalIds])]

        // Удаляем опубликованные товары из основного Rails-каталога именно по external_id.
        let catalogDeletedCount = 0
        let catalogArchivedCount = 0
        let catalogFailedCount = 0
        const requiresCatalogDeletion = batchStage === 'PUSHED' || publications.rows.length > 0 || legacyCandidates.length > 0
        if (requiresCatalogDeletion && !process.env.RAILS_API_URL) {
          throw new Error('Нельзя удалить опубликованную партию: не настроен RAILS_API_URL')
        }
        if (externalIds.length > 0 && process.env.RAILS_API_URL) {
          const result = await deleteRailsAdminProductsByExternalIds(externalIds)
          catalogDeletedCount = result.deleted
          catalogArchivedCount = result.archived
          catalogFailedCount = result.failed.length
        }

        await scrapingQuery('DELETE FROM batch_publications WHERE batch_id=$1', [batchId])

        // Если хотя бы один external_id разделяется с другой публикацией, Rails может
        // ссылаться на фотографии этой партии — весь префикс удалять небезопасно.
        const canDeleteS3 = publications.rows.length > 0
          ? publications.rows.every((row) => !row.shared)
          : batchStage !== 'PUSHED' && protectedExternalIds.size === 0
        if (canDeleteS3) {
          try {
            await deleteS3Folder(`batches/${batchId}/`)
          } catch (s3Err: any) {
            console.warn('Could not delete images from S3:', s3Err.message)
          }
        }

        // После успешного удаления публикации удаляем товары партии из технической БД.
        const deleteProductsRes = await scrapingQuery('DELETE FROM products WHERE batch_id = $1', [batchId])
        const deletedCount = deleteProductsRes.rowCount

        // 3. Оставляем партию в истории, но фиксируем, что товары из БД удалены
        await scrapingQuery("UPDATE scraping_batches SET stage = 'DELETED_FROM_DB' WHERE id = $1", [batchId])

        // 4. Чистим кеш
        try {
            await redis.del('catalog:all')
        } catch (redisErr: any) {
            console.warn('Redis clear cache error:', redisErr.message)
        }
        revalidatePath('/admin')
        revalidatePath('/admin/batches')
        revalidatePath('/admin/scraping')

        return {
          success: true,
          deletedCount,
          catalogDeletedCount,
          catalogArchivedCount,
          catalogFailedCount,
          catalogRequestedCount: externalIds.length,
          catalogProtectedCount: options.replaceShared ? 0 : protectedExternalIds.size,
          replaceShared: Boolean(options.replaceShared),
        }
    } catch (err: any) {
        return { success: false, error: err.message }
    } finally {
        if (operationOwnerId) await releaseBatchOperation(batchId, operationOwnerId).catch(() => undefined)
    }
}


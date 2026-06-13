'use server';

import { revalidatePath } from 'next/cache'
import { query, scrapingQuery, redis, describeScrapingDatabaseConnection } from '@/lib/db'
import { deleteS3Folder } from '@/lib/s3'
import type { ActionResponse } from '@/lib/types'
import { requireAdmin } from '@/lib/admin-session'
import { resolveSafeRuntimePath } from '@/lib/runtime-paths'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import nodeFetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  deleteScrapingFileArtifactForTask,
  deleteScrapingFileArtifactsForBatch,
  saveScrapingFileArtifact,
} from '@/lib/scraping-files'

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
    const res = await scrapingQuery('SELECT * FROM suppliers ORDER BY name ASC')
    return { success: true, data: res.rows }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function createSupplierAction(formData: FormData): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const name = formData.get('name') as string
    const album_id = formData.get('album_id') as string
    const group_id = formData.get('group_id') as string || ''
    const tag_id = formData.get('tag_id') as string || ''
    const default_category = formData.get('default_category') as string || null
    const default_subcategory = formData.get('default_subcategory') as string || null
    const default_brand = formData.get('default_brand') as string || null
    
    const min_photos_raw = formData.get('min_photos') as string
    const min_photos = (min_photos_raw && min_photos_raw.trim() !== '') ? parseInt(min_photos_raw) : 0
    const min_desc_raw = formData.get('min_desc_len') as string
    const min_desc_len = (min_desc_raw && min_desc_raw.trim() !== '') ? parseInt(min_desc_raw) : 0
    const brand_tags = formData.get('brand_tags') as string || ''

    const default_price = formData.get('default_price') ? parseFloat(formData.get('default_price') as string) : null
    const default_gender = formData.get('default_gender') as string || null
    const ai_deep_search_enabled = formData.get('ai_deep_search_enabled') === 'on'
    const ai_resize_enabled = formData.get('ai_resize_enabled') === 'on'
    const ai_photo_enabled = formData.get('ai_photo_enabled') === 'on'
    const ai_cache_enabled = formData.get('ai_cache_enabled') === 'on'
    const ai_instructions = formData.get('ai_instructions') as string || ''

    const avatar_url = formData.get('avatar_url') as string || null
    const cookie = formData.get('cookie') as string || null
    const post_process_script = formData.get('post_process_script') as string || null
    const ai_photo_models = formData.get('ai_photo_models') as string || ''
    const ai_photo_instructions = formData.get('ai_photo_instructions') as string || ''
    const ai_parallel_enabled = formData.get('ai_parallel_enabled') === 'on'
    const ai_parallel_count = parseInt(formData.get('ai_parallel_count') as string || '5')
    const parse_tags_enabled = formData.get('parse_tags_enabled') === 'on'

    const res = await scrapingQuery(
      `INSERT INTO suppliers (name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, min_photos, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING id`,
      [name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, min_photos, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled]
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
    const group_id = formData.get('group_id') as string || ''
    const tag_id = formData.get('tag_id') as string || ''
    const default_category = formData.get('default_category') as string || null
    const default_subcategory = formData.get('default_subcategory') as string || null
    const default_brand = formData.get('default_brand') as string || null
    
    const min_photos_raw = formData.get('min_photos') as string
    const min_photos = (min_photos_raw && min_photos_raw.trim() !== '') ? parseInt(min_photos_raw) : 0
    const min_desc_raw = formData.get('min_desc_len') as string
    const min_desc_len = (min_desc_raw && min_desc_raw.trim() !== '') ? parseInt(min_desc_raw) : 0
    const brand_tags = formData.get('brand_tags') as string || ''

    const default_price = formData.get('default_price') ? parseFloat(formData.get('default_price') as string) : null
    const default_gender = formData.get('default_gender') as string || null
    const ai_deep_search_enabled = formData.get('ai_deep_search_enabled') === 'on'
    const ai_resize_enabled = formData.get('ai_resize_enabled') === 'on'
    const ai_photo_enabled = formData.get('ai_photo_enabled') === 'on'
    const ai_cache_enabled = formData.get('ai_cache_enabled') === 'on'
    const ai_instructions = formData.get('ai_instructions') as string || ''

    const avatar_url = formData.get('avatar_url') as string || null
    const cookie = formData.get('cookie') as string || null
    const post_process_script = formData.get('post_process_script') as string || null
    const ai_photo_models = formData.get('ai_photo_models') as string || ''
    const ai_photo_instructions = formData.get('ai_photo_instructions') as string || ''
    const ai_parallel_enabled = formData.get('ai_parallel_enabled') === 'on'
    const ai_parallel_count = parseInt(formData.get('ai_parallel_count') as string || '5')
    const parse_tags_enabled = formData.get('parse_tags_enabled') === 'on'

    await scrapingQuery(
      `UPDATE suppliers SET name=$1, album_id=$2, group_id=$3, tag_id=$4, 
       default_category=$5, default_subcategory=$6, default_brand=$7, 
       min_photos=$8, min_desc_len=$9, brand_tags=$10, 
       default_price=$11, default_gender=$12, 
       ai_photo_enabled=$13, ai_cache_enabled=$14, ai_deep_search_enabled=$15, ai_resize_enabled=$16, ai_instructions=$17, avatar_url=$18, cookie=$19, post_process_script=$20, ai_photo_models=$21, ai_photo_instructions=$22, ai_parallel_enabled=$23, ai_parallel_count=$24, parse_tags_enabled=$25, updated_at=NOW()
       WHERE id=$26`,
      [name, album_id, group_id, tag_id, default_category, default_subcategory, default_brand, min_photos, min_desc_len, brand_tags, default_price, default_gender, ai_photo_enabled, ai_cache_enabled, ai_deep_search_enabled, ai_resize_enabled, ai_instructions, avatar_url, cookie, post_process_script, ai_photo_models, ai_photo_instructions, ai_parallel_enabled, ai_parallel_count, parse_tags_enabled, id]
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
  id: number
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
}

export interface ExportHistoryBatch {
  id: string
  isSynthetic: boolean
  name: string
  supplier_id: number | null
  supplier_name: string | null
  supplier_avatar: string | null
  items_count: number
  status: string
  end_date: string | null
  created_at: string
  updated_at: string
  raw_path: string | null
  ai_path: string | null
  files: ExportHistoryFile[]
}

function normalizeTaskStatus(status: string | null, resultPath: string | null) {
  if (resultPath?.includes('task_ai_')) return 'Обработано ИИ'
  if (status === 'running' || status === 'pending') return 'Запущено'
  if (status === 'completed') return 'Сырой CSV'
  return status || 'Запущено'
}

function normalizeBatchStatus(stage: string | null, files: ExportHistoryFile[]) {
  if (stage === 'DELETED_FROM_DB') return 'Удалено из БД'
  if (stage === 'PUSHED') return 'Запушено'
  if (stage === 'AI_PROCESSED') return 'Обработано ИИ'
  if (files.some((file) => file.status === 'Запущено')) return 'Запущено'
  if (files.some((file) => file.status === 'Обработано ИИ')) return 'Обработано ИИ'
  if (files.some((file) => file.status === 'Обработано скриптом')) return 'Обработано скриптом'
  if (files.some((file) => file.status === 'failed')) return 'failed'
  return 'Сырой CSV'
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
        b.created_at as batch_created_at
      FROM scraping_tasks t
      LEFT JOIN suppliers s ON t.supplier_id = s.id
      LEFT JOIN scraping_batches b ON b.id = t.batch_id
      WHERE COALESCE(b.stage, '') <> 'ADMIN_DELETED'
        AND (
          t.result_path IS NOT NULL
          OR t.batch_id IS NOT NULL
        )
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
          },
          files: [],
        })
      }

      grouped.get(key)!.files.push(file)
    }

    const data: ExportHistoryBatch[] = Array.from(grouped.values()).map(({ batch, files }) => {
      const sortedFiles = files.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      const rawFile = [...sortedFiles]
        .reverse()
        .find((file) => file.status === 'Сырой CSV')
      const aiFile = sortedFiles.find((file) => file.status === 'Обработано ИИ')
      const latestFile = sortedFiles[0]
      const latestEndDate = sortedFiles.find((file) => file.end_date)?.end_date || null
      const latestItemsCount = latestFile?.items_count || 0

      return {
        id: batch.id,
        isSynthetic: batch.isSynthetic,
        name: batch.name,
        supplier_id: batch.supplier_id,
        supplier_name: batch.supplier_name,
        supplier_avatar: batch.supplier_avatar,
        items_count: latestItemsCount,
        status: normalizeBatchStatus(batch.stage, sortedFiles),
        end_date: latestEndDate,
        created_at: batch.created_at,
        updated_at: latestFile?.updated_at || batch.updated_at,
        raw_path: rawFile?.result_path || null,
        ai_path: aiFile?.result_path || null,
        files: sortedFiles,
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

    // 2. Создаем задачу в БД
    const taskRes = await scrapingQuery(
      `INSERT INTO scraping_tasks (supplier_id, status, end_date)
       VALUES ($1, 'running', $2) RETURNING id`,
      [supplierId, endDate || null]
    )
    const taskId = taskRes.rows[0].id

    // 3. Подготавливаем пути
    const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp')
    const outputFileName = `task_${taskId}.csv`
    const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, outputFileName)
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParser.py')
    
    // 4. Запускаем Python процесс
    const cookie = supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || ''
    const args = [
      scriptPath,
      '--album_id', supplier.album_id,
      '--cookie', cookie,
      '--output', outputPath
    ]
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
    if (supplier.default_category) args.push('--category', supplier.default_category)
    if (supplier.default_subcategory) args.push('--subcategory', supplier.default_subcategory)
    if (supplier.default_brand) args.push('--brand', supplier.default_brand)
    if (supplier.default_gender) args.push('--gender', supplier.default_gender)
    if (supplier.default_price) args.push('--default_price', supplier.default_price.toString())
    if (supplier.parse_tags_enabled) args.push('--parse_tags')

    console.log(`[Scraper] Starting task ${taskId}: python ${args.join(' ')}`)

    // Capture errors
    let stderr = ''
    
    const pythonProcess = spawn(/*turbopackIgnore: true*/ 'python', args)

    pythonProcess.on('error', (err) => {
      console.error(`[Scraper ${taskId}] Failed to start python:`, err)
      scrapingQuery(
        `UPDATE scraping_tasks SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [`Failed to start python: ${err.message}`, taskId]
      )
    })

    pythonProcess.stdout.on('data', (data) => {
      console.log(`[Scraper ${taskId} DEBUG] ${data}`)
    })

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString()
      console.error(`[Scraper ${taskId} ERR] ${data}`)
    })

    pythonProcess.on('close', async (code) => {
      const status = code === 0 ? 'Сырой CSV' : 'failed'
      const errorMsg = code === 0 ? null : (stderr || `Exit code ${code}`)
      let batchId: string | null = null
      
      let itemsCount = 0
      if (code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
        try {
          const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8')
          const lines = fileContent.split('\n').filter(l => l.trim())
          if (lines.length > 1) {
            itemsCount = lines.length - 1
          }
        } catch (e) {
          console.error(`[Scraper ${taskId}] Error reading file for count:`, e)
        }
      }

      await scrapingQuery(
        `UPDATE scraping_tasks SET status=$1, result_path=$2, error_message=$3, items_count=$4, updated_at=NOW() WHERE id=$5`,
        [status, code === 0 ? outputPath : null, errorMsg, itemsCount, taskId]
      )

      if (code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
        try {
          console.log(`[Scraper ${taskId}] Starting data import to batch...`)
          // 1. Читаем CSV
          const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8')
          const lines = fileContent.split('\n').filter(l => l.trim())
          
          if (lines.length > 1) { // Если есть больше чем заголовок
            const batchName = `${supplier.name} - ${new Date().toLocaleString('ru-RU')}`
            
            // 2. Создаем партию
            batchId = crypto.randomUUID()
            await scrapingQuery(
               'INSERT INTO scraping_batches (id, name, supplier_id, items_count) VALUES ($1, $2, $3, $4)',
               [batchId, batchName, supplier.id, itemsCount]
            )

            // 2.1. Привязываем партию к задаче
            await scrapingQuery(
               'UPDATE scraping_tasks SET batch_id = $1 WHERE id = $2',
               [batchId, taskId]
            )

            // 3. Импортируем товары
            // Простой парсер CSV (учитывая кавычки в описании и разделитель ;)
            const headers = parseDelimitedLine(lines[0], ';')
            for (let i = 1; i < lines.length; i++) {
               const row = parseDelimitedLine(lines[i], ';')
               if (row.length === 0) continue

               const item: any = {}
               headers.forEach((h, idx) => {
                  item[h.trim()] = row[idx] || ''
               })

               // Мапим поля в БД
               const sql = `
                  INSERT INTO products (external_id, name, description, price, status, brand, category, subcategory, gender, photos, batch_id, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), NOW())
                  ON CONFLICT (external_id) DO UPDATE SET
                      name = EXCLUDED.name,
                      description = EXCLUDED.description,
                      price = EXCLUDED.price,
                      status = EXCLUDED.status,
                      brand = EXCLUDED.brand,
                      category = EXCLUDED.category,
                      subcategory = EXCLUDED.subcategory,
                      gender = EXCLUDED.gender,
                      photos = EXCLUDED.photos,
                      batch_id = EXCLUDED.batch_id,
                      created_at = COALESCE(products.created_at, NOW()),
                      updated_at = NOW()
               `
               
               const price = parseFloat(item.price) || supplier.default_price || 0
               const gender = item.gender || supplier.default_gender || ''
               const cat = item.category || supplier.default_category || ''
               const sub = item.subcategory || supplier.default_subcategory || ''
               const brandStr = item.brand || supplier.default_brand || ''
               let photos: string[] = []
               try {
                 photos = item.photos ? JSON.parse(item.photos) : []
               } catch {
                 photos = []
               }

               await scrapingQuery(sql, [
                  item.external_id, 
                  item.name || 'Без названия',
                  item.description || '',
                  price,
                  'inactive',
                  brandStr,
                  cat,
                  sub || null,
                  gender,
                  JSON.stringify(photos),
                  batchId
               ])
            }
            console.log(`[Scraper ${taskId}] Imported ${itemsCount} items to batch ${batchId}`)
          }
        } catch (importErr) {
          console.error(`[Scraper ${taskId}] Import failed:`, importErr)
        }

        try {
          await saveScrapingFileArtifact({
            taskId,
            supplierId: supplier.id,
            batchId,
            status,
            filePath: outputPath,
          })
        } catch (fileErr) {
          console.error(`[Scraper ${taskId}] Failed to store CSV artifact in DB:`, fileErr)
        }
      }

      // Уведомление в Telegram
      await notifyTelegram(supplier.name, status, taskId, outputPath, itemsCount)
      
      console.log(`[Scraper ${taskId}] Finished with status: ${status}`)
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
    const res = await scrapingQuery('SELECT result_path FROM scraping_tasks WHERE id=$1', [taskId])
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
    try {
        await requireAdmin()

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
    }
}

// Вспомогательная функция для уведомлений
async function notifyTelegram(supplierName: string, status: string, taskId: number, filePath: string, itemsCount: number = 0) {
  const token = process.env.BOT_TOKEN
  const chatIds = process.env.MANAGER_CHAT_ID?.split(',') || []
  
  if (!token || chatIds.length === 0) return

  const isSuccess = status === 'completed' || status === 'Сырой CSV'
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
        await scrapingQuery('UPDATE scraping_tasks SET batch_id = $1 WHERE id = $2', [batchId, taskId])
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
        await scrapingQuery('UPDATE scraping_batches SET stage = $1 WHERE id = $2', [stage, batchId])
        revalidatePath('/admin/batches')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

export async function pushBatchToCatalogAction(batchId: string): Promise<ActionResponse> {
    try {
        await requireAdmin()
        const workflow = require('../scripts/batch-workflow')
        const result = await workflow.pushBatchToCatalog(batchId)
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
export async function createBatchAction(name: string, supplierId?: number, itemsCount: number = 0) {
    try {
        await requireAdmin()
        const id = crypto.randomUUID()
        await scrapingQuery(
            'INSERT INTO scraping_batches (id, name, supplier_id, items_count, stage) VALUES ($1, $2, $3, $4, $5)',
            [id, name, supplierId || null, itemsCount, 'SCRAPED']
        )
        return { success: true, data: { id } }
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
                   (SELECT result_path FROM scraping_tasks WHERE batch_id = b.id AND status = 'Сырой CSV' ORDER BY created_at ASC LIMIT 1) as raw_path,
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
export async function deleteBatchAction(batchId: string) {
    try {
        await requireAdmin()
        // 0. Удаляем фотографии из S3 бакета Beget
        try {
            await deleteS3Folder(`batches/${batchId}/`);
        } catch (s3Err: any) {
            console.warn('Could not delete images from S3:', s3Err.message);
        }

        // 1. Удаляем товары, привязанные к этой партии в технической базе
        const deleteProductsRes = await scrapingQuery('DELETE FROM products WHERE batch_id = $1', [batchId])
        const deletedCount = deleteProductsRes.rowCount

        // 2. Удаляем товары из основной базы (если они были туда запушены)
        try {
            await query('DELETE FROM products WHERE batch_id = $1', [batchId])
        } catch (vibeErr: any) {
             console.warn('Could not delete from vibe DB:', vibeErr.message)
        }

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

        return { success: true, deletedCount }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}


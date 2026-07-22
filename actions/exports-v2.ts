'use server'

import crypto from 'crypto'
import { spawn } from 'child_process'
import path from 'path'
import { createInterface } from 'readline'
import { revalidatePath } from 'next/cache'
import { getScrapingClient, scrapingQuery } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'
import type { V2AlbumRole } from '@/lib/exports-v2-types'
import { buildExportsV2MediaPlan } from '@/lib/exports-v2-media'

const ALBUMS_PER_PAGE = 80
const MAX_GROUP_SIZE = 30
const TRAINING_CONTEXT_RADIUS = 4
const MAX_CONTIGUOUS_CONTEXT_SPAN = 40

const ROLE_FLAGS: Record<V2AlbumRole, { useText: boolean, useMedia: boolean, useForAi: boolean }> = {
  UNASSIGNED: { useText: false, useMedia: false, useForAi: false },
  PRIMARY_MEDIA: { useText: true, useMedia: true, useForAi: true },
  ON_MODEL: { useText: false, useMedia: true, useForAi: true },
  MEDIA_WITH_TEXT: { useText: true, useMedia: true, useForAi: true },
  EXTRA_MEDIA: { useText: false, useMedia: true, useForAi: true },
  TEXT_ONLY: { useText: true, useMedia: false, useForAi: true },
  SIZE_CHART: { useText: true, useMedia: false, useForAi: true },
  COMPARISON_OR_AD: { useText: false, useMedia: false, useForAi: false },
  IGNORE: { useText: false, useMedia: false, useForAi: false },
}

type HistoricalAlbum = {
  external_id: string
  name: string
  description: string
  price: number
  brand: string
  category: string
  subcategory: string
  gender: string
  photos: string[]
}

type NativeAlbum = {
  external_id: string
  name: string
  description: string
  photos: string[]
  media: SourceMedia[]
  source_published_at: string | null
  source_position: number
  source_page: number
  page_position: number
  raw_payload: Record<string, unknown>
}

type SourceMedia = {
  type: 'image' | 'video'
  url: string
  preview_url: string
}

type NativeIngestResult = 'inserted' | 'updated' | 'unchanged'

async function requireAdminOrWorker(workerSecret?: string) {
  if (process.env.NODE_ENV !== 'production' && workerSecret === 'dev-api-route') return
  if (
    workerSecret &&
    process.env.SCRAPER_WORKER_SECRET &&
    workerSecret === process.env.SCRAPER_WORKER_SECRET
  ) return
  await requireAdmin()
}

function normalizePhotos(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  if (!value) return []

  const text = String(value).trim()
  if (!text) return []

  try {
    return normalizePhotos(JSON.parse(text))
  } catch {
    return text.split(/[|,;]/).map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
}

function normalizeMedia(value: unknown, photos: string[]): SourceMedia[] {
  const normalized: SourceMedia[] = []
  const seen = new Set<string>()
  const append = (type: 'image' | 'video', urlValue: unknown, previewValue?: unknown) => {
    const url = String(urlValue || '').trim()
    if (!url) return
    const key = `${type}:${url}`
    if (seen.has(key)) return
    seen.add(key)
    normalized.push({
      type,
      url,
      preview_url: String(previewValue || url).trim() || url,
    })
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const raw = entry as Record<string, unknown>
      append(raw.type === 'video' ? 'video' : 'image', raw.url, raw.preview_url)
    })
  }
  if (normalized.length === 0) photos.forEach((photo) => append('image', photo, photo))
  return normalized
}

function parseDelimitedRows(text: string) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = normalized.split('\n')[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    const nextCharacter = normalized[index + 1]

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.trim().length === 0) {
      quoted = true
      field = ''
    } else if (character === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (character === '\n') {
      row.push(field.trim())
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || row.length > 0) {
    row.push(field.trim())
    if (row.some((value) => value !== '')) rows.push(row)
  }

  return rows
}

function parseHistoricalAlbums(text: string, taskId: number): HistoricalAlbum[] {
  const rows = parseDelimitedRows(text)
  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.toLowerCase().trim())
  const seenExternalIds = new Set<string>()

  return rows.slice(1).flatMap((values, index) => {
    const raw: Record<string, string> = {}
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex] || ''
    })

    const externalId = String(raw.external_id || `historical-${taskId}-${index + 1}`).trim()
    if (seenExternalIds.has(externalId)) return []
    seenExternalIds.add(externalId)

    return [{
      external_id: externalId,
      name: raw.name || '',
      description: raw.description || '',
      price: Number(raw.price || 0),
      brand: raw.brand || '',
      category: raw.category || '',
      subcategory: raw.subcategory || '',
      gender: raw.gender || '',
      photos: normalizePhotos(raw.photos),
    }]
  })
}

function contentHash(album: Pick<HistoricalAlbum, 'external_id' | 'name' | 'description' | 'photos'> & { media?: SourceMedia[] }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    external_id: album.external_id,
    name: album.name,
    description: album.description,
    photos: album.photos,
    media: album.media || normalizeMedia(null, album.photos),
  })).digest('hex')
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNativeAlbum(value: unknown, fallbackPosition: number): NativeAlbum | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const externalId = String(raw.external_id || '').trim()
  if (!externalId) return null

  const photos = normalizePhotos(raw.photos)
  return {
    external_id: externalId,
    name: String(raw.name || '').trim(),
    description: String(raw.description || '').trim(),
    photos,
    media: normalizeMedia(raw.media, photos),
    source_published_at: raw.source_published_at ? String(raw.source_published_at) : null,
    source_position: positiveInteger(raw.source_position, fallbackPosition),
    source_page: positiveInteger(raw.source_page, 1),
    page_position: positiveInteger(raw.page_position, fallbackPosition),
    raw_payload: raw.raw_payload && typeof raw.raw_payload === 'object'
      ? raw.raw_payload as Record<string, unknown>
      : {},
  }
}

async function recordNativeObservation(client: any, passId: string, albumId: string, album: NativeAlbum) {
  await client.query(`
    INSERT INTO scraping_v2_album_observations (
      pass_id, album_id, source_position, source_page, page_position
    ) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (pass_id, album_id) DO UPDATE
    SET source_position=EXCLUDED.source_position,
        source_page=EXCLUDED.source_page,
        page_position=EXCLUDED.page_position,
        observed_at=NOW()
  `, [passId, albumId, album.source_position, album.source_page, album.page_position])
}

async function ingestNativeAlbum(
  runId: string,
  passId: string,
  supplierId: number,
  album: NativeAlbum,
): Promise<NativeIngestResult> {
  const client = await getScrapingClient()
  const hash = contentHash(album)

  try {
    await client.query('BEGIN')
    const existingResult = await client.query(`
      SELECT id, content_hash
      FROM scraping_v2_albums
      WHERE run_id=$1 AND external_id=$2
      FOR UPDATE
    `, [runId, album.external_id])
    const existing = existingResult.rows[0]

    if (existing?.content_hash === hash) {
      await recordNativeObservation(client, passId, existing.id, album)
      await client.query('COMMIT')
      return 'unchanged'
    }

    if (existing) {
      await client.query(`
        INSERT INTO scraping_v2_album_revisions (
          id, album_id, content_hash, description, photos, media, raw_payload
        ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
        ON CONFLICT (album_id, content_hash) DO NOTHING
      `, [
        crypto.randomUUID(),
        existing.id,
        hash,
        album.description,
        JSON.stringify(album.photos),
        JSON.stringify(album.media),
        JSON.stringify(album.raw_payload),
      ])
      await client.query(`
        UPDATE scraping_v2_albums
        SET name=$1,
            description=$2,
            photos=$3::jsonb,
            media=$4::jsonb,
            raw_payload=$5::jsonb,
            content_hash=$6,
            source_published_at=$7,
            updated_at=NOW()
        WHERE id=$8
      `, [
        album.name,
        album.description,
        JSON.stringify(album.photos),
        JSON.stringify(album.media),
        JSON.stringify(album.raw_payload),
        hash,
        album.source_published_at,
        existing.id,
      ])
      await recordNativeObservation(client, passId, existing.id, album)
      await client.query('COMMIT')
      return 'updated'
    }

    const orderResult = await client.query(
      'SELECT COALESCE(MAX(source_order), 0)::int + 1 AS next_order FROM scraping_v2_albums WHERE run_id=$1',
      [runId],
    )
    const albumId = crypto.randomUUID()
    await client.query(`
      INSERT INTO scraping_v2_albums (
        id, run_id, supplier_id, external_id, source_order, source_published_at,
        name, description, photos, media, raw_payload, content_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
    `, [
      albumId,
      runId,
      supplierId,
      album.external_id,
      Number(orderResult.rows[0]?.next_order || 1),
      album.source_published_at,
      album.name,
      album.description,
      JSON.stringify(album.photos),
      JSON.stringify(album.media),
      JSON.stringify(album.raw_payload),
      hash,
    ])
    await client.query(`
      INSERT INTO scraping_v2_album_revisions (
        id, album_id, content_hash, description, photos, media, raw_payload
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
    `, [
      crypto.randomUUID(),
      albumId,
      hash,
      album.description,
      JSON.stringify(album.photos),
      JSON.stringify(album.media),
      JSON.stringify(album.raw_payload),
    ])
    await recordNativeObservation(client, passId, albumId, album)
    await client.query('COMMIT')
    return 'inserted'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function forwardExportsV2ToWorker(supplierId: number, endDate?: string): Promise<ActionResponse | null> {
  const workerUrl = process.env.SCRAPER_WORKER_URL?.replace(/\/+$/, '')
  if (!workerUrl) return null

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.SCRAPER_WORKER_SECRET) {
      headers.Authorization = `Bearer ${process.env.SCRAPER_WORKER_SECRET}`
    }
    const response = await fetch(`${workerUrl}/api/scraping/v2/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ supplierId, endDate }),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return { success: false, error: payload?.error || `Worker returned ${response.status}` }
    }
    return payload
  } catch (error: any) {
    return { success: false, error: `Не удалось отправить V2-выгрузку на worker: ${error.message}` }
  }
}

export async function startExportsV2ScrapingAction(supplierId: number, endDate?: string): Promise<ActionResponse> {
  await requireAdmin()
  const workerResult = await forwardExportsV2ToWorker(supplierId, endDate)
  if (workerResult) return workerResult
  return startExportsV2ScrapingLocalAction(supplierId, endDate)
}

export async function startExportsV2ScrapingLocalAction(
  supplierId: number,
  endDate?: string,
  workerSecret?: string,
): Promise<ActionResponse> {
  let runId = ''
  let passId = ''

  try {
    await requireAdminOrWorker(workerSecret)
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return { success: false, error: 'Некорректный поставщик' }
    }

    const supplierResult = await scrapingQuery('SELECT * FROM suppliers WHERE id=$1', [supplierId])
    const supplier = supplierResult.rows[0]
    if (!supplier) return { success: false, error: 'Поставщик не найден' }
    if (!supplier.album_id) return { success: false, error: 'У поставщика не указан album_id' }

    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      const existingResult = await client.query(`
        SELECT id, status
        FROM scraping_v2_runs
        WHERE supplier_id=$1 AND source_kind='DB_NATIVE' AND status <> 'ARCHIVED'
        FOR UPDATE
      `, [supplierId])
      const existing = existingResult.rows[0]
      if (existing?.status === 'RUNNING') throw new Error('V2-выгрузка этого поставщика уже выполняется')

      runId = existing?.id || crypto.randomUUID()
      if (existing) {
        await client.query(`
          UPDATE scraping_v2_runs
          SET status='RUNNING', last_started_at=NOW(), last_completed_at=NULL,
              last_error=NULL, last_received_count=0, last_inserted_count=0,
              last_updated_count=0, last_unchanged_count=0, updated_at=NOW()
          WHERE id=$1
        `, [runId])
      } else {
        const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date())
        await client.query(`
          INSERT INTO scraping_v2_runs (
            id, supplier_id, name, status, source_kind, production_push_enabled, last_started_at
          ) VALUES ($1,$2,$3,'RUNNING','DB_NATIVE',FALSE,NOW())
        `, [runId, supplierId, `V2 · ${supplier.name} · ${date}`])
      }
      passId = crypto.randomUUID()
      await client.query(`
        INSERT INTO scraping_v2_scrape_passes (
          id, run_id, supplier_id, status, cutoff_date
        ) VALUES ($1,$2,$3,'RUNNING',$4)
      `, [passId, runId, supplierId, endDate || null])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParserV2.py')
    const args = [
      scriptPath,
      '--album_id', String(supplier.album_id),
      '--cookie', String(supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || ''),
    ]
    if (endDate) args.push('--end_date', endDate)
    if (supplier.group_id) args.push('--group_id', String(supplier.group_id))
    if (supplier.tag_id) args.push('--tag_id', String(supplier.tag_id))
    if (supplier.parse_tags_enabled) args.push('--parse_tags')

    const pythonProcess = spawn(/*turbopackIgnore: true*/ process.env.PYTHON_PATH || 'python', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = createInterface({ input: pythonProcess.stdout })
    let stderr = ''
    let received = 0
    let inserted = 0
    let updated = 0
    let unchanged = 0
    let processing = Promise.resolve()
    let processError: Error | null = null
    let finalized = false

    output.on('line', (line) => {
      if (!line.trim()) return
      processing = processing.then(async () => {
        const event = JSON.parse(line)
        if (event?.type !== 'album') return
        const album = normalizeNativeAlbum(event.album, received + 1)
        if (!album) throw new Error('Парсер V2 вернул альбом без external_id')
        received += 1
        const result = await ingestNativeAlbum(runId, passId, supplierId, album)
        if (result === 'inserted') inserted += 1
        else if (result === 'updated') updated += 1
        else unchanged += 1
      }).catch((error) => {
        processError ||= error instanceof Error ? error : new Error(String(error))
      })
    })
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString()
      console.error(`[Scraper V2 ${runId}] ${data}`)
    })

    const finalize = async (exitCode: number | null) => {
      if (finalized) return
      finalized = true
      await processing
      const failed = exitCode !== 0 || processError !== null
      const errorMessage = failed
        ? (processError?.message || stderr.trim() || `V2 parser exited with code ${exitCode}`)
        : null
      await scrapingQuery(`
        UPDATE scraping_v2_scrape_passes
        SET status=CASE WHEN $2::boolean THEN 'FAILED' ELSE 'COMPLETED' END,
            received_count=$3, inserted_count=$4, updated_count=$5,
            unchanged_count=$6, error_message=$7, completed_at=NOW()
        WHERE id=$1
      `, [passId, failed, received, inserted, updated, unchanged, errorMessage])
      await scrapingQuery(`
        UPDATE scraping_v2_runs r
        SET status = CASE
              WHEN $2::boolean THEN 'FAILED'
              WHEN EXISTS (
                SELECT 1 FROM scraping_v2_product_drafts d
                WHERE d.run_id=r.id AND d.status <> 'ARCHIVED'
              ) THEN 'GROUPING'
              ELSE 'READY_FOR_GROUPING'
            END,
            album_count=(SELECT COUNT(*)::int FROM scraping_v2_albums a WHERE a.run_id=r.id),
            last_completed_at=NOW(), last_error=$3,
            last_received_count=$4, last_inserted_count=$5,
            last_updated_count=$6, last_unchanged_count=$7, updated_at=NOW()
        WHERE r.id=$1
      `, [runId, failed, errorMessage, received, inserted, updated, unchanged])
      revalidatePath('/admin/exports-v2')
      revalidatePath(`/admin/exports-v2/${runId}`)
    }

    pythonProcess.on('error', (error) => {
      processError = error
      void finalize(null)
    })
    pythonProcess.on('close', (code) => {
      void finalize(code)
    })

    revalidatePath('/admin/exports-v2')
    return { success: true, data: { runId, passId, status: 'RUNNING' } }
  } catch (error: any) {
    if (passId) {
      await scrapingQuery(`
        UPDATE scraping_v2_scrape_passes
        SET status='FAILED', error_message=$2, completed_at=NOW()
        WHERE id=$1
      `, [passId, error.message]).catch(() => undefined)
    }
    if (runId) {
      await scrapingQuery(`
        UPDATE scraping_v2_runs
        SET status='FAILED', last_completed_at=NOW(), last_error=$2, updated_at=NOW()
        WHERE id=$1
      `, [runId, error.message]).catch(() => undefined)
    }
    return { success: false, error: error.message }
  }
}

async function insertAlbumChunk(client: any, rows: Array<{
  id: string
  runId: string
  supplierId: number
  sourceOrder: number
  album: HistoricalAlbum
  hash: string
}>) {
  const values: unknown[] = []
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * 11
    values.push(
      row.id,
      row.runId,
      row.supplierId,
      row.album.external_id,
      row.sourceOrder,
      row.album.name,
      row.album.description,
      JSON.stringify(row.album.photos),
      JSON.stringify(normalizeMedia(null, row.album.photos)),
      JSON.stringify(row.album),
      row.hash,
    )
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8}::jsonb,$${offset + 9}::jsonb,$${offset + 10}::jsonb,$${offset + 11})`
  })

  await client.query(`
    INSERT INTO scraping_v2_albums (
      id, run_id, supplier_id, external_id, source_order,
      name, description, photos, media, raw_payload, content_hash
    ) VALUES ${placeholders.join(',')}
  `, values)
}

export async function getExportsV2DashboardAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()

    const [runsResult, sourcesResult, suppliersResult] = await Promise.all([
      scrapingQuery(`
        SELECT
          r.id,
          r.name,
          r.status,
          r.supplier_id,
          s.name AS supplier_name,
          s.avatar_url AS supplier_avatar,
          r.album_count,
          r.source_kind,
          r.source_task_id,
          r.production_push_enabled,
          r.last_started_at,
          r.last_completed_at,
          r.last_error,
          r.last_received_count,
          r.last_inserted_count,
          r.last_updated_count,
          r.last_unchanged_count,
          r.created_at,
          COUNT(DISTINCT da.album_id)::int AS assigned_count,
          COUNT(DISTINCT d.id)::int AS draft_count,
          COUNT(DISTINCT te.id)::int AS training_example_count
        FROM scraping_v2_runs r
        JOIN suppliers s ON s.id = r.supplier_id
        LEFT JOIN scraping_v2_product_drafts d ON d.run_id = r.id AND d.status <> 'ARCHIVED'
        LEFT JOIN scraping_v2_draft_albums da ON da.draft_id = d.id
        LEFT JOIN scraping_v2_training_examples te ON te.run_id = r.id
        GROUP BY r.id, s.name, s.avatar_url
        ORDER BY r.created_at DESC
        LIMIT 50
      `),
      scrapingQuery(`
        SELECT
          t.id AS task_id,
          t.batch_id,
          t.supplier_id,
          s.name AS supplier_name,
          s.avatar_url AS supplier_avatar,
          COALESCE(t.items_count, 0)::int AS items_count,
          t.created_at,
          sf.file_name,
          s.post_process_script AS script_name,
          r.id AS already_imported_run_id
        FROM scraping_tasks t
        JOIN suppliers s ON s.id = t.supplier_id
        JOIN scraping_files sf ON sf.task_id = t.id AND sf.content IS NOT NULL
        LEFT JOIN scraping_v2_runs r ON r.source_task_id = t.id
        WHERE t.status = 'Сырой CSV'
        ORDER BY
          CASE WHEN s.name IN ('Chanel Сумки', 'Zimmermann Одежда', 'Женская одежда 4') THEN 0 ELSE 1 END,
          t.created_at DESC
        LIMIT 60
      `),
      scrapingQuery(`
        SELECT
          s.id,
          s.name,
          s.avatar_url,
          s.album_id,
          s.group_id,
          s.tag_id
        FROM suppliers s
        WHERE NULLIF(TRIM(s.album_id), '') IS NOT NULL
        ORDER BY COALESCE(s.is_favorite, FALSE) DESC, s.name ASC
      `),
    ])

    return {
      success: true,
      data: { runs: runsResult.rows, sources: sourcesResult.rows, suppliers: suppliersResult.rows },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function createExportsV2RunFromHistoryAction(taskId: number): Promise<ActionResponse> {
  const client = await getScrapingClient()

  try {
    await requireAdmin()
    await client.query('BEGIN')

    const sourceResult = await client.query(`
      SELECT
        t.id,
        t.batch_id,
        t.supplier_id,
        t.created_at,
        s.name AS supplier_name,
        sf.content
      FROM scraping_tasks t
      JOIN suppliers s ON s.id = t.supplier_id
      JOIN scraping_files sf ON sf.task_id = t.id
      WHERE t.id = $1 AND t.status = 'Сырой CSV'
      FOR UPDATE OF t
    `, [taskId])

    const source = sourceResult.rows[0]
    if (!source) throw new Error('Исходная сырая выгрузка не найдена')

    const existingResult = await client.query(
      'SELECT id FROM scraping_v2_runs WHERE source_task_id = $1',
      [taskId],
    )
    if (existingResult.rows[0]) {
      await client.query('COMMIT')
      return { success: true, data: { id: existingResult.rows[0].id, existed: true } }
    }

    const albums = parseHistoricalAlbums(String(source.content || ''), taskId)
    if (albums.length === 0) throw new Error('В исходной выгрузке не найдено альбомов')

    const runId = crypto.randomUUID()
    const date = new Date(source.created_at).toLocaleDateString('ru-RU')
    await client.query(`
      INSERT INTO scraping_v2_runs (
        id, supplier_id, name, status, source_kind, source_task_id,
        source_batch_id, album_count, production_push_enabled
      ) VALUES ($1,$2,$3,'READY_FOR_GROUPING','HISTORICAL_V1',$4,$5,$6,FALSE)
    `, [runId, source.supplier_id, `V2 · ${source.supplier_name} · ${date}`, taskId, source.batch_id, albums.length])

    const rows = albums.map((album, index) => ({
      id: crypto.randomUUID(),
      runId,
      supplierId: Number(source.supplier_id),
      sourceOrder: index + 1,
      album,
      hash: contentHash(album),
    }))

    for (let index = 0; index < rows.length; index += 100) {
      await insertAlbumChunk(client, rows.slice(index, index + 100))
    }

    await client.query('COMMIT')
    revalidatePath('/admin/exports-v2')
    return { success: true, data: { id: runId, albumCount: albums.length } }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function getExportsV2RunAction(
  runId: string,
  options: { page?: number; search?: string; assignment?: 'all' | 'assigned' | 'unassigned' } = {},
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const page = Math.max(1, Number(options.page || 1))
    const search = String(options.search || '').trim()
    const assignment = options.assignment || 'all'
    const offset = (page - 1) * ALBUMS_PER_PAGE

    const runResult = await scrapingQuery(`
      SELECT
        r.*,
        s.name AS supplier_name,
        s.avatar_url AS supplier_avatar,
        s.max_on_model_media,
        COUNT(DISTINCT da.album_id)::int AS assigned_count,
        COUNT(DISTINCT d.id)::int AS draft_count,
        COUNT(DISTINCT te.id)::int AS training_example_count
      FROM scraping_v2_runs r
      JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN scraping_v2_product_drafts d ON d.run_id = r.id AND d.status <> 'ARCHIVED'
      LEFT JOIN scraping_v2_draft_albums da ON da.draft_id = d.id
      LEFT JOIN scraping_v2_training_examples te ON te.run_id = r.id
      WHERE r.id = $1
      GROUP BY r.id, s.name, s.avatar_url, s.max_on_model_media
    `, [runId])
    if (!runResult.rows[0]) return { success: false, error: 'Запуск V2 не найден' }

    const filters = ['a.run_id = $1']
    const params: unknown[] = [runId]
    if (search) {
      params.push(`%${search}%`)
      filters.push(`(a.description ILIKE $${params.length} OR a.external_id ILIKE $${params.length})`)
    }
    if (assignment === 'assigned') filters.push('da.album_id IS NOT NULL')
    if (assignment === 'unassigned') filters.push('da.album_id IS NULL')

    const countResult = await scrapingQuery(`
      SELECT COUNT(*)::int AS count
      FROM scraping_v2_albums a
      LEFT JOIN scraping_v2_draft_albums da ON da.album_id = a.id
      WHERE ${filters.join(' AND ')}
    `, params)

    const albumParams = [...params, ALBUMS_PER_PAGE, offset]
    const albumsResult = await scrapingQuery(`
      WITH latest_pass AS (
        SELECT p.id
        FROM scraping_v2_scrape_passes p
        WHERE p.run_id=$1 AND p.status='COMPLETED'
        ORDER BY p.completed_at DESC
        LIMIT 1
      )
      SELECT
        a.id,
        a.external_id,
        COALESCE(o.source_position, a.source_order) AS source_order,
        o.source_page,
        o.page_position,
        a.name,
        a.description,
        a.photos,
        a.media,
        da.draft_id,
        da.sort_order AS draft_sort_order,
        da.role,
        da.use_text,
        da.use_media,
        da.use_photos,
        da.use_for_ai
      FROM scraping_v2_albums a
      LEFT JOIN scraping_v2_draft_albums da ON da.album_id = a.id
      LEFT JOIN scraping_v2_album_observations o
        ON o.album_id=a.id AND o.pass_id=(SELECT id FROM latest_pass)
      WHERE ${filters.join(' AND ')}
      ORDER BY CASE WHEN o.album_id IS NULL THEN 1 ELSE 0 END,
               COALESCE(o.source_position, a.source_order)
      LIMIT $${albumParams.length - 1} OFFSET $${albumParams.length}
    `, albumParams)

    const draftsResult = await scrapingQuery(`
      WITH latest_pass AS (
        SELECT p.id
        FROM scraping_v2_scrape_passes p
        WHERE p.run_id=$1 AND p.status='COMPLETED'
        ORDER BY p.completed_at DESC
        LIMIT 1
      )
      SELECT
        d.id,
        d.status,
        d.name,
        d.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', a.id,
              'external_id', a.external_id,
              'source_order', COALESCE(o.source_position, a.source_order),
              'source_page', o.source_page,
              'page_position', o.page_position,
              'name', a.name,
              'description', a.description,
              'photos', a.photos,
              'media', a.media,
              'draft_id', da.draft_id,
              'draft_sort_order', da.sort_order,
              'role', da.role,
              'use_text', da.use_text,
              'use_media', da.use_media,
              'use_photos', da.use_photos,
              'use_for_ai', da.use_for_ai
            ) ORDER BY da.sort_order, COALESCE(o.source_position, a.source_order)
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) AS albums
      FROM scraping_v2_product_drafts d
      LEFT JOIN scraping_v2_draft_albums da ON da.draft_id = d.id
      LEFT JOIN scraping_v2_albums a ON a.id = da.album_id
      LEFT JOIN scraping_v2_album_observations o
        ON o.album_id=a.id AND o.pass_id=(SELECT id FROM latest_pass)
      WHERE d.run_id = $1 AND d.status <> 'ARCHIVED'
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT 50
    `, [runId])

    return {
      success: true,
      data: {
        ...runResult.rows[0],
        total_albums: Number(countResult.rows[0]?.count || 0),
        page,
        per_page: ALBUMS_PER_PAGE,
        albums: albumsResult.rows,
        drafts: draftsResult.rows,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function createExportsV2DraftAction(runId: string, albumIds: string[]): Promise<ActionResponse> {
  const client = await getScrapingClient()

  try {
    await requireAdmin()
    const uniqueAlbumIds = [...new Set(albumIds.map(String).filter(Boolean))]
    if (uniqueAlbumIds.length === 0) throw new Error('Выберите хотя бы один альбом')
    if (uniqueAlbumIds.length > MAX_GROUP_SIZE) throw new Error(`За один раз можно объединить не более ${MAX_GROUP_SIZE} альбомов`)

    await client.query('BEGIN')
    const albumsResult = await client.query(`
      WITH latest_pass AS (
        SELECT p.id
        FROM scraping_v2_scrape_passes p
        WHERE p.run_id=$1 AND p.status='COMPLETED'
        ORDER BY p.completed_at DESC
        LIMIT 1
      )
      SELECT a.id, COALESCE(o.source_position, a.source_order) AS source_order
      FROM scraping_v2_albums a
      LEFT JOIN scraping_v2_draft_albums da ON da.album_id = a.id
      LEFT JOIN scraping_v2_album_observations o
        ON o.album_id=a.id AND o.pass_id=(SELECT id FROM latest_pass)
      WHERE a.run_id = $1 AND a.id = ANY($2::text[]) AND da.album_id IS NULL
      FOR UPDATE OF a
    `, [runId, uniqueAlbumIds])

    if (albumsResult.rows.length !== uniqueAlbumIds.length) {
      throw new Error('Часть альбомов уже входит в другой товар или относится к другому запуску')
    }

    const runResult = await client.query('SELECT supplier_id FROM scraping_v2_runs WHERE id = $1', [runId])
    if (!runResult.rows[0]) throw new Error('Запуск V2 не найден')

    const draftId = crypto.randomUUID()
    await client.query(`
      INSERT INTO scraping_v2_product_drafts (id, run_id, supplier_id, status, name)
      VALUES ($1,$2,$3,'GROUPING_DRAFT',$4)
    `, [draftId, runId, runResult.rows[0].supplier_id, `Товар из ${uniqueAlbumIds.length} альб.`])

    const albumsById = new Map(albumsResult.rows.map((album) => [String(album.id), album]))
    const orderedAlbums = uniqueAlbumIds.map((albumId) => albumsById.get(albumId))
    if (orderedAlbums.some((album) => !album)) {
      throw new Error('Не удалось сохранить порядок выбранных альбомов')
    }

    for (const [index, album] of orderedAlbums.entries()) {
      const role: V2AlbumRole = index === 0 ? 'PRIMARY_MEDIA' : 'UNASSIGNED'
      const flags = ROLE_FLAGS[role]
      await client.query(`
        INSERT INTO scraping_v2_draft_albums (
          draft_id, album_id, role, use_text, use_media, use_photos, use_for_ai, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$5,$6,$7)
      `, [draftId, album.id, role, flags.useText, flags.useMedia, flags.useForAi, index])
    }

    await client.query("UPDATE scraping_v2_runs SET status='GROUPING', updated_at=NOW() WHERE id=$1", [runId])
    await client.query('COMMIT')
    revalidatePath(`/admin/exports-v2/${runId}`)
    return { success: true, data: { id: draftId } }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function addExportsV2AlbumsToDraftAction(
  draftId: string,
  albumIds: string[],
): Promise<ActionResponse> {
  const client = await getScrapingClient()

  try {
    await requireAdmin()
    const uniqueAlbumIds = [...new Set(albumIds.map(String).filter(Boolean))]
    if (uniqueAlbumIds.length === 0) throw new Error('Выберите хотя бы один альбом')

    await client.query('BEGIN')
    const draftResult = await client.query(`
      SELECT d.run_id, d.status
      FROM scraping_v2_product_drafts d
      WHERE d.id=$1 AND d.status <> 'ARCHIVED'
      FOR UPDATE
    `, [draftId])
    const draft = draftResult.rows[0]
    if (!draft) throw new Error('Черновик товара не найден')
    if (draft.status === 'GROUPED') {
      throw new Error('Сначала отмените сохранение примера, затем изменяйте состав товара')
    }

    const existingExample = await client.query(
      'SELECT 1 FROM scraping_v2_training_examples WHERE draft_id=$1 LIMIT 1',
      [draftId],
    )
    if (existingExample.rows[0]) {
      throw new Error('Сначала отмените сохранение примера, затем изменяйте состав товара')
    }

    const countResult = await client.query(
      'SELECT COUNT(*)::int AS count, COALESCE(MAX(sort_order), -1)::int AS max_sort_order FROM scraping_v2_draft_albums WHERE draft_id=$1',
      [draftId],
    )
    const existingCount = Number(countResult.rows[0]?.count || 0)
    if (existingCount + uniqueAlbumIds.length > MAX_GROUP_SIZE) {
      throw new Error(`В одном товаре может быть не более ${MAX_GROUP_SIZE} альбомов`)
    }

    const albumsResult = await client.query(`
      SELECT a.id
      FROM scraping_v2_albums a
      LEFT JOIN scraping_v2_draft_albums da ON da.album_id=a.id
      WHERE a.run_id=$1 AND a.id=ANY($2::text[]) AND da.album_id IS NULL
      FOR UPDATE OF a
    `, [draft.run_id, uniqueAlbumIds])
    if (albumsResult.rows.length !== uniqueAlbumIds.length) {
      throw new Error('Часть альбомов уже входит в другой товар или относится к другому запуску')
    }

    const availableIds = new Set(albumsResult.rows.map((album) => String(album.id)))
    let sortOrder = Number(countResult.rows[0]?.max_sort_order ?? -1) + 1
    for (const albumId of uniqueAlbumIds) {
      if (!availableIds.has(albumId)) throw new Error('Не удалось сохранить порядок выбранных альбомов')
      await client.query(`
        INSERT INTO scraping_v2_draft_albums (draft_id, album_id, role, sort_order)
        VALUES ($1,$2,'UNASSIGNED',$3)
      `, [draftId, albumId, sortOrder])
      sortOrder += 1
    }

    const totalCount = existingCount + uniqueAlbumIds.length
    await client.query(`
      UPDATE scraping_v2_product_drafts
      SET name=$2, status='GROUPING_DRAFT', updated_at=NOW()
      WHERE id=$1
    `, [draftId, `Товар из ${totalCount} альб.`])
    await client.query('COMMIT')
    revalidatePath(`/admin/exports-v2/${draft.run_id}`)
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function reopenExportsV2DraftAction(draftId: string): Promise<ActionResponse> {
  const client = await getScrapingClient()

  try {
    await requireAdmin()
    await client.query('BEGIN')
    const draftResult = await client.query(`
      SELECT run_id
      FROM scraping_v2_product_drafts
      WHERE id=$1 AND status <> 'ARCHIVED'
      FOR UPDATE
    `, [draftId])
    const runId = draftResult.rows[0]?.run_id
    if (!runId) throw new Error('Черновик товара не найден')

    const deleted = await client.query(
      'DELETE FROM scraping_v2_training_examples WHERE draft_id=$1 RETURNING id',
      [draftId],
    )
    await client.query(`
      UPDATE scraping_v2_product_drafts
      SET status='GROUPING_DRAFT', updated_at=NOW()
      WHERE id=$1
    `, [draftId])
    await client.query('COMMIT')

    revalidatePath(`/admin/exports-v2/${runId}`)
    revalidatePath('/admin/exports-v2')
    return { success: true, data: { removedExamples: deleted.rowCount || 0 } }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function updateExportsV2AlbumRoleAction(
  draftId: string,
  albumId: string,
  role: V2AlbumRole,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const flags = ROLE_FLAGS[role]
    if (!flags) return { success: false, error: 'Неизвестная роль альбома' }

    const result = await scrapingQuery(`
      UPDATE scraping_v2_draft_albums da
      SET role=$1, use_text=$2, use_media=$3, use_photos=$3, use_for_ai=$4, updated_at=NOW()
      FROM scraping_v2_product_drafts d
      WHERE da.draft_id=$5 AND da.album_id=$6 AND d.id=da.draft_id
        AND d.status <> 'GROUPED'
        AND NOT EXISTS (
          SELECT 1 FROM scraping_v2_training_examples te WHERE te.draft_id=da.draft_id
        )
      RETURNING da.draft_id
    `, [role, flags.useText, flags.useMedia, flags.useForAi, draftId, albumId])
    if (!result.rows[0]) return { success: false, error: 'Сначала отмените сохранение примера, затем меняйте роли' }

    const runResult = await scrapingQuery(`
      SELECT d.run_id
      FROM scraping_v2_product_drafts d
      WHERE d.id = $1
    `, [draftId])
    const runId = runResult.rows[0]?.run_id
    if (runId) revalidatePath(`/admin/exports-v2/${runId}`)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function ungroupExportsV2AlbumAction(draftId: string, albumId: string): Promise<ActionResponse> {
  const client = await getScrapingClient()

  try {
    await requireAdmin()
    await client.query('BEGIN')
    const draftResult = await client.query(`
      SELECT d.run_id, d.status,
        EXISTS (SELECT 1 FROM scraping_v2_training_examples te WHERE te.draft_id=d.id) AS has_example
      FROM scraping_v2_product_drafts d
      WHERE d.id=$1
      FOR UPDATE
    `, [draftId])
    const draft = draftResult.rows[0]
    const runId = draft?.run_id
    if (!runId) throw new Error('Черновик товара не найден')
    if (draft.status === 'GROUPED' || draft.has_example) {
      throw new Error('Сначала отмените сохранение примера, затем изменяйте состав товара')
    }

    await client.query('DELETE FROM scraping_v2_draft_albums WHERE draft_id=$1 AND album_id=$2', [draftId, albumId])
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM scraping_v2_draft_albums WHERE draft_id=$1', [draftId])
    const remainingCount = Number(countResult.rows[0]?.count || 0)
    if (remainingCount === 0) {
      await client.query("UPDATE scraping_v2_product_drafts SET status='ARCHIVED', updated_at=NOW() WHERE id=$1", [draftId])
    } else {
      await client.query(`
        WITH ordered AS (
          SELECT album_id, ROW_NUMBER() OVER (ORDER BY sort_order, created_at, album_id) - 1 AS next_order
          FROM scraping_v2_draft_albums
          WHERE draft_id=$1
        )
        UPDATE scraping_v2_draft_albums da
        SET sort_order=ordered.next_order
        FROM ordered
        WHERE da.draft_id=$1 AND da.album_id=ordered.album_id
      `, [draftId])
      await client.query(`
        UPDATE scraping_v2_product_drafts
        SET name=$2, updated_at=NOW()
        WHERE id=$1
      `, [draftId, `Товар из ${remainingCount} альб.`])
    }

    await client.query('COMMIT')
    revalidatePath(`/admin/exports-v2/${runId}`)
    return { success: true }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function saveExportsV2TrainingExampleAction(draftId: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const draftResult = await scrapingQuery(`
      SELECT d.id, d.run_id, d.supplier_id, d.name, d.status, r.source_kind, s.max_on_model_media
      FROM scraping_v2_product_drafts d
      JOIN scraping_v2_runs r ON r.id=d.run_id
      JOIN suppliers s ON s.id=d.supplier_id
      WHERE d.id=$1 AND d.status <> 'ARCHIVED'
    `, [draftId])
    const draft = draftResult.rows[0]
    if (!draft) return { success: false, error: 'Черновик товара не найден' }
    if (draft.status === 'GROUPED') return { success: false, error: 'Этот пример уже сохранён' }

    const existingExample = await scrapingQuery(
      'SELECT 1 FROM scraping_v2_training_examples WHERE draft_id=$1 LIMIT 1',
      [draftId],
    )
    if (existingExample.rows[0]) return { success: false, error: 'Этот пример уже сохранён' }

    const albumsResult = await scrapingQuery(`
      SELECT
        a.id,
        a.external_id,
        a.source_order,
        a.name,
        a.description,
        a.photos,
        a.media,
        jsonb_array_length(a.photos) AS photo_count,
        a.photos->>0 AS preview_photo,
        jsonb_array_length(a.media) AS media_count,
        COALESCE(a.photos->>0, a.media->0->>'preview_url') AS preview_media,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(a.media) item
          WHERE item->>'type'='video'
        ) AS has_video,
        da.role,
        da.use_text,
        da.use_media,
        da.use_photos,
        da.use_for_ai,
        da.sort_order AS draft_sort_order
      FROM scraping_v2_draft_albums da
      JOIN scraping_v2_albums a ON a.id = da.album_id
      WHERE da.draft_id=$1
      ORDER BY da.sort_order, a.source_order
    `, [draftId])

    if (albumsResult.rows.some((album) => album.role === 'UNASSIGNED')) {
      return { success: false, error: 'Сначала назначьте роль каждому альбому' }
    }
    if (!albumsResult.rows.some((album) => album.role === 'PRIMARY_MEDIA')) {
      return { success: false, error: 'Для примера нужен хотя бы один альбом с основными медиа' }
    }

    const albumIds = albumsResult.rows.map((album) => String(album.id))
    const passResult = await scrapingQuery(`
      SELECT
        p.id,
        p.started_at,
        p.completed_at,
        COUNT(o.album_id)::int AS selected_coverage
      FROM scraping_v2_scrape_passes p
      LEFT JOIN scraping_v2_album_observations o
        ON o.pass_id=p.id AND o.album_id=ANY($2::text[])
      WHERE p.run_id=$1 AND p.status='COMPLETED'
      GROUP BY p.id
      HAVING COUNT(o.album_id) > 0
      ORDER BY selected_coverage DESC, p.completed_at DESC
      LIMIT 1
    `, [draft.run_id, albumIds])
    const bestPass = passResult.rows[0] || null
    const sourcePass = Number(bestPass?.selected_coverage || 0) === albumIds.length ? bestPass : null

    const contextResult = sourcePass
      ? await scrapingQuery(`
          WITH selected_positions AS (
            SELECT o.source_position
            FROM scraping_v2_album_observations o
            WHERE o.pass_id=$1 AND o.album_id=ANY($2::text[])
          ), bounds AS (
            SELECT MIN(source_position)::int AS min_position, MAX(source_position)::int AS max_position
            FROM selected_positions
          )
          SELECT
            a.id,
            a.external_id,
            a.name,
            a.description,
            jsonb_array_length(a.photos)::int AS photo_count,
            a.photos->>0 AS preview_photo,
            jsonb_array_length(a.media)::int AS media_count,
            COALESCE(a.photos->>0, a.media->0->>'preview_url') AS preview_media,
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(a.media) item
              WHERE item->>'type'='video'
            ) AS has_video,
            o.source_position,
            o.source_page,
            o.page_position,
            CASE
              WHEN a.id=ANY($2::text[]) THEN 'SELECTED'
              WHEN da.draft_id IS NOT NULL THEN 'OTHER_PRODUCT'
              ELSE 'UNASSIGNED_CONTEXT'
            END AS sequence_label,
            CASE WHEN a.id=ANY($2::text[]) THEN da.role ELSE NULL END AS role
          FROM scraping_v2_album_observations o
          JOIN scraping_v2_albums a ON a.id=o.album_id
          LEFT JOIN scraping_v2_draft_albums da ON da.album_id=a.id
          CROSS JOIN bounds b
          WHERE o.pass_id=$1 AND (
            a.id=ANY($2::text[])
            OR EXISTS (
              SELECT 1 FROM selected_positions sp
              WHERE ABS(o.source_position - sp.source_position) <= $3
            )
            OR (
              b.max_position - b.min_position <= $4
              AND o.source_position BETWEEN b.min_position AND b.max_position
            )
          )
          ORDER BY o.source_position
        `, [sourcePass.id, albumIds, TRAINING_CONTEXT_RADIUS, MAX_CONTIGUOUS_CONTEXT_SPAN])
      : await scrapingQuery(`
          WITH selected_positions AS (
            SELECT a.source_order AS source_position
            FROM scraping_v2_albums a
            WHERE a.run_id=$1 AND a.id=ANY($2::text[])
          ), bounds AS (
            SELECT MIN(source_position)::int AS min_position, MAX(source_position)::int AS max_position
            FROM selected_positions
          )
          SELECT
            a.id,
            a.external_id,
            a.name,
            a.description,
            jsonb_array_length(a.photos)::int AS photo_count,
            a.photos->>0 AS preview_photo,
            jsonb_array_length(a.media)::int AS media_count,
            COALESCE(a.photos->>0, a.media->0->>'preview_url') AS preview_media,
            EXISTS (
              SELECT 1 FROM jsonb_array_elements(a.media) item
              WHERE item->>'type'='video'
            ) AS has_video,
            a.source_order AS source_position,
            NULL::int AS source_page,
            NULL::int AS page_position,
            CASE
              WHEN a.id=ANY($2::text[]) THEN 'SELECTED'
              WHEN da.draft_id IS NOT NULL THEN 'OTHER_PRODUCT'
              ELSE 'UNASSIGNED_CONTEXT'
            END AS sequence_label,
            CASE WHEN a.id=ANY($2::text[]) THEN da.role ELSE NULL END AS role
          FROM scraping_v2_albums a
          LEFT JOIN scraping_v2_draft_albums da ON da.album_id=a.id
          CROSS JOIN bounds b
          WHERE a.run_id=$1 AND (
            a.id=ANY($2::text[])
            OR EXISTS (
              SELECT 1 FROM selected_positions sp
              WHERE ABS(a.source_order - sp.source_position) <= $3
            )
            OR (
              b.max_position - b.min_position <= $4
              AND a.source_order BETWEEN b.min_position AND b.max_position
            )
          )
          ORDER BY a.source_order
        `, [draft.run_id, albumIds, TRAINING_CONTEXT_RADIUS, MAX_CONTIGUOUS_CONTEXT_SPAN])

    const positionByAlbum = new Map(
      contextResult.rows.map((album) => [String(album.id), Number(album.source_position)]),
    )
    const orderedAlbums = albumsResult.rows
      .map((album) => ({
        ...album,
        source_position: positionByAlbum.get(String(album.id)) ?? Number(album.source_order),
      }))
      .sort((left, right) => left.source_position - right.source_position)
    const gaps = orderedAlbums.slice(1).map((album, index) => {
      const previous = orderedAlbums[index]
      return {
        from_external_id: previous.external_id,
        to_external_id: album.external_id,
        distance: album.source_position - previous.source_position,
        intervening_albums: Math.max(0, album.source_position - previous.source_position - 1),
      }
    })
    const mediaPlan = buildExportsV2MediaPlan(
      orderedAlbums.map((album) => ({
        id: String(album.id),
        source_order: Number(album.source_position),
        draft_sort_order: Number(album.draft_sort_order),
        photos: Array.isArray(album.photos) ? album.photos : [],
        media: Array.isArray(album.media) ? album.media : [],
        role: album.role,
        use_media: Boolean(album.use_media),
      })),
      Number(draft.max_on_model_media ?? 5),
    )

    await scrapingQuery(`
      INSERT INTO scraping_v2_training_examples (id, supplier_id, run_id, draft_id, example)
      VALUES ($1,$2,$3,$4,$5::jsonb)
    `, [crypto.randomUUID(), draft.supplier_id, draft.run_id, draft.id, JSON.stringify({
      version: 3,
      draft_name: draft.name,
      max_on_model_media: Number(draft.max_on_model_media ?? 5),
      sequence: {
        direction: 'PROVIDER_FEED_ORDER',
        source: sourcePass ? 'SCRAPE_PASS' : 'LEGACY_SOURCE_ORDER',
        pass_id: sourcePass?.id || null,
        pass_started_at: sourcePass?.started_at || null,
        pass_completed_at: sourcePass?.completed_at || null,
        selected_coverage: sourcePass?.selected_coverage || orderedAlbums.length,
        context_radius: TRAINING_CONTEXT_RADIUS,
        gaps,
      },
      albums: orderedAlbums,
      context_albums: contextResult.rows,
      media_plan: mediaPlan,
    })])
    await scrapingQuery("UPDATE scraping_v2_product_drafts SET status='GROUPED', updated_at=NOW() WHERE id=$1", [draftId])

    revalidatePath(`/admin/exports-v2/${draft.run_id}`)
    revalidatePath('/admin/exports-v2')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

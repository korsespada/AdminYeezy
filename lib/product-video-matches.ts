import { scrapingQuery } from '@/lib/db'
import type { MatchRow } from '@/lib/video-match-build'

export type VideoMatchStatus = 'pending' | 'approved' | 'applied' | 'rejected' | 'failed'

export interface VideoMatchRecord {
  id: number
  supplier_id: number
  source_batch_id: string
  source_product_id: number
  source_external_id: string
  source_position: number | null
  video_source_url: string
  video_poster_url: string | null
  crm_product_id: string
  crm_slug: string | null
  crm_name: string | null
  crm_category: string | null
  crm_status: string | null
  crm_photo_url: string | null
  rank: number
  candidates_total: number
  confidence: string
  score: number
  source_fields: Record<string, string | null>
  crm_fields: Record<string, string | null>
  differences: Array<{ field: string; catalog: string | null; album: string | null; verdict: string }>
  status: VideoMatchStatus
  s3_video_url: string | null
  s3_poster_url: string | null
  error: string | null
  decided_at: string | null
  applied_at: string | null
}

export interface VideoMatchCounts {
  total: number
  pending: number
  pendingAlternatives: number
  approved: number
  applied: number
  rejected: number
  failed: number
  exact: number
  strong: number
  probable: number
  singleCandidate: number
  withoutCandidates: number
  products: number
}

const SELECT_COLUMNS = `
  id, supplier_id, source_batch_id, source_product_id, source_external_id, source_position,
  video_source_url, video_poster_url, crm_product_id, crm_slug, crm_name, crm_category, crm_status,
  crm_photo_url, rank, candidates_total, confidence, score, source_fields, crm_fields, differences,
  status, s3_video_url, s3_poster_url, error, decided_at, applied_at
`

/**
 * Перезаписывает необработанные варианты пар, сохраняя уже принятые решения оператора.
 * Список просканированных товаров передаётся отдельно: у товара, который потерял все
 * варианты после пересборки, строк уже нет, но старые варианты удалить нужно.
 */
export async function saveMatchRows(batchId: string, supplierId: number, rows: MatchRow[], scannedProductIds: string[] = []) {
  const productIds = [...new Set([...rows.map((row) => row.crmProductId), ...scannedProductIds])]
  if (productIds.length > 0) {
    await scrapingQuery(
      `DELETE FROM product_video_matches
       WHERE source_batch_id = $1 AND status = 'pending' AND crm_product_id = ANY($2::uuid[])`,
      [batchId, productIds],
    )
  }
  if (rows.length === 0) return { inserted: 0, products: productIds.length }

  const chunkSize = 500
  let inserted = 0
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const values: any[] = []
    const placeholders = chunk.map((row, index) => {
      const base = index * 20
      values.push(
        supplierId, batchId, row.sourceProductId, row.sourceExternalId, row.sourcePosition,
        row.videoSourceUrl, row.videoPosterUrl, row.crmProductId, row.crmSlug, row.crmName,
        row.crmCategory, row.crmStatus, row.crmPhotoUrl, row.rank, row.candidatesTotal,
        row.confidence, row.score,
        JSON.stringify(row.sourceFields), JSON.stringify(row.crmFields), JSON.stringify(row.differences),
      )
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7},
        $${base + 8}::uuid, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13},
        $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}::jsonb, $${base + 19}::jsonb, $${base + 20}::jsonb)`
    })
    const result = await scrapingQuery(
      `INSERT INTO product_video_matches (
         supplier_id, source_batch_id, source_product_id, source_external_id, source_position,
         video_source_url, video_poster_url, crm_product_id, crm_slug, crm_name, crm_category,
         crm_status, crm_photo_url, rank, candidates_total, confidence, score,
         source_fields, crm_fields, differences
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (source_batch_id, source_product_id, crm_product_id) DO UPDATE SET
         rank = EXCLUDED.rank,
         candidates_total = EXCLUDED.candidates_total,
         confidence = EXCLUDED.confidence,
         score = EXCLUDED.score,
         source_fields = EXCLUDED.source_fields,
         crm_fields = EXCLUDED.crm_fields,
         differences = EXCLUDED.differences,
         crm_photo_url = EXCLUDED.crm_photo_url,
         updated_at = NOW()`,
      values,
    )
    inserted += result.rowCount || 0
  }
  return { inserted, products: productIds.length }
}

/** Фиксирует, что товар прошёл сборку, даже если вариантов не нашлось. */
export async function saveMatchScope(batchId: string, entries: Array<{
  productId: string
  slug: string | null
  name: string | null
  category: string | null
  status: string | null
  photoUrl: string | null
  candidates: number
  crmFields: Record<string, string | null>
}>) {
  if (entries.length === 0) return 0
  const values: any[] = []
  const placeholders = entries.map((entry, index) => {
    const base = index * 9
    values.push(
      batchId, entry.productId, entry.slug, entry.name, entry.category,
      entry.status, entry.photoUrl, entry.candidates, JSON.stringify(entry.crmFields),
    )
    return `($${base + 1}, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb)`
  })
  const result = await scrapingQuery(
    `INSERT INTO product_video_match_scope (
       source_batch_id, crm_product_id, crm_slug, crm_name, crm_category, crm_status, crm_photo_url, candidates, crm_fields
     ) VALUES ${placeholders.join(',')}
     ON CONFLICT (source_batch_id, crm_product_id) DO UPDATE SET
       crm_slug = EXCLUDED.crm_slug,
       crm_name = EXCLUDED.crm_name,
       crm_category = EXCLUDED.crm_category,
       crm_status = EXCLUDED.crm_status,
       crm_photo_url = EXCLUDED.crm_photo_url,
       candidates = EXCLUDED.candidates,
       crm_fields = EXCLUDED.crm_fields,
       updated_at = NOW()`,
    values,
  )
  return result.rowCount || 0
}

export async function videoMatchCounts(batchId: string): Promise<VideoMatchCounts> {
  const result = await scrapingQuery<{
    total: string; pending: string; pending_alternatives: string; approved: string; applied: string
    rejected: string; failed: string; exact: string; strong: string; probable: string
    single_candidate: string; products: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank = 1)::text AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank > 1)::text AS pending_alternatives,
       COUNT(*) FILTER (WHERE status = 'approved')::text AS approved,
       COUNT(*) FILTER (WHERE status = 'applied')::text AS applied,
       COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank = 1 AND confidence = 'exact')::text AS exact,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank = 1 AND confidence = 'strong')::text AS strong,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank = 1 AND confidence = 'probable')::text AS probable,
       COUNT(*) FILTER (WHERE status = 'pending' AND rank = 1 AND candidates_total = 1)::text AS single_candidate,
       COUNT(DISTINCT crm_product_id)::text AS products
     FROM product_video_matches WHERE source_batch_id = $1`,
    [batchId],
  )
  const row = result.rows[0]
  const number = (value?: string) => Number(value || 0)
  const coverage = await scrapingQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM product_video_match_scope
     WHERE source_batch_id = $1 AND candidates = 0`,
    [batchId],
  )
  return {
    total: number(row?.total),
    pending: number(row?.pending),
    pendingAlternatives: number(row?.pending_alternatives),
    approved: number(row?.approved),
    applied: number(row?.applied),
    rejected: number(row?.rejected),
    failed: number(row?.failed),
    exact: number(row?.exact),
    strong: number(row?.strong),
    probable: number(row?.probable),
    singleCandidate: number(row?.single_candidate),
    products: number(row?.products),
    withoutCandidates: number(coverage.rows[0]?.count),
  }
}

export interface ScopeRecord {
  crm_product_id: string
  crm_slug: string | null
  crm_name: string | null
  crm_category: string | null
  crm_status: string | null
  crm_photo_url: string | null
  candidates: number
  crm_fields: Record<string, string | null>
}

/** Товары, которые прошли сборку, но подходящих альбомов не нашли. */
export async function listScopeWithoutCandidates(batchId: string, limit = 50) {
  const result = await scrapingQuery<ScopeRecord>(
    `SELECT crm_product_id, crm_slug, crm_name, crm_category, crm_status, crm_photo_url, candidates, crm_fields
     FROM product_video_match_scope
     WHERE source_batch_id = $1 AND candidates = 0
     ORDER BY crm_category NULLS LAST, crm_name NULLS LAST
     LIMIT $2`,
    [batchId, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  )
  return result.rows
}

export interface VideoMatchListFilters {
  batchId: string
  status?: VideoMatchStatus | 'all'
  bands?: string[]
  onlyBest?: boolean
  onlySingleCandidate?: boolean
  search?: string
  category?: string
}

/** Условия отбора одинаковы для страницы списка и для счётчика всего найденного. */
function listConditions(options: VideoMatchListFilters) {
  const conditions = ['source_batch_id = $1']
  const values: any[] = [options.batchId]
  const status = options.status || 'pending'
  if (status !== 'all') {
    values.push(status)
    conditions.push(`status = $${values.length}`)
  }
  if (options.bands && options.bands.length > 0) {
    values.push(options.bands)
    conditions.push(`confidence = ANY($${values.length}::text[])`)
  }
  if (options.onlyBest !== false) conditions.push('rank = 1')
  if (options.onlySingleCandidate) conditions.push('candidates_total = 1')
  if (options.category) {
    values.push(options.category)
    conditions.push(`crm_category = $${values.length}`)
  }
  const search = String(options.search || '').trim()
  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(crm_name ILIKE $${values.length} OR crm_slug ILIKE $${values.length} OR source_external_id ILIKE $${values.length})`)
  }
  return { conditions, values }
}

export async function countVideoMatches(options: VideoMatchListFilters) {
  const { conditions, values } = listConditions(options)
  const result = await scrapingQuery<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM product_video_matches WHERE ${conditions.join(' AND ')}`,
    values,
  )
  return Number(result.rows[0]?.total || 0)
}

export async function listVideoMatches(options: VideoMatchListFilters & { limit?: number; offset?: number }) {
  const { conditions, values } = listConditions(options)
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const offset = Math.max(Number(options.offset) || 0, 0)
  values.push(limit, offset)

  const result = await scrapingQuery<VideoMatchRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_video_matches
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE confidence WHEN 'exact' THEN 0 WHEN 'strong' THEN 1 WHEN 'probable' THEN 2 ELSE 3 END,
       candidates_total ASC, score DESC, id ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  return result.rows
}

export async function listMatchAlternatives(batchId: string, productIds: string[]) {
  if (productIds.length === 0) return [] as VideoMatchRecord[]
  const result = await scrapingQuery<VideoMatchRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_video_matches
     WHERE source_batch_id = $1 AND crm_product_id = ANY($2::uuid[])
     ORDER BY crm_product_id, rank ASC`,
    [batchId, productIds],
  )
  return result.rows
}

export async function approveMatches(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'approved', error = NULL, decided_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('pending', 'rejected', 'failed')`,
    [ids],
  )
  // У товара должно остаться одно апрувнутое видео: остальные варианты снимаем.
  await scrapingQuery(
    `UPDATE product_video_matches AS sibling
     SET status = 'pending', updated_at = NOW()
     WHERE sibling.status = 'approved'
       AND sibling.id <> ALL($1::bigint[])
       AND sibling.crm_product_id IN (
         SELECT approved.crm_product_id FROM product_video_matches AS approved WHERE approved.id = ANY($1::bigint[])
       )`,
    [ids],
  )
  return result.rowCount || 0
}

export async function rejectMatches(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'rejected', decided_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('pending', 'approved', 'failed')`,
    [ids],
  )
  return result.rowCount || 0
}

export async function resetMatches(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'pending', error = NULL, decided_at = NULL, updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('approved', 'rejected', 'failed')`,
    [ids],
  )
  return result.rowCount || 0
}

/**
 * Массовый апрув: только первые варианты выбранных уровней уверенности.
 * Товары, у которых оператор уже выбрал видео вручную (или оно уже привязано),
 * пропускаются — иначе массовый апрув перебил бы ручной выбор первым вариантом.
 */
export async function approveMatchesByBand(batchId: string, bands: string[], onlySingleCandidate = false) {
  const result = await scrapingQuery(
    `UPDATE product_video_matches AS target
     SET status = 'approved', error = NULL, decided_at = NOW(), updated_at = NOW()
     WHERE target.source_batch_id = $1
       AND target.status = 'pending'
       AND target.rank = 1
       AND target.confidence = ANY($2::text[])
       ${onlySingleCandidate ? 'AND target.candidates_total = 1' : ''}
       AND NOT EXISTS (
         SELECT 1 FROM product_video_matches AS decided
         WHERE decided.source_batch_id = target.source_batch_id
           AND decided.crm_product_id = target.crm_product_id
           AND decided.id <> target.id
           AND decided.status IN ('approved', 'applied')
       )`,
    [batchId, bands],
  )
  return result.rowCount || 0
}

/** Возвращает в ожидание все апрувнутые варианты партии — откат массового апрува. */
export async function resetApprovedMatches(batchId: string) {
  const result = await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'pending', decided_at = NULL, updated_at = NOW()
     WHERE source_batch_id = $1 AND status = 'approved'`,
    [batchId],
  )
  return result.rowCount || 0
}

export async function selectApprovedForApply(batchId: string, limit: number) {
  const result = await scrapingQuery<VideoMatchRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_video_matches
     WHERE source_batch_id = $1 AND status = 'approved'
     ORDER BY candidates_total ASC, score DESC, id ASC
     LIMIT $2`,
    [batchId, Math.min(Math.max(Number(limit) || 1, 1), 20)],
  )
  return result.rows
}

export async function markMatchApplied(id: number, videoUrl: string, posterUrl: string | null) {
  await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'applied', s3_video_url = $2, s3_poster_url = $3, error = NULL,
         applied_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, videoUrl, posterUrl],
  )
}

export async function markMatchFailed(id: number, error: string) {
  await scrapingQuery(
    `UPDATE product_video_matches
     SET status = 'failed', error = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, String(error || 'неизвестная ошибка').slice(0, 1000)],
  )
}

export async function clearBatchMatches(batchId: string) {
  const result = await scrapingQuery(
    `DELETE FROM product_video_matches WHERE source_batch_id = $1 AND status IN ('pending', 'rejected', 'failed')`,
    [batchId],
  )
  return result.rowCount || 0
}

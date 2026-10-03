import { scrapingQuery } from '@/lib/db'

/**
 * Очередь обработки опубликованных карточек поставщика по правилам выгрузки.
 *
 * Раздел не трогает выгрузки и альбомы: источник — товары каталога Rails,
 * прочитанные через API (`supplier=<uuid>`), а здесь хранится снимок текущей
 * карточки, предложение и решение оператора. Снимок нужен, чтобы показывать
 * «сейчас / станет» и сохранять историю применения.
 */

export type CardUpdateStatus = 'pending' | 'approved' | 'applied' | 'rejected' | 'failed'
export type CardAiStatus = 'pending' | 'ready' | 'failed'
export type CardKind = 'bag' | 'shoe'

export interface CardMediaItem {
  original_url: string
  thumb_url?: string
  preview_url?: string
  og_image_url?: string
  alt_text?: string
  sort_order?: number
  processing_status?: string
}

export interface CardUpdateRecord {
  id: number
  supplier_id: string
  crm_product_id: string
  crm_slug: string | null
  category: string | null
  category_slug: string | null
  kind: CardKind
  status: CardUpdateStatus
  current_name: string | null
  current_slug: string | null
  current_description: string | null
  current_attributes: Record<string, unknown>
  current_media: CardMediaItem[]
  proposed_name: string | null
  proposed_slug: string | null
  proposed_description: string | null
  proposed_attributes: Record<string, unknown>
  proposed_photo_alts: string[]
  attribute_patch: Record<string, unknown>
  warnings: string[]
  model_name: string | null
  size_token: string | null
  ai_status: CardAiStatus
  ai_model: string | null
  ai_error: string | null
  error: string | null
  decided_at: string | null
  applied_at: string | null
  created_at: string
  updated_at: string
}

export interface CardProposalInput {
  crmProductId: string
  crmSlug: string | null
  category: string | null
  categorySlug: string | null
  kind: CardKind
  currentName: string | null
  currentSlug: string | null
  currentDescription: string | null
  currentAttributes: Record<string, unknown>
  currentMedia: CardMediaItem[]
  proposedName: string
  proposedSlug: string
  proposedDescription: string
  proposedAttributes: Record<string, unknown>
  proposedPhotoAlts: string[]
  attributePatch: Record<string, unknown>
  warnings: string[]
  modelName: string | null
  sizeToken: string | null
}

const SELECT_COLUMNS = `
  id, supplier_id, crm_product_id, crm_slug, category, category_slug, kind, status,
  current_name, current_slug, current_description, current_attributes, current_media,
  proposed_name, proposed_slug, proposed_description, proposed_attributes, proposed_photo_alts,
  attribute_patch, warnings, model_name, size_token, ai_status, ai_model, ai_error, error,
  decided_at, applied_at, created_at, updated_at
`

/**
 * Записывает предложения по карточкам. Решения оператора не перетираются:
 * обновляются только строки в статусе `pending`, поэтому повторный скан
 * безопасен и не сбрасывает уже апрувнутые товары.
 */
export async function saveCardProposals(supplierId: string, rows: CardProposalInput[]) {
  if (rows.length === 0) return 0
  const chunkSize = 200
  let saved = 0
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const values: any[] = []
    const placeholders = chunk.map((row, index) => {
      const base = index * 20
      values.push(
        supplierId, row.crmProductId, row.crmSlug, row.category, row.categorySlug, row.kind,
        row.currentName, row.currentSlug, row.currentDescription,
        JSON.stringify(row.currentAttributes), JSON.stringify(row.currentMedia),
        row.proposedName, row.proposedSlug, row.proposedDescription,
        JSON.stringify(row.proposedAttributes), JSON.stringify(row.proposedPhotoAlts),
        JSON.stringify(row.attributePatch), JSON.stringify(row.warnings),
        row.modelName, row.sizeToken,
      )
      return `($${base + 1}, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6},
        $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::jsonb, $${base + 11}::jsonb,
        $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}::jsonb, $${base + 16}::jsonb,
        $${base + 17}::jsonb, $${base + 18}::jsonb, $${base + 19}, $${base + 20})`
    })
    const result = await scrapingQuery(
      `INSERT INTO product_card_updates (
         supplier_id, crm_product_id, crm_slug, category, category_slug, kind,
         current_name, current_slug, current_description, current_attributes, current_media,
         proposed_name, proposed_slug, proposed_description, proposed_attributes, proposed_photo_alts,
         attribute_patch, warnings, model_name, size_token
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (supplier_id, crm_product_id) DO UPDATE SET
         crm_slug = EXCLUDED.crm_slug,
         category = EXCLUDED.category,
         category_slug = EXCLUDED.category_slug,
         kind = EXCLUDED.kind,
         current_name = EXCLUDED.current_name,
         current_slug = EXCLUDED.current_slug,
         current_description = EXCLUDED.current_description,
         current_attributes = EXCLUDED.current_attributes,
         current_media = EXCLUDED.current_media,
         proposed_name = EXCLUDED.proposed_name,
         proposed_slug = EXCLUDED.proposed_slug,
         -- Готовый ИИ-текст повторный скан не перетирает черновиком: обновляются
         -- только снимок карточки, название, адрес и характеристики.
         proposed_description = CASE
           WHEN product_card_updates.ai_status = 'ready' THEN product_card_updates.proposed_description
           ELSE EXCLUDED.proposed_description
         END,
         proposed_attributes = EXCLUDED.proposed_attributes,
         proposed_photo_alts = CASE
           WHEN product_card_updates.ai_status = 'ready' THEN product_card_updates.proposed_photo_alts
           ELSE EXCLUDED.proposed_photo_alts
         END,
         attribute_patch = EXCLUDED.attribute_patch,
         warnings = EXCLUDED.warnings,
         model_name = EXCLUDED.model_name,
         size_token = EXCLUDED.size_token,
         updated_at = NOW()
       WHERE product_card_updates.status = 'pending'`,
      values,
    )
    saved += result.rowCount || 0
  }
  return saved
}

export interface CardUpdateFilters {
  supplierId: string
  status?: CardUpdateStatus | 'all'
  kind?: CardKind | 'all'
  search?: string
  aiStatus?: CardAiStatus | 'all'
}

function listConditions(options: CardUpdateFilters) {
  const conditions = ['supplier_id = $1']
  const values: any[] = [options.supplierId]
  if (options.status && options.status !== 'all') {
    values.push(options.status)
    conditions.push(`status = $${values.length}`)
  }
  if (options.kind && options.kind !== 'all') {
    values.push(options.kind)
    conditions.push(`kind = $${values.length}`)
  }
  if (options.aiStatus && options.aiStatus !== 'all') {
    values.push(options.aiStatus)
    conditions.push(`ai_status = $${values.length}`)
  }
  const search = String(options.search || '').trim()
  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(current_name ILIKE $${values.length} OR current_slug ILIKE $${values.length} OR proposed_name ILIKE $${values.length})`)
  }
  return { conditions, values }
}

export async function countCardUpdates(options: CardUpdateFilters) {
  const { conditions, values } = listConditions(options)
  const result = await scrapingQuery<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM product_card_updates WHERE ${conditions.join(' AND ')}`,
    values,
  )
  return Number(result.rows[0]?.total || 0)
}

export async function listCardUpdates(options: CardUpdateFilters & { limit?: number; offset?: number }) {
  const { conditions, values } = listConditions(options)
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const offset = Math.max(Number(options.offset) || 0, 0)
  values.push(limit, offset)
  const result = await scrapingQuery<CardUpdateRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_card_updates
     WHERE ${conditions.join(' AND ')}
     ORDER BY kind ASC, category NULLS LAST, current_name NULLS LAST, id ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  return result.rows
}

export interface CardUpdateCounts {
  total: number
  pending: number
  approved: number
  applied: number
  rejected: number
  failed: number
  bags: number
  shoes: number
  aiReady: number
  aiPending: number
  aiFailed: number
  withWarnings: number
}

export async function cardUpdateCounts(supplierId: string): Promise<CardUpdateCounts> {
  const result = await scrapingQuery<Record<string, string>>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')::text AS approved,
       COUNT(*) FILTER (WHERE status = 'applied')::text AS applied,
       COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
       COUNT(*) FILTER (WHERE kind = 'bag')::text AS bags,
       COUNT(*) FILTER (WHERE kind = 'shoe')::text AS shoes,
       COUNT(*) FILTER (WHERE ai_status = 'ready')::text AS ai_ready,
       COUNT(*) FILTER (WHERE ai_status = 'pending')::text AS ai_pending,
       COUNT(*) FILTER (WHERE ai_status = 'failed')::text AS ai_failed,
       COUNT(*) FILTER (WHERE jsonb_array_length(warnings) > 0)::text AS with_warnings
     FROM product_card_updates WHERE supplier_id = $1`,
    [supplierId],
  )
  const row = result.rows[0] || {}
  const number = (value?: string) => Number(value || 0)
  return {
    total: number(row.total),
    pending: number(row.pending),
    approved: number(row.approved),
    applied: number(row.applied),
    rejected: number(row.rejected),
    failed: number(row.failed),
    bags: number(row.bags),
    shoes: number(row.shoes),
    aiReady: number(row.ai_ready),
    aiPending: number(row.ai_pending),
    aiFailed: number(row.ai_failed),
    withWarnings: number(row.with_warnings),
  }
}

export async function getCardUpdate(id: number) {
  const result = await scrapingQuery<CardUpdateRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_card_updates WHERE id = $1`,
    [id],
  )
  return result.rows[0] || null
}

export async function listCardUpdatesByIds(ids: number[]) {
  if (ids.length === 0) return [] as CardUpdateRecord[]
  const result = await scrapingQuery<CardUpdateRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_card_updates WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids],
  )
  return result.rows
}

export async function approveCardUpdates(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'approved', error = NULL, decided_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('pending', 'rejected', 'failed')`,
    [ids],
  )
  return result.rowCount || 0
}

export async function rejectCardUpdates(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'rejected', decided_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('pending', 'approved', 'failed')`,
    [ids],
  )
  return result.rowCount || 0
}

export async function resetCardUpdates(ids: number[]) {
  if (ids.length === 0) return 0
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'pending', error = NULL, decided_at = NULL, updated_at = NOW()
     WHERE id = ANY($1::bigint[]) AND status IN ('approved', 'rejected', 'failed')`,
    [ids],
  )
  return result.rowCount || 0
}

/** Массовый апрув: только строки без спорных предупреждений и с готовым ИИ-текстом. */
export async function approveCardUpdatesSafe(supplierId: string, options: { kind?: CardKind | 'all' } = {}) {
  const conditions = ["supplier_id = $1", "status = 'pending'", 'ai_status = \'ready\'', 'jsonb_array_length(warnings) = 0']
  const values: any[] = [supplierId]
  if (options.kind && options.kind !== 'all') {
    values.push(options.kind)
    conditions.push(`kind = $${values.length}`)
  }
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'approved', error = NULL, decided_at = NOW(), updated_at = NOW()
     WHERE ${conditions.join(' AND ')}`,
    values,
  )
  return result.rowCount || 0
}

/** Строки, которым ещё нужен ИИ-текст: решение оператора при этом не меняется. */
export async function selectPendingCardUpdatesForAi(supplierId: string, limit: number) {
  const result = await scrapingQuery<CardUpdateRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_card_updates
     WHERE supplier_id = $1 AND status = 'pending' AND ai_status <> 'ready'
     ORDER BY kind ASC, id ASC
     LIMIT $2`,
    [supplierId, Math.min(Math.max(Number(limit) || 1, 1), 20)],
  )
  return result.rows
}

/**
 * Убирает абзац комплектации у карточек, которым он не подходит (обувь,
 * чемоданы). Текст описания остаётся ИИ-текстом, меняется только хвост с
 * упаковкой, поэтому повторный ИИ-проход не нужен.
 */
export async function stripPackagingFromCards(supplierId: string) {
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET proposed_description = rtrim(split_part(proposed_description, E'\\n\\nКомплектация:', 1)),
         updated_at = NOW()
     WHERE supplier_id = $1
       AND proposed_description LIKE '%Комплектация:%'
       AND (kind = 'shoe' OR category ILIKE '%чемодан%' OR category ILIKE '%luggage%')`,
    [supplierId],
  )
  return result.rowCount || 0
}

/** Возвращает упавшие при применении строки в работу: одна повторная попытка на прогон. */
export async function requeueFailedCardApply(supplierId: string) {
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'approved', error = NULL, updated_at = NOW()
     WHERE supplier_id = $1 AND status = 'failed'`,
    [supplierId],
  )
  return result.rowCount || 0
}

/** Возвращает упавшие строки ИИ в работу: разовые сбои провайдера проходят со второй попытки. */
export async function requeueFailedCardAi(supplierId: string) {
  const result = await scrapingQuery(
    `UPDATE product_card_updates
     SET ai_status = 'pending', ai_error = NULL, updated_at = NOW()
     WHERE supplier_id = $1 AND status = 'pending' AND ai_status = 'failed'`,
    [supplierId],
  )
  return result.rowCount || 0
}

export async function selectApprovedCardUpdates(supplierId: string, limit: number) {
  const result = await scrapingQuery<CardUpdateRecord>(
    `SELECT ${SELECT_COLUMNS} FROM product_card_updates
     WHERE supplier_id = $1 AND status = 'approved'
     ORDER BY kind ASC, id ASC
     LIMIT $2`,
    [supplierId, Math.min(Math.max(Number(limit) || 1, 1), 50)],
  )
  return result.rows
}

export async function markCardUpdateApplied(id: number, appliedSlug: string | null) {
  await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'applied', error = NULL, proposed_slug = COALESCE($2, proposed_slug),
         applied_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, appliedSlug],
  )
}

export async function markCardUpdateFailed(id: number, error: string) {
  await scrapingQuery(
    `UPDATE product_card_updates
     SET status = 'failed', error = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, String(error || 'неизвестная ошибка').slice(0, 1000)],
  )
}

/** Записывает результат ИИ: полное описание, альты и уточнённые характеристики. */
export async function saveCardUpdateAi(id: number, input: {
  description: string
  photoAlts: string[]
  model?: string | null
  attributes?: Record<string, unknown>
}) {
  await scrapingQuery(
    `UPDATE product_card_updates
     SET proposed_description = $2,
         proposed_photo_alts = $3::jsonb,
         proposed_attributes = COALESCE($5::jsonb, proposed_attributes),
         ai_status = 'ready', ai_model = $4, ai_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      input.description,
      JSON.stringify(input.photoAlts || []),
      input.model || null,
      input.attributes ? JSON.stringify(input.attributes) : null,
    ],
  )
}

export async function markCardUpdateAiFailed(id: number, error: string, model?: string | null) {
  await scrapingQuery(
    `UPDATE product_card_updates
     SET ai_status = 'failed', ai_error = $2, ai_model = COALESCE($3, ai_model), updated_at = NOW()
     WHERE id = $1`,
    [id, String(error || 'ошибка ИИ').slice(0, 1000), model || null],
  )
}

/** Убирает несогласованные строки поставщика: применяемые и апрувнутые остаются. */
export async function clearPendingCardUpdates(supplierId: string) {
  const result = await scrapingQuery(
    `DELETE FROM product_card_updates WHERE supplier_id = $1 AND status IN ('pending', 'rejected')`,
    [supplierId],
  )
  return result.rowCount || 0
}

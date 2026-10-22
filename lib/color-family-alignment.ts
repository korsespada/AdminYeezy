import { getScrapingClient, scrapingQuery } from '@/lib/db'

export type ColorFamilyIssue = {
  field: string
  message: string
  productIds: number[]
  family?: string
}

type ColorFamilyAlignmentModule = {
  FAMILY_ERROR_PREFIX: string
  alignColorFamily: (members: any[]) => {
    updates: Array<{ id: number, fields: Record<string, unknown>, attributes?: Record<string, unknown> }>
    issues: ColorFamilyIssue[]
  }
  colorFamilyIssues: (members: any[], options?: { sizing?: boolean, colors?: boolean }) => ColorFamilyIssue[]
  batchColorFamilyIssues: (products: any[], options?: { sizing?: boolean, colors?: boolean }) => ColorFamilyIssue[]
  familyLabel: (members: any[]) => string
}

export type ColorFamilyConflict = {
  familyKey: string
  family: string
  message: string
  products: Array<{ id: number, name: string }>
}

export function colorFamilyAlignment() {
  // Общий модуль нужен и публикации (scripts/batch-workflow.js), поэтому он на CommonJS.
  return require('../scripts/lib/color-family-alignment') as ColorFamilyAlignmentModule
}

const FAMILY_COLUMNS = `id,external_id,source_position,brand,category,subcategory,gender,price,price_source,
  attributes,variant_group_key,variant_group_name,ai_processed,ai_error`

/**
 * Выравнивает цветовые семьи партии, в которые входит хотя бы один из товаров:
 * общие поля и размерная сетка по якорю, конфликты — в ai_error каждого затронутого цвета.
 * Семья с ещё не обработанными ИИ товарами не трогается.
 */
export async function alignBatchColorFamilies(batchId: string, productIds: number[]) {
  const { FAMILY_ERROR_PREFIX, alignColorFamily, familyLabel } = colorFamilyAlignment()
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))]
  const summary = { families: 0, updated: 0, conflicts: 0 }
  if (ids.length === 0) return summary
  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      SELECT ${FAMILY_COLUMNS}
      FROM products
      WHERE batch_id=$1 AND variant_group_key IN (
        SELECT variant_group_key FROM products
        WHERE batch_id=$1 AND id=ANY($2::int[]) AND NULLIF(variant_group_key,'') IS NOT NULL
      )
      ORDER BY id
      FOR UPDATE
    `, [batchId, ids])
    const families = new Map<string, any[]>()
    for (const row of result.rows) {
      families.set(row.variant_group_key, [...(families.get(row.variant_group_key) || []), row])
    }
    for (const members of families.values()) {
      if (members.length < 2 || members.some((member) => member.ai_processed !== true)) continue
      summary.families += 1
      const { updates, issues } = alignColorFamily(members)
      const changes = new Map(updates.map((update) => [Number(update.id), update]))
      const label = familyLabel(members)
      for (const member of members) {
        const update = changes.get(Number(member.id))
        const memberIssues = issues.filter((entry) => entry.productIds.map(Number).includes(Number(member.id)))
        const ownError = !member.ai_error || String(member.ai_error).startsWith(FAMILY_ERROR_PREFIX)
        const aiError = !ownError
          ? member.ai_error
          : memberIssues.length > 0
            ? `${FAMILY_ERROR_PREFIX}«${label}»: ${memberIssues.map((entry) => entry.message).join('; ')}`.slice(0, 4000)
            : null
        if (!update && aiError === (member.ai_error || null)) continue
        const next = { ...member, ...(update?.fields || {}) }
        await client.query(`
          UPDATE products SET brand=$2,category=$3,subcategory=$4,gender=$5,price=$6,price_source=$7,
            attributes=$8::jsonb,ai_error=$9,updated_at=NOW()
          WHERE id=$1
        `, [
          member.id, next.brand, next.category, next.subcategory || null, next.gender || null,
          Number(next.price || 0), next.price_source || 'legacy',
          JSON.stringify(update?.attributes || member.attributes || {}), aiError,
        ])
        if (update) summary.updated += 1
      }
      if (issues.length > 0) summary.conflicts += 1
    }
    await client.query('COMMIT')
    return summary
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Те же проверки, что выполнит публикация, по семьям, где все товары уже
 * обработаны ИИ. У сумок `sizes` не сравнивается: публикация его удаляет.
 */
export async function batchColorFamilyConflicts(batchId: string): Promise<ColorFamilyConflict[]> {
  const { batchColorFamilyIssues } = colorFamilyAlignment()
  const result = await scrapingQuery(`
    SELECT p.id,p.name,p.external_id,p.source_position,p.brand,p.category,p.subcategory,p.gender,p.price,
      p.price_source,p.attributes,p.variant_group_key,p.variant_group_name,p.ai_processed,
      LOWER(TRIM(COALESCE(m.name,''))) = 'сумки' AS is_bag
    FROM products p
    LEFT JOIN LATERAL (
      SELECT name FROM catalog_id_mappings
      WHERE entity_type='category' AND p.category IN (legacy_id, canonical_id)
      LIMIT 1
    ) m ON true
    WHERE p.batch_id=$1 AND NULLIF(p.variant_group_key,'') IS NOT NULL
    ORDER BY p.id
  `, [batchId])
  const unprocessed = new Set(result.rows.filter((row) => row.ai_processed !== true).map((row) => row.variant_group_key))
  const products = result.rows
    .filter((row) => !unprocessed.has(row.variant_group_key))
    .map((row) => {
      if (!row.is_bag || !row.attributes?.sizes) return row
      const attributes = { ...row.attributes }
      delete attributes.sizes
      return { ...row, attributes }
    })
  const byId = new Map(products.map((row) => [Number(row.id), row]))
  return batchColorFamilyIssues(products).map((entry) => {
    const members = entry.productIds.map(Number).map((id) => byId.get(id)).filter(Boolean)
    return {
      familyKey: String(members[0]?.variant_group_key || ''),
      family: entry.family || '',
      message: entry.message,
      products: members.map((row) => ({ id: Number(row.id), name: String(row.name || row.external_id || row.id) })),
    }
  })
}

/** Товары AI-запуска, по которым нужно выровнять семьи после его завершения. */
export async function alignColorFamiliesAfterRun(runId: string, batchId: string) {
  const items = await scrapingQuery(
    "SELECT product_id FROM batch_ai_items WHERE run_id=$1 AND status='completed' AND product_id IS NOT NULL",
    [runId],
  )
  const summary = await alignBatchColorFamilies(batchId, items.rows.map((row) => Number(row.product_id)))
  if (summary.families > 0) {
    console.info('[color-family-alignment]', JSON.stringify({ runId, batchId, ...summary }))
  }
  return summary
}

import crypto from 'crypto'
import { canonicalBatchSuggestionKey } from '@/lib/batch-ai'

type QueryClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

const SUBCATEGORY_TOKEN_ALIASES: Record<string, string> = {
  сумки: 'сумка',
  сумок: 'сумка',
  ручками: 'ручка',
  ручкой: 'ручка',
  ручки: 'ручка',
  верхней: '',
  верхняя: '',
  верхние: '',
}

export function subcategoryFamilyKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token && !['с', 'со'].includes(token))
    .map((token) => SUBCATEGORY_TOKEN_ALIASES[token] ?? token)
    .filter(Boolean)
    .sort()
    .join('_')
}

export function sameSubcategoryFamily(left: unknown, right: unknown) {
  const leftTokens = subcategoryFamilyKey(left).split('_').filter(Boolean)
  const rightTokens = subcategoryFamilyKey(right).split('_').filter(Boolean)
  if (!leftTokens.length || !rightTokens.length) return false
  if (leftTokens.join('_') === rightTokens.join('_')) return true
  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)
  const shared = leftTokens.filter((token) => rightSet.has(token)).length
  const shorter = Math.min(leftSet.size, rightSet.size)
  return shared >= 2 && shared === shorter
}

function suggestionsFromOutput(normalized: any) {
  const suggestions = [...(normalized.suggestions || [])]
  if (normalized.subcategorySuggestion?.name) {
    suggestions.push({ ...normalized.subcategorySuggestion, kind: 'subcategory', code: normalized.subcategorySuggestion.name })
  }
  if (normalized.colorFamily?.group_signature && normalized.colorFamily.confidence >= 0.75) {
    suggestions.push({ ...normalized.colorFamily, kind: 'color_family', code: normalized.colorFamily.group_signature })
  }
  return suggestions
}

async function catalogSubcategories(client: QueryClient, parentId?: string) {
  const result = await client.query(`
    SELECT canonical_id,name,canonical_parent_id
    FROM catalog_id_mappings
    WHERE entity_type='subcategory'
      AND ($1='' OR canonical_parent_id=$1)
  `, [parentId || ''])
  return result.rows
}

export async function saveBatchAiSuggestions(
  client: QueryClient,
  runId: string,
  productId: number,
  normalized: any,
) {
  const run = await client.query('SELECT batch_id FROM batch_ai_runs WHERE id=$1', [runId])
  const batchId = String(run.rows[0]?.batch_id || '')
  if (batchId) await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])

  for (const suggestion of suggestionsFromOutput(normalized)) {
    const kind = suggestion.kind || 'attribute'
    let key = canonicalBatchSuggestionKey(suggestion.code || suggestion.name, kind)
    if (!key) continue

    if (kind === 'subcategory') {
      const familyKey = subcategoryFamilyKey(suggestion.name || suggestion.code)
      if (!familyKey) continue
      key = familyKey
      const parentId = String(suggestion.parent_category_id || '')
      const mappings = await catalogSubcategories(client, parentId)
      const existing = mappings.find((row) => sameSubcategoryFamily(row.name, suggestion.name || suggestion.code))
      if (existing) {
        await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=$2', [String(existing.canonical_id), productId])
        continue
      }

      const pending = await client.query(`
        SELECT s.id,s.payload FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id
        WHERE r.batch_id=$1 AND s.kind='subcategory' AND s.status='pending'
        ORDER BY s.created_at
      `, [batchId])
      const sameFamily = pending.rows.find((row) => {
        const payload = row.payload || {}
        return sameSubcategoryFamily(payload.name || payload.code, suggestion.name || suggestion.code)
          && (!parentId || !payload.parent_category_id || String(payload.parent_category_id) === parentId)
      })
      if (sameFamily) {
        await client.query(`
          UPDATE batch_ai_suggestions SET
            affected_product_ids=(
              SELECT jsonb_agg(DISTINCT value)
              FROM jsonb_array_elements(affected_product_ids || $2::jsonb)
            )
          WHERE id=$1
        `, [sameFamily.id, JSON.stringify([productId])])
        continue
      }
    }

    await client.query(`
      INSERT INTO batch_ai_suggestions(id,run_id,kind,canonical_key,payload,affected_product_ids)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
      ON CONFLICT(run_id,kind,canonical_key) DO UPDATE SET
        payload=EXCLUDED.payload,
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(batch_ai_suggestions.affected_product_ids || EXCLUDED.affected_product_ids)
        )
    `, [crypto.randomUUID(), runId, kind, key, JSON.stringify(suggestion), JSON.stringify([productId])])
  }
}

export async function reconcileBatchSubcategorySuggestions(client: QueryClient, batchId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const result = await client.query(`
    SELECT s.* FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    WHERE r.batch_id=$1 AND s.kind='subcategory' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  const firstByFamily = new Map<string, any>()

  for (const row of result.rows) {
    const payload = row.payload || {}
    const familyKey = subcategoryFamilyKey(payload.name || payload.code || row.canonical_key)
    const parentId = String(payload.parent_category_id || '')
    const mappings = await catalogSubcategories(client, parentId)
    const existing = mappings.find((mapping) => sameSubcategoryFamily(mapping.name, payload.name || payload.code || row.canonical_key))
    if (existing) {
      await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=ANY($2::int[])', [
        String(existing.canonical_id),
        row.affected_product_ids.map(Number),
      ])
      await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }

    const familyEntry = [...firstByFamily.entries()].find(([storedKey]) => {
      const [storedParent, ...storedFamily] = storedKey.split(':')
      return storedParent === parentId && sameSubcategoryFamily(storedFamily.join(':'), familyKey)
    })
    const duplicate = familyEntry?.[1]
    if (!duplicate) {
      firstByFamily.set(`${parentId}:${familyKey}`, row)
      continue
    }
    await client.query(`
      UPDATE batch_ai_suggestions SET
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(affected_product_ids || $2::jsonb)
        )
      WHERE id=$1
    `, [duplicate.id, JSON.stringify(row.affected_product_ids || [])])
    await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
  }
}

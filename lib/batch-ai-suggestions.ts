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

function normalizedTokens(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => String(item || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(Boolean)
}

const COLOR_TOKEN_ALIASES: Record<string, string> = {
  white: 'белый',
  black: 'черный',
  beige: 'бежевый',
  pink: 'розовый',
  blue: 'синий',
  red: 'красный',
  green: 'зеленый',
  grey: 'серый',
  gray: 'серый',
  brown: 'коричневый',
  yellow: 'желтый',
  orange: 'оранжевый',
  purple: 'фиолетовый',
  gold: 'золотой',
  silver: 'серебристый',
}

function normalizedColorTokens(value: unknown) {
  return normalizedTokens(value).map((token) => COLOR_TOKEN_ALIASES[token] || token)
}

export function canonicalColorFamilyKey(suggestion: any) {
  const signatureTokens = normalizedTokens(suggestion?.group_signature || suggestion?.code)
  const colorTokens = new Set([
    ...normalizedTokens(suggestion?.color),
    ...normalizedColorTokens(suggestion?.color),
  ])
  const withoutColor = signatureTokens.filter((token) => !colorTokens.has(token) && !colorTokens.has(COLOR_TOKEN_ALIASES[token] || token))
  return [...new Set(withoutColor)].join('_')
}

function stableField(value: unknown) {
  return [...new Set(normalizedTokens(value))].sort().join('_')
}

export function canonicalProductColorFamilyKey(product: any, suggestion: any = {}) {
  const attributes = product?.attributes || {}
  const colorTokens = new Set([
    ...normalizedColorTokens(attributes.colors),
    ...normalizedColorTokens(suggestion?.color),
  ])
  const name = normalizedTokens(product?.name)
    .filter((token) => !colorTokens.has(COLOR_TOKEN_ALIASES[token] || token))
    .join('_')
  const dimensions = attributes.dimensions
    || ([attributes.bag_width_cm, attributes.bag_height_cm].filter(Boolean).join('x'))
    || suggestion?.bag_size
  return [
    stableField(product?.brand),
    stableField(product?.category),
    stableField(product?.subcategory),
    name,
    stableField(attributes.model_name || suggestion?.model_name),
    stableField(dimensions),
    stableField(attributes.materials || suggestion?.materials),
    stableField(attributes.hardware_color || suggestion?.hardware),
  ].join('|')
}

function observedColors(payload: any, nextColor?: unknown) {
  return [...new Set([
    ...(Array.isArray(payload?.observed_colors) ? payload.observed_colors : []),
    payload?.color,
    nextColor,
  ].flatMap(normalizedColorTokens))].sort()
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
  const run = await client.query(`
    SELECT r.batch_id,b.supplier_id
    FROM batch_ai_runs r JOIN scraping_batches b ON b.id=r.batch_id
    WHERE r.id=$1
  `, [runId])
  const batchId = String(run.rows[0]?.batch_id || '')
  const supplierId = Number(run.rows[0]?.supplier_id || 0)
  if (batchId) await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const rejected = supplierId ? await client.query(`
    SELECT s.kind,s.canonical_key,s.payload FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    JOIN scraping_batches b ON b.id=r.batch_id
    WHERE b.supplier_id=$1 AND s.status='rejected'
  `, [supplierId]) : { rows: [] }

  for (const suggestion of suggestionsFromOutput(normalized)) {
    const kind = suggestion.kind || 'attribute'
    let key = canonicalBatchSuggestionKey(suggestion.code || suggestion.name, kind)
    if (!key) continue

    if (kind === 'subcategory') {
      const familyKey = subcategoryFamilyKey(suggestion.name || suggestion.code)
      if (!familyKey) continue
      if (rejected.rows.some((row) => (
        row.kind === 'subcategory'
        && sameSubcategoryFamily(row.payload?.name || row.payload?.code || row.canonical_key, suggestion.name || suggestion.code)
      ))) continue
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

    if (kind === 'color_family') {
      const identityKey = canonicalProductColorFamilyKey(normalized.product, suggestion)
      if (!identityKey) continue
      suggestion.product_identity_key = identityKey
      key = crypto.createHash('sha256').update(identityKey).digest('hex')
      if (rejected.rows.some((row) => (
        row.kind === 'color_family'
        && row.payload?.product_identity_key === identityKey
      ))) continue
      const pending = await client.query(`
        SELECT s.id,s.payload,p.name,p.brand,p.category,p.subcategory,p.attributes
        FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id
        LEFT JOIN products p ON p.id=(s.affected_product_ids->>0)::int
        WHERE r.batch_id=$1 AND s.kind='color_family' AND s.status='pending'
        ORDER BY s.created_at
      `, [batchId])
      const sameFamily = pending.rows.find((row) => (
        (row.payload?.product_identity_key || canonicalProductColorFamilyKey(row, row.payload)) === identityKey
      ))
      if (sameFamily) {
        const payload = {
          ...sameFamily.payload,
          observed_colors: observedColors(sameFamily.payload, suggestion.color),
        }
        await client.query(`
          UPDATE batch_ai_suggestions SET
            payload=$2::jsonb,
            affected_product_ids=(
              SELECT jsonb_agg(DISTINCT value)
              FROM jsonb_array_elements(affected_product_ids || $3::jsonb)
            )
          WHERE id=$1
        `, [sameFamily.id, JSON.stringify(payload), JSON.stringify([productId])])
        continue
      }
      suggestion.observed_colors = observedColors(suggestion)
    }

    if (kind === 'attribute' && rejected.rows.some((row) => (
      row.kind === 'attribute'
      && canonicalBatchSuggestionKey(row.payload?.code || row.canonical_key, 'attribute') === key
    ))) continue

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

export async function reconcileBatchColorFamilySuggestions(client: QueryClient, batchId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const result = await client.query(`
    SELECT s.*,p.name,p.brand,p.category,p.subcategory,p.attributes
    FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    LEFT JOIN products p ON p.id=(s.affected_product_ids->>0)::int
    WHERE r.batch_id=$1 AND s.kind='color_family' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  const firstByFamily = new Map<string, any>()
  for (const row of result.rows) {
    const familyKey = row.payload?.product_identity_key || canonicalProductColorFamilyKey(row, row.payload)
    if (!familyKey) continue
    const duplicate = firstByFamily.get(familyKey)
    if (!duplicate) {
      const productColors = row.attributes?.colors
      const payload = {
        ...row.payload,
        product_identity_key: familyKey,
        observed_colors: observedColors(row.payload, productColors),
      }
      await client.query('UPDATE batch_ai_suggestions SET payload=$2::jsonb WHERE id=$1', [row.id, JSON.stringify(payload)])
      firstByFamily.set(familyKey, { ...row, payload })
      continue
    }
    const payload = {
      ...duplicate.payload,
      observed_colors: observedColors(duplicate.payload, row.attributes?.colors || row.payload?.color),
    }
    await client.query(`
      UPDATE batch_ai_suggestions SET
        payload=$2::jsonb,
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(affected_product_ids || $3::jsonb)
        )
      WHERE id=$1
    `, [duplicate.id, JSON.stringify(payload), JSON.stringify(row.affected_product_ids || [])])
    duplicate.payload = payload
    await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
  }
}

export async function reconcileKnownAttributeSuggestions(
  client: QueryClient,
  batchId: string,
  knownCodes: Set<string>,
) {
  const result = await client.query(`
    SELECT s.* FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    WHERE r.batch_id=$1 AND s.kind='attribute' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  for (const row of result.rows) {
    const code = canonicalBatchSuggestionKey(row.payload?.code || row.canonical_key, 'attribute')
    if (!code || !knownCodes.has(code) || row.payload?.value === undefined) continue
    await client.query(`
      UPDATE products SET
        attributes=jsonb_set(COALESCE(attributes,'{}'::jsonb),ARRAY[$2]::text[],$3::jsonb,true),
        updated_at=NOW()
      WHERE id=ANY($1::int[])
    `, [
      row.affected_product_ids.map(Number),
      code,
      JSON.stringify(row.payload.value),
    ])
    await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
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

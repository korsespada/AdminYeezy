// Разовая чистка размеров, которые не являются размерным рядом.
//
//   node scripts/clean-catalog-sizes.mjs                 # сухой прогон: план и counts
//   node scripts/clean-catalog-sizes.mjs --apply         # запись в yu_scraping
//   node scripts/clean-catalog-sizes.mjs --rails         # синхронизация витрины через Rails API
//   node scripts/clean-catalog-sizes.mjs --only 602046   # один товар (для проверки)
//
// Правила те же, что в lib/size-rules.ts: сумки без размеров, ювелирка только с
// подтверждённой меткой, числа из габаритов у кошельков/обложек/косметичек/очков,
// у чемоданов только дюймовые размеры.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import pg from 'pg'

import { applyCatalogSizeRules } from '../lib/size-rules.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env') })

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const rails = args.includes('--rails')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null

const pool = new pg.Pool({ connectionString: process.env.SCRAPING_DATABASE_URL, max: 4 })

async function categoryNames() {
  const result = await pool.query(`
    SELECT entity_type, canonical_id, name
    FROM catalog_id_mappings
    WHERE entity_type IN ('category', 'subcategory')
  `)
  const categories = new Map()
  const subcategories = new Map()
  for (const row of result.rows) {
    if (row.entity_type === 'category') categories.set(row.canonical_id, row.name)
    else subcategories.set(row.canonical_id, row.name)
  }
  return { categories, subcategories }
}

const TARGET_CATEGORIES = ['сумки', 'ювелирные изделия']
const TARGET_SUBCATEGORIES = ['кошельки и картхолдеры', 'обложки для паспорта', 'косметички', 'очки', 'чемоданы']

function targetIds(categories, subcategories) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е').trim()
  return {
    categories: [...categories.entries()].filter(([, name]) => TARGET_CATEGORIES.includes(normalize(name))).map(([id]) => id),
    subcategories: [...subcategories.entries()].filter(([, name]) => TARGET_SUBCATEGORIES.includes(normalize(name))).map(([id]) => id),
  }
}

function sizeList(attributes) {
  const value = attributes?.sizes
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.values)) return value.values
  return []
}

async function buildPlan() {
  const { categories, subcategories } = await categoryNames()
  const targets = targetIds(categories, subcategories)
  const result = await pool.query(`
    SELECT p.id, p.external_id, p.name, p.category, p.subcategory, p.attributes,
           p.batch_id,
           bp.rails_product_id,
           src.source_text
    FROM products p
    LEFT JOIN batch_publications bp
      ON bp.batch_id = p.batch_id AND bp.external_id = p.external_id
    LEFT JOIN LATERAL (
      SELECT i.input_snapshot->'product'->>'description' AS source_text
      FROM batch_ai_items i
      WHERE i.product_id = p.id AND i.status = 'completed'
      ORDER BY i.completed_at DESC
      LIMIT 1
    ) src ON true
    WHERE p.attributes ? 'sizes'
      AND (p.category = ANY($1::text[]) OR p.subcategory = ANY($2::text[]))
      ${only ? 'AND p.id = $3' : ''}
    ORDER BY p.id
  `, only ? [targets.categories, targets.subcategories, Number(only)] : [targets.categories, targets.subcategories])

  const plan = []
  for (const row of result.rows) {
    const sizes = sizeList(row.attributes)
    if (sizes.length === 0) continue
    const rule = applyCatalogSizeRules({
      categoryName: categories.get(row.category),
      subcategoryName: subcategories.get(row.subcategory),
      sizes: row.attributes.sizes,
      sourceText: [row.name, row.source_text].filter(Boolean).join('\n'),
    })
    if (!rule.changed) continue
    plan.push({
      id: row.id,
      external_id: row.external_id,
      name: row.name,
      category: categories.get(row.category) || '',
      subcategory: subcategories.get(row.subcategory) || '',
      batch_id: row.batch_id,
      rails_product_id: row.rails_product_id,
      before: sizes,
      after: rule.sizes,
      removed: rule.removed,
      nominal: rule.nominalBagSize,
    })
  }
  return plan
}

function summarize(plan) {
  const byCategory = new Map()
  let published = 0
  let removedValues = 0
  for (const item of plan) {
    const key = item.category || '—'
    byCategory.set(key, (byCategory.get(key) || 0) + 1)
    if (item.rails_product_id) published += 1
    removedValues += item.removed.length
  }
  return { total: plan.length, published, removedValues, byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]) }
}

function writePlanCsv(plan) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = ['id', 'external_id', 'category', 'subcategory', 'before', 'after', 'rails_product_id', 'name']
  const lines = [header.join(',')]
  for (const item of plan) {
    lines.push([
      item.id, item.external_id, item.category, item.subcategory,
      JSON.stringify(item.before), item.after === null ? 'DELETED' : JSON.stringify(item.after),
      item.rails_product_id || '', item.name,
    ].map(escape).join(','))
  }
  const file = path.join(here, '..', 'tmp', 'size-cleanup-plan.csv')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `\uFEFF${lines.join('\r\n')}`, 'utf8')
  return file
}

async function applyPlan(plan) {
  let updated = 0
  for (let index = 0; index < plan.length; index += 200) {
    const chunk = plan.slice(index, index + 200)
    const deletes = chunk.filter((item) => item.after === null).map((item) => item.id)
    const sets = chunk.filter((item) => item.after !== null)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (deletes.length > 0) {
        const result = await client.query(
          `UPDATE products SET attributes = attributes - 'sizes', updated_at = NOW() WHERE id = ANY($1::int[])`,
          [deletes],
        )
        updated += result.rowCount
      }
      for (const item of sets) {
        const result = await client.query(
          `UPDATE products SET attributes = jsonb_set(attributes, '{sizes}', $2::jsonb), updated_at = NOW() WHERE id = $1`,
          [item.id, JSON.stringify(item.after)],
        )
        updated += result.rowCount
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  return updated
}

// --- Rails API -------------------------------------------------------------

function railsBase() {
  const raw = (process.env.RAILS_API_URL || '').replace(/\/+$/, '')
  if (!raw) throw new Error('RAILS_API_URL is required')
  return raw.endsWith('/api/v1') ? raw : `${raw}/api/v1`
}

let railsToken = null
async function railsLogin() {
  if (railsToken) return railsToken
  const response = await fetch(`${railsBase()}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.RAILS_ADMIN_EMAIL, password: process.env.RAILS_ADMIN_PASSWORD }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) throw new Error(`Rails login failed: ${response.status} ${payload.message || ''}`)
  railsToken = payload.token
  return railsToken
}

async function railsCall(pathname, init = {}) {
  const token = await railsLogin()
  const response = await fetch(`${railsBase()}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${pathname} -> ${response.status}: ${payload.message || payload.error || ''}`)
  return payload
}

async function syncRails(plan) {
  const targets = plan.filter((item) => item.rails_product_id)
  const summary = { targets: targets.length, patched: 0, alreadyClean: 0, failed: [] }
  for (const item of targets) {
    try {
      const { product } = await railsCall(`/admin/products/${encodeURIComponent(item.rails_product_id)}`)
      const catalogAttributes = { ...(product?.catalog_attributes || {}) }
      const currentVariants = Array.isArray(product?.variants) ? product.variants : []
      const sizedVariants = currentVariants.filter((variant) => String(variant?.size ?? '').trim() !== '')
      if (!Object.hasOwn(catalogAttributes, 'sizes') && sizedVariants.length === 0) {
        summary.alreadyClean += 1
        continue
      }
      delete catalogAttributes.sizes
      const patched = await railsCall(`/admin/products/${encodeURIComponent(item.rails_product_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ product: { catalog_attributes: catalogAttributes, variants: [] } }),
      })
      const after = patched?.product
      if (after && Object.hasOwn(after.catalog_attributes || {}, 'sizes')) {
        throw new Error('Rails оставил sizes в catalog_attributes')
      }
      const afterSizedVariants = (Array.isArray(after?.variants) ? after.variants : [])
        .filter((variant) => String(variant?.size ?? '').trim() !== '')
      if (afterSizedVariants.length > 0) {
        throw new Error(`Rails оставил размерные варианты: ${afterSizedVariants.map((variant) => variant.size).join(', ')}`)
      }
      summary.patched += 1
    } catch (error) {
      summary.failed.push({ id: item.id, external_id: item.external_id, rails_product_id: item.rails_product_id, error: error.message })
    }
  }
  return summary
}

// --- main ------------------------------------------------------------------

const plan = await buildPlan()
const stats = summarize(plan)
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...stats }, null, 1))
const csv = writePlanCsv(plan)
console.log(`plan: ${csv}`)

if (apply && plan.length > 0) {
  const updated = await applyPlan(plan)
  console.log(`scraping: updated ${updated} products`)
}

if (rails) {
  const summary = await syncRails(plan)
  console.log(JSON.stringify({ rails: summary }, null, 1))
}

await pool.end()

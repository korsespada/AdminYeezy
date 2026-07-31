const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
})

const OLD_KEDY_ID = '1ff330e2-1cd7-4147-a0da-38247e2f9bb4'
const REQUIRED_SLUGS = [
  'obuv-krossovki',
  'obuv-sandalii',
  'obuv-myuli',
  'obuv-tapki',
  'obuv-tufli-na-kabluke',
  'obuv-tufli-na-ploskoy-podoshve',
]

function railsApiUrl(pathname) {
  const raw = process.env.RAILS_API_URL || 'https://api.yeezyunique.ru/api/v1'
  let base = raw.replace(/\/+$/, '')
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`
  return `${base}${pathname}`
}

async function loadShoeTaxonomy() {
  const response = await fetch(railsApiUrl('/catalog/categories'), { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Rails catalog returned HTTP ${response.status}`)
  const payload = await response.json()
  const shoes = (payload.categories || []).find((item) => item.slug === 'obuv' || item.name === 'Обувь')
  if (!shoes) throw new Error('Категория «Обувь» не найдена в Rails')

  const bySlug = new Map((shoes.children || []).map((item) => [String(item.slug), item]))
  const missing = REQUIRED_SLUGS.filter((slug) => !bySlug.has(slug))
  if (missing.length > 0) {
    throw new Error(`Сначала примените Rails-миграцию справочника обуви. Не найдены: ${missing.join(', ')}`)
  }
  return { shoes, bySlug }
}

function replaceIds(value, replacements) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(String).map((id) => replacements.get(id) || id).filter(Boolean))]
}

async function migrate() {
  const { shoes, bySlug } = await loadShoeTaxonomy()
  const sneakers = bySlug.get('obuv-krossovki')
  const replacements = new Map([[OLD_KEDY_ID, String(sneakers.id)]])
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const products = await client.query(`
      UPDATE products
      SET category=$2,subcategory=$3,updated_at=NOW()
      WHERE subcategory=$1
    `, [OLD_KEDY_ID, String(shoes.id), String(sneakers.id)])

    const suppliers = await client.query(`
      SELECT id,default_subcategory,allowed_subcategory_ids
      FROM suppliers
      FOR UPDATE
    `)
    let supplierCount = 0
    for (const supplier of suppliers.rows) {
      const defaultSubcategory = replacements.get(String(supplier.default_subcategory || ''))
        || supplier.default_subcategory
        || null
      const allowed = replaceIds(supplier.allowed_subcategory_ids, replacements)
      if (
        String(defaultSubcategory || '') === String(supplier.default_subcategory || '')
        && JSON.stringify(allowed) === JSON.stringify(supplier.allowed_subcategory_ids || [])
      ) continue

      await client.query(`
        UPDATE suppliers
        SET default_subcategory=$2,allowed_subcategory_ids=$3::jsonb,updated_at=NOW()
        WHERE id=$1
      `, [supplier.id, defaultSubcategory, JSON.stringify(allowed)])
      supplierCount += 1
    }

    const priceRules = await client.query('SELECT id,conditions FROM supplier_price_rules FOR UPDATE')
    let priceRuleCount = 0
    for (const rule of priceRules.rows) {
      const conditions = { ...(rule.conditions || {}) }
      const replacement = replacements.get(String(conditions.subcategory || ''))
      if (!replacement) continue
      conditions.subcategory = replacement
      await client.query(
        'UPDATE supplier_price_rules SET conditions=$2::jsonb,updated_at=NOW() WHERE id=$1',
        [rule.id, JSON.stringify(conditions)],
      )
      priceRuleCount += 1
    }

    await client.query(`
      DELETE FROM catalog_id_mappings
      WHERE entity_type='subcategory'
        AND (legacy_id=ANY($1::text[]) OR canonical_id=ANY($1::text[]))
    `, [[OLD_KEDY_ID, String(sneakers.id)]])
    await client.query(`
      INSERT INTO catalog_id_mappings(
        entity_type,legacy_id,canonical_id,name,canonical_parent_id,updated_at
      ) VALUES('subcategory',$1,$2,$3,$4,NOW())
    `, [OLD_KEDY_ID, String(sneakers.id), String(sneakers.name), String(shoes.id)])

    for (const subcategory of shoes.children || []) {
      if (String(subcategory.id) === String(sneakers.id) || String(subcategory.id) === OLD_KEDY_ID) continue
      const mapping = await client.query(`
        UPDATE catalog_id_mappings
        SET name=$2,canonical_parent_id=$3,updated_at=NOW()
        WHERE entity_type='subcategory' AND canonical_id=$1
      `, [String(subcategory.id), String(subcategory.name), String(shoes.id)])
      if (mapping.rowCount > 0) continue

      await client.query(`
        INSERT INTO catalog_id_mappings(
          entity_type,legacy_id,canonical_id,name,canonical_parent_id,updated_at
        ) VALUES('subcategory',$1,$1,$2,$3,NOW())
        ON CONFLICT(entity_type,legacy_id) DO UPDATE SET
          canonical_id=EXCLUDED.canonical_id,
          name=EXCLUDED.name,
          canonical_parent_id=EXCLUDED.canonical_parent_id,
          updated_at=NOW()
      `, [String(subcategory.id), String(subcategory.name), String(shoes.id)])
    }

    await client.query('COMMIT')
    console.log(JSON.stringify({
      products: products.rowCount,
      suppliers: supplierCount,
      priceRules: priceRuleCount,
      sneakersId: String(sneakers.id),
    }))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error('Shoe taxonomy migration failed:', error.message)
  process.exitCode = 1
})

const { Pool } = require('pg')
require('dotenv').config()

const scrapingPool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
})
const legacyPool = new Pool({
  connectionString: process.env.LEGACY_CATALOG_DATABASE_URL || process.env.DATABASE_URL,
})

const lookupBase = (process.env.RAILS_LOOKUPS_URL || 'https://api.yeezyunique.ru/api/v1').replace(/\/+$/, '')
const CATEGORY_NAME_ALIASES = new Map([
  ['кошельки', 'кошельки и картхолдеры'],
])
const IGNORED_LEGACY_MAPPINGS = new Set([
  // Generic legacy "Сумки" subcategory was retired. New bag subcategories
  // must be selected by a classifier/reviewer, not guessed here.
  'subcategory:dnckd3yiv2q0r5f',
])

function key(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

async function fetchJson(pathname) {
  const response = await fetch(`${lookupBase}${pathname}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${pathname}: ${payload.message || payload.error || response.status}`)
  }
  return payload
}

function flattenCategories(categories) {
  const result = []
  for (const category of categories || []) {
    result.push({
      id: String(category.id),
      name: String(category.name || ''),
      parentId: null,
      parentName: null,
    })
    for (const child of category.children || []) {
      result.push({
        id: String(child.id),
        name: String(child.name || ''),
        parentId: String(category.id),
        parentName: String(category.name || ''),
      })
    }
  }
  return result
}

function uniqueCandidate(items, name, parentName) {
  const normalizedName = CATEGORY_NAME_ALIASES.get(key(name)) || key(name)
  const matches = items.filter((item) => key(item.name) === normalizedName)
  if (parentName) {
    const parentMatches = matches.filter((item) => key(item.parentName) === key(parentName))
    if (parentMatches.length === 1) return parentMatches[0]
    if (normalizedName !== key(name) && matches.length === 1) return matches[0]
  }
  return matches.length === 1 ? matches[0] : null
}

async function migrate() {
  await scrapingPool.query('BEGIN')
  try {
    await scrapingPool.query(`
      CREATE TABLE IF NOT EXISTS catalog_id_mappings (
        entity_type TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        name TEXT NOT NULL,
        legacy_parent_id TEXT,
        canonical_parent_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (entity_type, legacy_id),
        UNIQUE (entity_type, canonical_id)
      )
    `)
    await scrapingPool.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS legacy_default_brand TEXT,
        ADD COLUMN IF NOT EXISTS legacy_default_category TEXT,
        ADD COLUMN IF NOT EXISTS legacy_default_subcategory TEXT
    `)

    const brandsPayload = await fetchJson('/catalog/brands')
    const categoriesPayload = await fetchJson('/catalog/categories')
    const canonicalBrands = (brandsPayload.brands || []).map((item) => ({
      id: String(item.id),
      name: String(item.name || ''),
      parentId: null,
      parentName: null,
    }))
    const canonicalCategories = flattenCategories(categoriesPayload.categories)
    const canonicalByType = {
      brand: canonicalBrands,
      category: canonicalCategories.filter((item) => !item.parentId),
      subcategory: canonicalCategories.filter((item) => item.parentId),
    }

    const legacyBrands = (await legacyPool.query('SELECT id::text, name FROM brands')).rows
    const legacyCategories = (await legacyPool.query('SELECT id::text, name FROM categories')).rows
    const legacySubcategories = (await legacyPool.query('SELECT id::text, name, category::text AS parent_id FROM subcategories')).rows
    const legacyCategoryNames = new Map(legacyCategories.map((item) => [String(item.id), String(item.name || '')]))

    const mappings = []
    const missing = []
    for (const item of legacyBrands) {
      const match = uniqueCandidate(canonicalByType.brand, item.name)
      if (!match) missing.push({ type: 'brand', id: item.id, name: item.name })
      else mappings.push({ type: 'brand', legacyId: String(item.id), canonicalId: match.id, name: match.name })
    }
    for (const item of legacyCategories) {
      const match = uniqueCandidate(canonicalByType.category, item.name)
      if (!match) missing.push({ type: 'category', id: item.id, name: item.name })
      else mappings.push({ type: 'category', legacyId: String(item.id), canonicalId: match.id, name: match.name })
    }
    for (const item of legacySubcategories) {
      if (IGNORED_LEGACY_MAPPINGS.has(`subcategory:${item.id}`)) continue
      const parentName = legacyCategoryNames.get(String(item.parent_id))
      const match = uniqueCandidate(canonicalByType.subcategory, item.name, parentName)
      if (!match) missing.push({ type: 'subcategory', id: item.id, name: item.name, parent: parentName || null })
      else {
        mappings.push({
          type: 'subcategory',
          legacyId: String(item.id),
          canonicalId: match.id,
          name: match.name,
          legacyParentId: String(item.parent_id || ''),
          canonicalParentId: match.parentId,
        })
      }
    }

    for (const ignoredKey of IGNORED_LEGACY_MAPPINGS) {
      const [type, legacyId] = ignoredKey.split(':')
      const existing = await scrapingPool.query(
        'SELECT canonical_id FROM catalog_id_mappings WHERE entity_type=$1 AND legacy_id=$2',
        [type, legacyId],
      )
      const canonicalId = existing.rows[0]?.canonical_id || null
      if (type === 'subcategory') {
        await scrapingPool.query(`
          UPDATE suppliers
          SET
            legacy_default_subcategory = COALESCE(legacy_default_subcategory, $1),
            default_subcategory = NULL,
            updated_at = NOW()
          WHERE legacy_default_subcategory = $1
             OR default_subcategory = $1
             OR ($2::text IS NOT NULL AND default_subcategory = $2)
        `, [legacyId, canonicalId])
      }
      await scrapingPool.query(
        'DELETE FROM catalog_id_mappings WHERE entity_type=$1 AND legacy_id=$2',
        [type, legacyId],
      )
    }

    for (const mapping of mappings) {
      await scrapingPool.query(`
        INSERT INTO catalog_id_mappings
          (entity_type, legacy_id, canonical_id, name, legacy_parent_id, canonical_parent_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
          canonical_id = EXCLUDED.canonical_id,
          name = EXCLUDED.name,
          legacy_parent_id = EXCLUDED.legacy_parent_id,
          canonical_parent_id = EXCLUDED.canonical_parent_id,
          updated_at = NOW()
      `, [
        mapping.type,
        mapping.legacyId,
        mapping.canonicalId,
        mapping.name,
        mapping.legacyParentId || null,
        mapping.canonicalParentId || null,
      ])
    }

    const suppliers = (await scrapingPool.query(`
      SELECT id, default_brand, default_category, default_subcategory
      FROM suppliers
      FOR UPDATE
    `)).rows
    const mappingByType = new Map(mappings.map((item) => [`${item.type}:${item.legacyId}`, item]))
    let updatedSuppliers = 0
    for (const supplier of suppliers) {
      const values = {
        brand: supplier.default_brand,
        category: supplier.default_category,
        subcategory: supplier.default_subcategory,
      }
      const replacements = {
        brand: mappingByType.get(`brand:${String(values.brand || '')}`),
        category: mappingByType.get(`category:${String(values.category || '')}`),
        subcategory: mappingByType.get(`subcategory:${String(values.subcategory || '')}`),
      }
      if (!Object.values(replacements).some(Boolean)) continue

      await scrapingPool.query(`
        UPDATE suppliers SET
          legacy_default_brand = COALESCE(legacy_default_brand, default_brand),
          legacy_default_category = COALESCE(legacy_default_category, default_category),
          legacy_default_subcategory = COALESCE(legacy_default_subcategory, default_subcategory),
          default_brand = $2,
          default_category = $3,
          default_subcategory = $4,
          updated_at = NOW()
        WHERE id = $1
      `, [
        supplier.id,
        replacements.brand?.canonicalId || supplier.default_brand,
        replacements.category?.canonicalId || supplier.default_category,
        replacements.subcategory?.canonicalId || supplier.default_subcategory,
      ])
      updatedSuppliers += 1
    }

    await scrapingPool.query('COMMIT')
    console.log(JSON.stringify({
      mapped: mappings.length,
      updatedSuppliers,
      missing: missing.slice(0, 100),
      missingCount: missing.length,
    }, null, 2))
  } catch (error) {
    await scrapingPool.query('ROLLBACK')
    throw error
  } finally {
    await Promise.all([scrapingPool.end(), legacyPool.end()])
  }
}

migrate().catch((error) => {
  console.error('Supplier catalog ID migration failed:', error.message)
  process.exitCode = 1
})

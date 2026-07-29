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

    const brandBackfill = await scrapingPool.query(`
      UPDATE products p SET brand=m.canonical_id, updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='brand' AND p.brand=m.legacy_id
    `)
    const categoryBackfill = await scrapingPool.query(`
      UPDATE products p SET category=m.canonical_id, updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='category' AND p.category=m.legacy_id
    `)
    const subcategoryBackfill = await scrapingPool.query(`
      UPDATE products p
      SET subcategory=m.canonical_id,
          category=COALESCE(m.canonical_parent_id,p.category),
          updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='subcategory' AND p.subcategory=m.legacy_id
    `)
    const genderBackfill = await scrapingPool.query(`
      UPDATE products SET gender=CASE LOWER(TRIM(gender))
        WHEN 'для женщин' THEN 'female'
        WHEN 'женский' THEN 'female'
        WHEN 'women' THEN 'female'
        WHEN 'woman' THEN 'female'
        WHEN 'для мужчин' THEN 'male'
        WHEN 'мужской' THEN 'male'
        WHEN 'men' THEN 'male'
        WHEN 'man' THEN 'male'
        WHEN 'унисекс' THEN 'unisex'
        ELSE gender END,
        updated_at=NOW()
      WHERE LOWER(TRIM(gender)) IN ('для женщин','женский','women','woman','для мужчин','мужской','men','man','унисекс')
    `)
    const missingBrandIds = missing.filter((item) => item.type === 'brand').map((item) => String(item.id))
    const missingCategoryIds = missing.filter((item) => item.type === 'category').map((item) => String(item.id))
    const missingSubcategoryIds = missing.filter((item) => item.type === 'subcategory').map((item) => String(item.id))
    const clearedBrands = missingBrandIds.length
      ? await scrapingPool.query("UPDATE products SET brand='',updated_at=NOW() WHERE brand=ANY($1::text[])", [missingBrandIds])
      : { rowCount: 0 }
    const clearedCategories = missingCategoryIds.length
      ? await scrapingPool.query("UPDATE products SET category='',updated_at=NOW() WHERE category=ANY($1::text[])", [missingCategoryIds])
      : { rowCount: 0 }
    const clearedSubcategories = missingSubcategoryIds.length
      ? await scrapingPool.query('UPDATE products SET subcategory=NULL,updated_at=NOW() WHERE subcategory=ANY($1::text[])', [missingSubcategoryIds])
      : { rowCount: 0 }
    const updatedProducts = brandBackfill.rowCount + categoryBackfill.rowCount + subcategoryBackfill.rowCount + genderBackfill.rowCount
      + clearedBrands.rowCount + clearedCategories.rowCount + clearedSubcategories.rowCount

    await scrapingPool.query('COMMIT')
    console.log(JSON.stringify({
      mapped: mappings.length,
      updatedSuppliers,
      updatedProducts,
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

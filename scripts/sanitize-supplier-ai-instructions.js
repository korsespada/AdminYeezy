const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
})

function sanitize(value, mappings) {
  let text = String(value || '')
  for (const mapping of mappings) {
    const name = String(mapping.name || '').trim()
    if (!name) continue
    for (const id of [mapping.legacy_id, mapping.canonical_id].map(String).filter(Boolean)) {
      text = text.split(id).join(`«${name}»`)
    }
  }
  return text
    .replace(/ID\s+бренда/giu, 'бренд из справочника')
    .replace(/ID\s+подкатегории/giu, 'подкатегория из справочника')
    .replace(/ID\s+категории/giu, 'категория из справочника')
    .replace(/назнач(?:ь|ить)\s+ID/giu, 'выбери значение из справочника')
    .replace(/подстав(?:ь|ить)\s+ID/giu, 'выбери значение из справочника')
    .replace(/ID:\s*(«[^»]+»)/giu, '$1')
}

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const mappings = (await client.query(`
      SELECT legacy_id,canonical_id,name
      FROM catalog_id_mappings
      ORDER BY GREATEST(LENGTH(legacy_id),LENGTH(canonical_id)) DESC
    `)).rows
    const suppliers = (await client.query(`
      SELECT id,ai_instructions,ai_photo_instructions
      FROM suppliers FOR UPDATE
    `)).rows
    let updated = 0
    for (const supplier of suppliers) {
      const aiInstructions = sanitize(supplier.ai_instructions, mappings)
      const photoInstructions = sanitize(supplier.ai_photo_instructions, mappings)
      if (aiInstructions === String(supplier.ai_instructions || '') && photoInstructions === String(supplier.ai_photo_instructions || '')) continue
      await client.query(`
        UPDATE suppliers
        SET ai_instructions=$2,ai_photo_instructions=$3,updated_at=NOW()
        WHERE id=$1
      `, [supplier.id, aiInstructions, photoInstructions])
      updated += 1
    }
    const brandProducts = await client.query(`
      UPDATE products p SET brand=m.canonical_id,updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='brand' AND p.brand=m.legacy_id AND p.brand<>m.canonical_id
    `)
    const categoryProducts = await client.query(`
      UPDATE products p SET category=m.canonical_id,updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='category' AND p.category=m.legacy_id AND p.category<>m.canonical_id
    `)
    const subcategoryProducts = await client.query(`
      UPDATE products p
      SET subcategory=m.canonical_id,
          category=COALESCE(m.canonical_parent_id,p.category),
          updated_at=NOW()
      FROM catalog_id_mappings m
      WHERE m.entity_type='subcategory' AND p.subcategory=m.legacy_id AND p.subcategory<>m.canonical_id
    `)
    await client.query('COMMIT')
    console.log(JSON.stringify({
      supplierInstructions: updated,
      productReferences: brandProducts.rowCount + categoryProducts.rowCount + subcategoryProducts.rowCount,
    }))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

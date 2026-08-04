const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const BATCH_ID = 'd2d7775b-a593-4c0f-b3e5-a537a7c03ef2'
const RUN_ID = '88ba3ba7-eccf-4b1a-9c36-51106a05374c'
const EXPECTED_PRODUCTS = 17
const apply = process.argv.includes('--apply')
const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

async function resetBatchMediaSeo() {
  const pool = new Pool({ connectionString })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const target = await client.query(`
      SELECT product.id
      FROM batch_ai_items AS item
      JOIN products AS product ON product.id=item.product_id
      WHERE item.run_id=$1
        AND item.status='completed'
        AND product.batch_id=$2
        AND COALESCE(product.slug,'') <> ''
        AND jsonb_array_length(COALESCE(product.photo_alts,'[]'::jsonb)) > 0
      FOR UPDATE OF product
    `, [RUN_ID, BATCH_ID])

    if (target.rowCount !== EXPECTED_PRODUCTS) {
      throw new Error(`Expected ${EXPECTED_PRODUCTS} completed media SEO products, found ${target.rowCount}`)
    }

    if (!apply) {
      await client.query('ROLLBACK')
      console.log(`Dry run: ${target.rowCount} products would be reset. Re-run with --apply to write changes.`)
      return
    }

    const reset = await client.query(`
      UPDATE products
      SET slug=NULL, photo_alts='[]'::jsonb, photo_slugs='[]'::jsonb, updated_at=NOW()
      WHERE id=ANY($1::int[])
      RETURNING id
    `, [target.rows.map((row) => row.id)])
    if (reset.rowCount !== EXPECTED_PRODUCTS) {
      throw new Error(`Reset changed ${reset.rowCount} products instead of ${EXPECTED_PRODUCTS}`)
    }

    await client.query('COMMIT')
    console.log(`Reset ${reset.rowCount} products in batch ${BATCH_ID}`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

resetBatchMediaSeo().catch((error) => {
  console.error(`Media SEO reset failed: ${error.message}`)
  process.exitCode = 1
})

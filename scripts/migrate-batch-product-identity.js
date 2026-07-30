const { Pool } = require('pg')
require('dotenv').config()

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_external_id_key')
    await client.query('DROP INDEX IF EXISTS products_external_id_idx')
    await client.query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_batch_external_id_key')
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_batch_external_id_idx
      ON products (batch_id, external_id)
    `)
    await client.query(`
      ALTER TABLE products ADD CONSTRAINT products_batch_external_id_key
      UNIQUE USING INDEX products_batch_external_id_idx
    `)
    await client.query('COMMIT')
    console.log('Batch product identity migrated to (batch_id, external_id)')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error(error)
  process.exit(1)
})

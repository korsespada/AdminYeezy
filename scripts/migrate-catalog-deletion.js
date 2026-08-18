const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function migrateCatalogDeletion() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      ALTER TABLE scraping_batches
        ADD COLUMN IF NOT EXISTS catalog_deleted_at TIMESTAMPTZ
    `)
    await client.query('COMMIT')
    console.log('Catalog deletion status schema is ready')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Catalog deletion status migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrateCatalogDeletion()

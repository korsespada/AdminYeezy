const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function ensureSupplierAiSchema() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS ai_processing_options JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS price_ai_instructions TEXT NOT NULL DEFAULT ''
    `)
    await client.query('COMMIT')
    console.log('Supplier AI schema is ready')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Supplier AI schema migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

ensureSupplierAiSchema()

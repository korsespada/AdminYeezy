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
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_post_process_scripts (
        id UUID PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(supplier_id, version)
      )
    `)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS supplier_post_process_scripts_active_idx
      ON supplier_post_process_scripts(supplier_id) WHERE is_active
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS supplier_post_process_scripts_supplier_created_idx
      ON supplier_post_process_scripts(supplier_id, created_at DESC)
    `)
    await client.query('COMMIT')
    console.log('Supplier post-process script migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Supplier post-process script migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

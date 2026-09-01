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
      CREATE TABLE IF NOT EXISTS supplier_photo_fingerprints (
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        etag TEXT,
        visual_etag TEXT,
        visual_hash TEXT,
        visual_pixels TEXT,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (supplier_id, url)
      )
    `)
    await client.query('ALTER TABLE supplier_photo_fingerprints ADD COLUMN IF NOT EXISTS visual_etag TEXT')
    await client.query('ALTER TABLE supplier_photo_fingerprints ADD COLUMN IF NOT EXISTS visual_hash TEXT')
    await client.query('ALTER TABLE supplier_photo_fingerprints ADD COLUMN IF NOT EXISTS visual_pixels TEXT')
    await client.query(`
      CREATE INDEX IF NOT EXISTS supplier_photo_fingerprints_supplier_checked_idx
      ON supplier_photo_fingerprints(supplier_id, checked_at DESC)
    `)
    await client.query('COMMIT')
    console.log('Supplier photo fingerprint migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Supplier photo fingerprint migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

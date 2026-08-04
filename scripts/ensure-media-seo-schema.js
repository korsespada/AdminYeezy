const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function ensureMediaSeoSchema() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS slug TEXT,
        ADD COLUMN IF NOT EXISTS photo_alts JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS photo_slugs JSONB NOT NULL DEFAULT '[]'::jsonb
    `)
    await client.query(`
      ALTER TABLE batch_ai_runs
        ADD COLUMN IF NOT EXISTS catalog_applied_at TIMESTAMPTZ
    `)
    await client.query('COMMIT')
    console.log('Media SEO schema is ready')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Media SEO schema migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

ensureMediaSeoSchema()

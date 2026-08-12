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
      CREATE TABLE IF NOT EXISTS measurement_templates (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        garment_type TEXT NOT NULL,
        measurements JSONB NOT NULL,
        source_image_url TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      ALTER TABLE measurement_templates
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE
    `)
    const missingSupplier = await client.query('SELECT COUNT(*)::int AS count FROM measurement_templates WHERE supplier_id IS NULL')
    if (Number(missingSupplier.rows[0]?.count || 0) === 0) {
      await client.query('ALTER TABLE measurement_templates ALTER COLUMN supplier_id SET NOT NULL')
    }
    await client.query('CREATE INDEX IF NOT EXISTS measurement_templates_supplier_garment_idx ON measurement_templates(supplier_id, garment_type, name)')
    await client.query('COMMIT')
    console.log('Measurement templates migration complete')
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

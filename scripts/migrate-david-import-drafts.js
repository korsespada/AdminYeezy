/**
 * Черновики импорта товаров David Studio в Chromoff.
 *
 * Черновик — это состояние экрана ревью: выбранный товар David, поставленные в очередь
 * фото, сгенерированные ИИ поля и решение оператора. Пока черновик не подтверждён,
 * в каталог ничего не попадает.
 *
 * Запуск: node scripts/migrate-david-import-drafts.js
 */
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
      CREATE TABLE IF NOT EXISTS david_import_drafts (
        id UUID PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL DEFAULT 'new',
        target_product_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        source_product JSONB NOT NULL DEFAULT '{}'::jsonb,
        ai_output JSONB,
        edited JSONB NOT NULL DEFAULT '{}'::jsonb,
        price_rub INTEGER,
        chromoff_listing_id TEXT,
        rails_product_id TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS david_import_drafts_status_idx
      ON david_import_drafts (status, updated_at DESC)
    `)

    await client.query('COMMIT')
    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_import_drafts' ORDER BY ordinal_position
    `)
    console.log('david_import_drafts готова, колонок:', columns.rowCount)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error('ОШИБКА:', error.message)
  process.exit(1)
})

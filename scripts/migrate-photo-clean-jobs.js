/**
 * Очередь заданий на чистку фотографий от вотермарки.
 *
 * Зачем: чистка идёт нейросетью LaMa на машине оператора (torch + модель 205 МБ),
 * в контейнере AdminYeezy это держать нельзя. Сервер только раздаёт задания,
 * локальный воркер сам ходит наружу (AdminYeezy → Shopify → S3) и возвращает результат.
 *
 * Запуск: node scripts/migrate-photo-clean-jobs.js
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
      CREATE TABLE IF NOT EXISTS photo_clean_jobs (
        id UUID PRIMARY KEY,
        source_key TEXT NOT NULL,
        source_url TEXT NOT NULL,
        supplier TEXT NOT NULL DEFAULT '',
        source_product TEXT NOT NULL DEFAULT '',
        source_position INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_expires_at TIMESTAMPTZ,
        worker_id TEXT,
        clean_status TEXT,
        s3_clean_url TEXT,
        s3_before_url TEXT,
        s3_after_url TEXT,
        z_after NUMERIC,
        mask_px INTEGER,
        passes INTEGER,
        quality JSONB NOT NULL DEFAULT '{}'::jsonb,
        seconds NUMERIC,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS photo_clean_jobs_source_key_idx
      ON photo_clean_jobs (source_key)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS photo_clean_jobs_status_idx
      ON photo_clean_jobs (status, created_at)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS photo_clean_jobs_product_idx
      ON photo_clean_jobs (supplier, source_product, source_position)
    `)

    await client.query('COMMIT')

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'photo_clean_jobs' ORDER BY ordinal_position
    `)
    console.log('photo_clean_jobs готова, колонок:', columns.rowCount)
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

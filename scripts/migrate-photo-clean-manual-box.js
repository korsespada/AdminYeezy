/**
 * Ручная пометка вотермарки: приоритет задания и координаты рамки.
 *
 * Детектор иногда не находит надпись (например, на тёмном фоне или поверх
 * металла). Тогда оператор сам обводит вотермарку на кадре, и задание уходит
 * в очередь с приоритетом: воркер берёт его раньше остальных, а чистка идёт по
 * указанной рамке без автоопределения.
 *
 * Запуск: node scripts/migrate-photo-clean-manual-box.js
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
      ALTER TABLE photo_clean_jobs
        ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS manual_box JSONB
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS photo_clean_jobs_priority_idx
      ON photo_clean_jobs (status, priority DESC, created_at)
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

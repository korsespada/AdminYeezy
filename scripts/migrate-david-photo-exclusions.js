/**
 * Удалённые из импорта фото David Studio.
 *
 * Оператор смотрит очищенные кадры в карточке товара и убирает те, что не должны
 * попасть в Chromoff (дубли, неудачные ракурсы, чужая вотермарка). Удаление —
 * это исключение из выборки, а не потеря результата чистки: файл в S3 остаётся,
 * и кадр можно вернуть.
 *
 * Запуск: node scripts/migrate-david-photo-exclusions.js
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
      CREATE TABLE IF NOT EXISTS david_photo_exclusions (
        id UUID PRIMARY KEY,
        handle TEXT NOT NULL,
        source_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS david_photo_exclusions_handle_key_idx
      ON david_photo_exclusions (handle, source_key)
    `)

    await client.query('COMMIT')

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_photo_exclusions' ORDER BY ordinal_position
    `)
    console.log('david_photo_exclusions готова, колонок:', columns.rowCount)
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

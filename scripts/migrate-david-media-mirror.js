/**
 * Зеркало фото поставщика David Studio на наш S3.
 *
 * Зачем: ссылки выгрузки ведут на cdn.shopify.com. Он бывает недоступен, из-за
 * чего падал целый запрос сравнения колец, а часть колец вообще не участвовала в
 * подборе. Своя копия убирает эту зависимость и сохраняет фото, даже если
 * поставщик их удалит.
 *
 * Ключ — по содержимому: supplier-media/david-studio/<sha256>.<ext>, поэтому
 * одинаковые кадры разных товаров занимают одно место. Повторный запуск
 * пропускает уже зеркалированные адреса, так что скрипт можно прерывать.
 *
 * Запуск:
 *   node scripts/migrate-david-media-mirror.js
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
      CREATE TABLE IF NOT EXISTS david_media_mirror (
        id UUID PRIMARY KEY,
        handle TEXT NOT NULL,
        position INT,
        source_url TEXT NOT NULL,
        s3_url TEXT NOT NULL,
        bytes INT,
        content_type TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS david_media_mirror_source_idx
      ON david_media_mirror (source_url)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS david_media_mirror_handle_idx
      ON david_media_mirror (handle)
    `)

    await client.query('COMMIT')

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_media_mirror' ORDER BY ordinal_position
    `)
    console.log('david_media_mirror готова, колонок:', columns.rowCount)
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

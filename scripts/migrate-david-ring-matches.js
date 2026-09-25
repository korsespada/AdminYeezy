/**
 * Хвост удалённого раздела «Дубли колец» (он убран 2026-09-25).
 *
 * Скрипт делает две вещи:
 *   1. гарантирует колонки `david_import_drafts.merged_into_*` — по ним экран
 *      David Studio показывает метку «объединён со старым кольцом»;
 *   2. убирает таблицу `david_ring_matches`: код её больше не читает, а её данные
 *      были аудитом уже сделанных объединений (готовые товары живут в Rails).
 *
 * Обе операции идемпотентны, поэтому скрипт безопасно вызывается при каждом
 * старте контейнера и не даёт таблице появиться снова.
 *
 * Запуск: node scripts/migrate-david-ring-matches.js
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

    await client.query('DROP TABLE IF EXISTS david_ring_matches')

    // Чертёж товара David после объединения перестаёт быть «созданным» товаром, но
    // и «необработанным» он быть не должен: иначе оператор создаст дубль заново.
    // Поэтому храним, в какую старую карточку он влился. Таблицы черновиков может
    // не быть в чистом окружении — тогда колонки добавит её собственная миграция.
    const draftsTable = await client.query("SELECT to_regclass('public.david_import_drafts') AS name")
    if (draftsTable.rows[0]?.name) {
      await client.query(`
        ALTER TABLE david_import_drafts
          ADD COLUMN IF NOT EXISTS merged_into_listing_id TEXT,
          ADD COLUMN IF NOT EXISTS merged_into_product_id TEXT,
          ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ
      `)
    }

    await client.query('COMMIT')

    const draftColumns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_import_drafts' AND column_name LIKE 'merged%'
    `)
    const leftoverTable = await client.query("SELECT to_regclass('public.david_ring_matches') AS name")
    console.log('david_ring_matches:', leftoverTable.rows[0]?.name ? 'ОСТАЛАСЬ' : 'удалена', '| колонок объединения в david_import_drafts:', draftColumns.rowCount)
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

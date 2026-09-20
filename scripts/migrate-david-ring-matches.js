/**
 * Сопоставления старых колец Chromoff с моделями David Studio.
 *
 * Старое кольцо — каноническая карточка: у неё живой URL, история и цена. Карточка
 * David на ту же модель — дубль, который надо убрать. Таблица держит вердикт ИИ по
 * каждому старому кольцу, чтобы батч был возобновляемым и оператор видел, что уже
 * проверено, а что применить не удалось.
 *
 * anchor_listing_id уникален: на одно старое кольцо ровно один вердикт, повторный
 * расчёт перезаписывает строку, а не плодит дубли.
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS david_ring_matches (
        id UUID PRIMARY KEY,
        anchor_listing_id TEXT NOT NULL,
        anchor_product_id TEXT NOT NULL,
        anchor_slug TEXT,
        anchor_name TEXT,
        david_handle TEXT,
        david_product_id TEXT,
        david_listing_id TEXT,
        david_slug TEXT,
        david_title TEXT,
        confidence NUMERIC(4, 3),
        candidate_score NUMERIC(8, 4),
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'suggested',
        shortlist JSONB NOT NULL DEFAULT '[]'::jsonb,
        provider TEXT,
        model TEXT,
        applied JSONB,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS david_ring_matches_anchor_idx
      ON david_ring_matches (anchor_listing_id)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS david_ring_matches_status_idx
      ON david_ring_matches (status)
    `)

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

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_ring_matches' ORDER BY ordinal_position
    `)
    const draftColumns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_import_drafts' AND column_name LIKE 'merged%'
    `)
    console.log('david_ring_matches готова, колонок:', columns.rowCount, '| колонок объединения в david_import_drafts:', draftColumns.rowCount)
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

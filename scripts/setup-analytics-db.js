// Схема analytics_events в yu_scraping под app/api/analytics/route.ts.
// Идемпотентно. Пустую таблицу старого формата (event_type, product_id) заменяет;
// если в ней есть данные — останавливается, переносить их нужно отдельно.
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.ANALYTICS_DATABASE_URL || process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Нужен ANALYTICS_DATABASE_URL (или SCRAPING_DATABASE_URL)');
  process.exit(1);
}
const pool = new Pool({ connectionString });

async function setupAnalytics() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: legacy } = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'analytics_events' AND column_name = 'event_type'
    `);
    if (legacy.length) {
      const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM analytics_events');
      if (count > 0) throw new Error(`analytics_events старого формата содержит ${count} строк — перенесите их вручную`);
      await client.query('DROP TABLE analytics_events');
      console.log('Пустая таблица analytics_events старого формата удалена');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event VARCHAR(64) NOT NULL,
        "productId" VARCHAR(128),
        name TEXT NOT NULL DEFAULT '',
        price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        session_id VARCHAR(128) NOT NULL,
        user_agent TEXT NOT NULL DEFAULT '',
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events (created_at);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created_at ON analytics_events (event, created_at);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events (session_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_product_id ON analytics_events ("productId");
    `);
    await client.query('COMMIT');
    console.log('analytics_events готова');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ошибка схемы аналитики:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

setupAnalytics();

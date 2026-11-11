const { Pool } = require('pg')
require('dotenv').config()

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

/**
 * Учёт расхода ИИ: одна строка = один ответ модели (или неудачный запрос).
 * Привязка к выгрузке, запуску и товару берётся из контекста обработки,
 * стоимость считается при записи по цене модели на тот момент.
 * В ai_providers.pricing хранятся ручные цены моделей провайдера (USD за 1 млн).
 */
async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_events (
        id BIGSERIAL PRIMARY KEY,
        feature TEXT NOT NULL DEFAULT 'other',
        batch_id TEXT,
        run_id TEXT,
        item_id TEXT,
        product_id BIGINT,
        supplier_id INTEGER,
        provider_id TEXT,
        provider_host TEXT,
        model TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(14, 8),
        cost_source TEXT,
        price_period TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON ai_usage_events(created_at DESC)')
    await client.query('CREATE INDEX IF NOT EXISTS ai_usage_events_batch_idx ON ai_usage_events(batch_id, created_at DESC)')
    await client.query("ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS pricing JSONB NOT NULL DEFAULT '{}'::jsonb")
    // 'disabled' — запросы без размышлений модели (DeepSeek thinking, OpenRouter reasoning).
    await client.query("ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS reasoning_mode TEXT NOT NULL DEFAULT 'default'")
    // Флажок «Через прокси»: NULL — умолчание (через пул прокси только byesu.com).
    await client.query('ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS use_proxy BOOLEAN')
    await client.query('COMMIT')
    console.log('ai_usage_events ready')
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

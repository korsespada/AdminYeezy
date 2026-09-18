/**
 * Очередь заданий ИИ для черновиков импорта David Studio.
 *
 * Зачем: на проде у AdminYeezy нет ни модели, ни ключей к ней. Сервер готовит
 * промпт и хранит задание, а модель вызывает локальный воркер через Cockpit
 * своими ключами и возвращает сырой ответ; нормализация и запись черновика —
 * снова на сервере. Это тот же контур, что у batch_ai_items/photo_clean_jobs.
 *
 * Запуск: node scripts/migrate-david-ai-jobs.js
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
      CREATE TABLE IF NOT EXISTS david_ai_jobs (
        id UUID PRIMARY KEY,
        handle TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        lease_expires_at TIMESTAMPTZ,
        worker_id TEXT,
        input JSONB NOT NULL DEFAULT '{}'::jsonb,
        output JSONB,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS david_ai_jobs_status_idx
      ON david_ai_jobs (status, created_at)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS david_ai_jobs_handle_idx
      ON david_ai_jobs (handle, updated_at DESC)
    `)

    await client.query('COMMIT')

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'david_ai_jobs' ORDER BY ordinal_position
    `)
    console.log('david_ai_jobs готова, колонок:', columns.rowCount)
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

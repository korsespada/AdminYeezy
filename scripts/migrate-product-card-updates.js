const { Pool } = require('pg')
require('dotenv').config()

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

/**
 * Очередь обработки уже опубликованных карточек поставщика по правилам выгрузки.
 *
 * Одна строка = один товар каталога. Хранится снимок текущей карточки (чтобы
 * показывать «сейчас / станет» и откатывать решение), предложение по названию,
 * адресу, характеристикам и альтам фото, отдельный статус ИИ-текста и решение
 * оператора. Товары выгрузок здесь не участвуют: источник — опубликованный
 * каталог Rails, прочитанный через API.
 */
async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_card_updates (
        id BIGSERIAL PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        crm_product_id UUID NOT NULL,
        crm_slug TEXT,
        category TEXT,
        category_slug TEXT,
        kind TEXT NOT NULL DEFAULT 'bag',
        status TEXT NOT NULL DEFAULT 'pending',
        current_name TEXT,
        current_slug TEXT,
        current_description TEXT,
        current_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        current_media JSONB NOT NULL DEFAULT '[]'::jsonb,
        proposed_name TEXT,
        proposed_slug TEXT,
        proposed_description TEXT,
        proposed_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        proposed_photo_alts JSONB NOT NULL DEFAULT '[]'::jsonb,
        attribute_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        model_name TEXT,
        size_token TEXT,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        ai_model TEXT,
        ai_error TEXT,
        error TEXT,
        decided_at TIMESTAMPTZ,
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (supplier_id, crm_product_id)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_card_updates_queue_idx
      ON product_card_updates(supplier_id, status, kind, id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_card_updates_product_idx
      ON product_card_updates(crm_product_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_card_updates_ai_idx
      ON product_card_updates(supplier_id, ai_status)
    `)
    // Промпт поставщика для обработки карточек: отдельно от инструкций
    // «Выгрузок», потому что здесь работаем с уже опубликованным каталогом.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_card_supplier_settings (
        supplier_id TEXT PRIMARY KEY,
        ai_prompt TEXT NOT NULL DEFAULT '',
        packaging_text TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    // Комплектация/упаковка добавляется отдельным абзацем описания.
    await client.query(`
      ALTER TABLE product_card_supplier_settings
      ADD COLUMN IF NOT EXISTS packaging_text TEXT NOT NULL DEFAULT ''
    `)
    // Прогон ИИ по всем карточкам поставщика: работает в фоновом супервизоре,
    // поэтому прогресс и признак жизни цикла хранятся в базе.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_card_ai_runs (
        supplier_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        batch_size INTEGER NOT NULL DEFAULT 4,
        processed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        started_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('COMMIT')
    console.log('Product card updates migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Product card updates migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

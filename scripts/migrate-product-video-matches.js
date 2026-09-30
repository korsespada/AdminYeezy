const { Pool } = require('pg')
require('dotenv').config()

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

/**
 * Отдельный раздел для сопоставления альбомов с видео из выгрузки поставщика
 * с товарами опубликованного каталога (Rails CRM).
 *
 * Одна строка = один вариант пары «товар × альбом». У товара может быть
 * несколько вариантов (`rank` 1..N, `candidates_total` = сколько всего),
 * поэтому «однозначным» считается только `candidates_total = 1`.
 */
async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_video_matches (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        source_batch_id TEXT NOT NULL,
        source_product_id INTEGER NOT NULL,
        source_external_id TEXT NOT NULL,
        source_position INTEGER,
        video_source_url TEXT NOT NULL,
        video_poster_url TEXT,
        crm_product_id UUID NOT NULL,
        crm_slug TEXT,
        crm_name TEXT,
        crm_category TEXT,
        crm_status TEXT,
        crm_photo_url TEXT,
        rank INTEGER NOT NULL DEFAULT 1,
        candidates_total INTEGER NOT NULL DEFAULT 1,
        confidence TEXT NOT NULL DEFAULT 'weak',
        score INTEGER NOT NULL DEFAULT 0,
        source_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        crm_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        differences JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        s3_video_url TEXT,
        s3_poster_url TEXT,
        error TEXT,
        decided_at TIMESTAMPTZ,
        applied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_batch_id, source_product_id, crm_product_id)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_video_matches_queue_idx
      ON product_video_matches(source_batch_id, status, rank, score DESC)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_video_matches_product_idx
      ON product_video_matches(crm_product_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_video_matches_supplier_idx
      ON product_video_matches(supplier_id, status)
    `)
    // Товары, которые попали в сборку: строка есть даже когда вариантов нет,
    // иначе «нет совпадений» невозможно отличить от «ещё не считали».
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_video_match_scope (
        source_batch_id TEXT NOT NULL,
        crm_product_id UUID NOT NULL,
        crm_slug TEXT,
        crm_name TEXT,
        crm_category TEXT,
        crm_status TEXT,
        crm_photo_url TEXT,
        candidates INTEGER NOT NULL DEFAULT 0,
        crm_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (source_batch_id, crm_product_id)
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS product_video_match_scope_candidates_idx
      ON product_video_match_scope(source_batch_id, candidates)
    `)
    // Состояние фоновой заливки видео: одна строка на партию, по ней UI понимает,
    // идёт ли процесс, и видит прогресс без открытой вкладки.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_video_match_runs (
        source_batch_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        batch_size INTEGER NOT NULL DEFAULT 2,
        applied INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('COMMIT')
    console.log('Product video matches migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Product video matches migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

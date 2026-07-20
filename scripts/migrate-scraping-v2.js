const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

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
      CREATE TABLE IF NOT EXISTS scraping_v2_runs (
        id TEXT PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'READY_FOR_GROUPING',
        source_kind TEXT NOT NULL DEFAULT 'HISTORICAL_V1',
        source_task_id INTEGER REFERENCES scraping_tasks(id) ON DELETE SET NULL,
        source_batch_id TEXT REFERENCES scraping_batches(id) ON DELETE SET NULL,
        album_count INTEGER NOT NULL DEFAULT 0,
        production_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        last_started_at TIMESTAMPTZ,
        last_completed_at TIMESTAMPTZ,
        last_error TEXT,
        last_received_count INTEGER NOT NULL DEFAULT 0,
        last_inserted_count INTEGER NOT NULL DEFAULT 0,
        last_updated_count INTEGER NOT NULL DEFAULT 0,
        last_unchanged_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT scraping_v2_runs_status_check CHECK (
          status IN ('RUNNING', 'READY_FOR_GROUPING', 'GROUPING', 'READY_FOR_AI', 'FAILED', 'ARCHIVED')
        ),
        CONSTRAINT scraping_v2_runs_source_kind_check CHECK (
          source_kind IN ('HISTORICAL_V1', 'DB_NATIVE')
        ),
        CONSTRAINT scraping_v2_runs_production_push_disabled CHECK (production_push_enabled = FALSE)
      )
    `)

    await client.query(`
      ALTER TABLE scraping_v2_runs
        ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_error TEXT,
        ADD COLUMN IF NOT EXISTS last_received_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_inserted_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_updated_count INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_unchanged_count INTEGER NOT NULL DEFAULT 0
    `)
    await client.query(`
      ALTER TABLE scraping_v2_runs
      DROP CONSTRAINT IF EXISTS scraping_v2_runs_status_check
    `)
    await client.query(`
      ALTER TABLE scraping_v2_runs
      ADD CONSTRAINT scraping_v2_runs_status_check CHECK (
        status IN ('RUNNING', 'READY_FOR_GROUPING', 'GROUPING', 'READY_FOR_AI', 'FAILED', 'ARCHIVED')
      )
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS scraping_v2_runs_source_task_id_idx
      ON scraping_v2_runs (source_task_id)
      WHERE source_task_id IS NOT NULL
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_runs_supplier_created_idx
      ON scraping_v2_runs (supplier_id, created_at DESC)
    `)

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS scraping_v2_runs_active_native_supplier_idx
      ON scraping_v2_runs (supplier_id)
      WHERE source_kind = 'DB_NATIVE' AND status <> 'ARCHIVED'
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_v2_albums (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES scraping_v2_runs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        external_id TEXT NOT NULL,
        source_order INTEGER NOT NULL,
        source_published_at TIMESTAMPTZ,
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        photos JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        content_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (run_id, external_id)
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_albums_run_order_idx
      ON scraping_v2_albums (run_id, source_order)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_albums_supplier_external_idx
      ON scraping_v2_albums (supplier_id, external_id)
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_albums_photos_gin_idx
      ON scraping_v2_albums USING GIN (photos)
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_v2_album_revisions (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES scraping_v2_albums(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        photos JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (album_id, content_hash)
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_album_revisions_album_idx
      ON scraping_v2_album_revisions (album_id, observed_at DESC)
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_v2_product_drafts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES scraping_v2_runs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'GROUPING_DRAFT',
        name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        price NUMERIC(10,2),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT scraping_v2_product_drafts_status_check CHECK (
          status IN ('GROUPING_DRAFT', 'GROUPED', 'READY_FOR_AI', 'NEEDS_REVIEW', 'ARCHIVED')
        )
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_product_drafts_run_idx
      ON scraping_v2_product_drafts (run_id, created_at DESC)
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_v2_draft_albums (
        draft_id TEXT NOT NULL REFERENCES scraping_v2_product_drafts(id) ON DELETE CASCADE,
        album_id TEXT NOT NULL REFERENCES scraping_v2_albums(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'UNASSIGNED',
        use_text BOOLEAN NOT NULL DEFAULT FALSE,
        use_photos BOOLEAN NOT NULL DEFAULT FALSE,
        use_for_ai BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (draft_id, album_id),
        UNIQUE (album_id),
        CONSTRAINT scraping_v2_draft_albums_role_check CHECK (
          role IN (
            'UNASSIGNED',
            'PRIMARY_PHOTOS',
            'PRODUCT_MEDIA',
            'EXTRA_MEDIA',
            'TEXT_ONLY',
            'SIZE_CHART',
            'COMPARISON_OR_AD',
            'IGNORE'
          )
        )
      )
    `)

    // CREATE TABLE IF NOT EXISTS does not update an existing CHECK constraint.
    await client.query(`
      ALTER TABLE scraping_v2_draft_albums
      DROP CONSTRAINT IF EXISTS scraping_v2_draft_albums_role_check
    `)
    await client.query(`
      ALTER TABLE scraping_v2_draft_albums
      ADD CONSTRAINT scraping_v2_draft_albums_role_check CHECK (
        role IN (
          'UNASSIGNED',
          'PRIMARY_PHOTOS',
          'PRODUCT_MEDIA',
          'EXTRA_MEDIA',
          'TEXT_ONLY',
          'SIZE_CHART',
          'COMPARISON_OR_AD',
          'IGNORE'
        )
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_draft_albums_draft_order_idx
      ON scraping_v2_draft_albums (draft_id, sort_order)
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_v2_training_examples (
        id TEXT PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES scraping_v2_runs(id) ON DELETE SET NULL,
        draft_id TEXT REFERENCES scraping_v2_product_drafts(id) ON DELETE SET NULL,
        example JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS scraping_v2_training_examples_supplier_idx
      ON scraping_v2_training_examples (supplier_id, created_at DESC)
    `)

    await client.query('COMMIT')
    console.log('Scraping V2 schema migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Scraping V2 schema migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

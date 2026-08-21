require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })

const { Pool } = require('pg')

const connectionString = process.env.SCRAPING_DATABASE_URL
if (!connectionString) throw new Error('SCRAPING_DATABASE_URL is required')

const pool = new Pool({ connectionString })

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chromoff_ai_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed')),
      total_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS chromoff_ai_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES chromoff_ai_runs(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      input_snapshot JSONB,
      output JSONB,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      UNIQUE (run_id, listing_id)
    );

    ALTER TABLE chromoff_ai_runs
      ADD COLUMN IF NOT EXISTS settings JSONB,
      ADD COLUMN IF NOT EXISTS settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS completed_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    ALTER TABLE chromoff_ai_runs ALTER COLUMN settings DROP NOT NULL;

    UPDATE chromoff_ai_items
    SET status='failed',
        error_message=COALESCE(error_message, 'Старый запуск требует ручного возобновления после обновления AI SEO'),
        completed_at=COALESCE(completed_at, NOW()),
        updated_at=NOW()
    WHERE status IN ('pending', 'running')
      AND run_id IN (SELECT id FROM chromoff_ai_runs WHERE settings IS NOT NULL);

    UPDATE chromoff_ai_runs
    SET status='failed',
        error_message=COALESCE(error_message, 'Старый запуск требует ручного возобновления после обновления AI SEO'),
        updated_at=NOW()
    WHERE status='running' AND settings IS NOT NULL;

    UPDATE chromoff_ai_runs
    SET settings_snapshot=CASE WHEN settings_snapshot='{}'::jsonb THEN settings ELSE settings_snapshot END,
        settings=NULL
    WHERE settings IS NOT NULL;

    ALTER TABLE chromoff_ai_items
      ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS input_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS output JSONB,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_chromoff_ai_runs_created_at
      ON chromoff_ai_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chromoff_ai_items_run_status
      ON chromoff_ai_items(run_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_chromoff_ai_items_listing_created
      ON chromoff_ai_items(listing_id, created_at DESC);
  `)
}

migrate()
  .then(() => console.log('Chromoff AI schema is ready'))
  .finally(() => pool.end())

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
      CREATE TABLE IF NOT EXISTS export_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      ALTER TABLE scraping_batches
        ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES export_folders(id) ON DELETE SET NULL
    `)
    await client.query('CREATE INDEX IF NOT EXISTS scraping_batches_folder_id_idx ON scraping_batches(folder_id)')

    await client.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS allowed_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS allowed_subcategory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS allowed_brand_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    `)
    await client.query(`
      UPDATE suppliers SET allowed_category_ids=jsonb_build_array(default_category)
      WHERE default_category IS NOT NULL AND jsonb_array_length(allowed_category_ids)=0;
      UPDATE suppliers SET allowed_subcategory_ids=jsonb_build_array(default_subcategory)
      WHERE default_subcategory IS NOT NULL AND jsonb_array_length(allowed_subcategory_ids)=0;
      UPDATE suppliers SET allowed_brand_ids=jsonb_build_array(default_brand)
      WHERE default_brand IS NOT NULL AND jsonb_array_length(allowed_brand_ids)=0
    `)

    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS h1 TEXT,
        ADD COLUMN IF NOT EXISTS seo_title TEXT,
        ADD COLUMN IF NOT EXISTS seo_description TEXT,
        ADD COLUMN IF NOT EXISTS slug TEXT,
        ADD COLUMN IF NOT EXISTS photo_alts JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS photo_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS supplier_published_on DATE,
        ADD COLUMN IF NOT EXISTS price_source TEXT NOT NULL DEFAULT 'legacy',
        ADD COLUMN IF NOT EXISTS variant_group_key TEXT,
        ADD COLUMN IF NOT EXISTS ai_error TEXT,
        ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(5,4)
    `)
    await client.query('CREATE INDEX IF NOT EXISTS products_variant_group_key_idx ON products(variant_group_key) WHERE variant_group_key IS NOT NULL')

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_snapshots (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES scraping_batches(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        label TEXT NOT NULL,
        products JSONB NOT NULL,
        settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS batch_snapshots_batch_created_idx ON batch_snapshots(batch_id, created_at DESC)')

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_ai_runs (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES scraping_batches(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'full',
        status TEXT NOT NULL DEFAULT 'queued',
        settings_snapshot JSONB NOT NULL,
        total_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS batch_ai_runs_batch_created_idx ON batch_ai_runs(batch_id, created_at DESC)')
    await client.query('CREATE INDEX IF NOT EXISTS batch_ai_runs_status_idx ON batch_ai_runs(status, created_at)')
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema=current_schema()
            AND table_name='batch_ai_runs'
            AND column_name='catalog_applied_at'
        ) THEN
          ALTER TABLE batch_ai_runs ADD COLUMN catalog_applied_at TIMESTAMPTZ;
          UPDATE batch_ai_runs
          SET catalog_applied_at=COALESCE(completed_at,NOW())
          WHERE mode='media_seo' AND status='completed';
        END IF;
      END $$
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_ai_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES batch_ai_runs(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        external_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        input_snapshot JSONB NOT NULL,
        output JSONB,
        error_message TEXT,
        lease_token TEXT,
        leased_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS batch_ai_items_claim_idx ON batch_ai_items(status, created_at)')
    await client.query('CREATE INDEX IF NOT EXISTS batch_ai_items_run_idx ON batch_ai_items(run_id, status)')

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_ai_suggestions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES batch_ai_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        canonical_key TEXT NOT NULL,
        payload JSONB NOT NULL,
        affected_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        UNIQUE(run_id, kind, canonical_key)
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_price_rules (
        id BIGSERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
        price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        rule_key TEXT,
        visual_hint TEXT,
        reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      ALTER TABLE supplier_price_rules
        ADD COLUMN IF NOT EXISTS rule_key TEXT,
        ADD COLUMN IF NOT EXISTS visual_hint TEXT,
        ADD COLUMN IF NOT EXISTS reference_images JSONB NOT NULL DEFAULT '[]'::jsonb
    `)
    await client.query("UPDATE supplier_price_rules SET rule_key='rule_' || id::text WHERE rule_key IS NULL OR BTRIM(rule_key)=''")
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS supplier_price_rules_key_idx ON supplier_price_rules(supplier_id, rule_key)')
    await client.query('CREATE INDEX IF NOT EXISTS supplier_price_rules_supplier_idx ON supplier_price_rules(supplier_id, enabled, priority DESC)')

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_ai_worker_state (
        worker_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT,
        heartbeat_at TIMESTAMPTZ NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `)

    await client.query(`
      INSERT INTO app_settings (key, value)
      VALUES
        ('batch_ai_provider', 'openrouter'),
        ('batch_ai_openrouter_model', 'google/gemini-2.5-flash'),
        ('batch_ai_temperature', '0.1'),
        ('batch_ai_max_tokens', '5000'),
        ('batch_ai_concurrency', '5'),
        ('batch_ai_system_prompt', '')
      ON CONFLICT (key) DO NOTHING
    `)

    const v2Tables = [
      'scraping_v2_draft_albums',
      'scraping_v2_training_examples',
      'scraping_v2_ai_jobs',
      'scraping_v2_product_drafts',
      'scraping_v2_album_observations',
      'scraping_v2_album_revisions',
      'scraping_v2_albums',
      'scraping_v2_scrape_passes',
      'scraping_v2_runs',
      'scraping_v2_campaigns',
    ]
    for (const table of v2Tables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
    }

    await client.query('COMMIT')
    console.log('Batch AI migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Batch AI migration failed:', error)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

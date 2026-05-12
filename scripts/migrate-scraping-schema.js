const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function migrate() {
  try {
    await pool.query('BEGIN');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        album_id TEXT NOT NULL,
        cookie TEXT,
        group_id TEXT DEFAULT '',
        tag_id TEXT DEFAULT '',
        default_category TEXT,
        default_subcategory TEXT,
        default_brand TEXT,
        min_photos INTEGER DEFAULT 0,
        min_desc TEXT,
        min_desc_len INTEGER DEFAULT 0,
        brand_tags TEXT DEFAULT '',
        aliases TEXT,
        gender TEXT,
        default_price DECIMAL(10,2),
        default_gender TEXT,
        merge_enabled BOOLEAN DEFAULT FALSE,
        ai_photo_enabled BOOLEAN DEFAULT FALSE,
        ai_cache_enabled BOOLEAN DEFAULT FALSE,
        ai_deep_search_enabled BOOLEAN DEFAULT FALSE,
        ai_resize_enabled BOOLEAN DEFAULT FALSE,
        ai_instructions TEXT DEFAULT '',
        avatar_url TEXT,
        post_process_script TEXT,
        ai_photo_models TEXT DEFAULT '',
        ai_photo_instructions TEXT DEFAULT '',
        ai_parallel_enabled BOOLEAN DEFAULT FALSE,
        ai_parallel_count INTEGER DEFAULT 5,
        parse_tags_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS cookie TEXT,
        ADD COLUMN IF NOT EXISTS group_id TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS tag_id TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS default_category TEXT,
        ADD COLUMN IF NOT EXISTS default_subcategory TEXT,
        ADD COLUMN IF NOT EXISTS default_brand TEXT,
        ADD COLUMN IF NOT EXISTS min_photos INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS min_desc TEXT,
        ADD COLUMN IF NOT EXISTS min_desc_len INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS brand_tags TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS aliases TEXT,
        ADD COLUMN IF NOT EXISTS gender TEXT,
        ADD COLUMN IF NOT EXISTS default_price DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS default_gender TEXT,
        ADD COLUMN IF NOT EXISTS merge_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_photo_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_cache_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_deep_search_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_resize_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_instructions TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS avatar_url TEXT,
        ADD COLUMN IF NOT EXISTS post_process_script TEXT,
        ADD COLUMN IF NOT EXISTS ai_photo_models TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS ai_photo_instructions TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS ai_parallel_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_parallel_count INTEGER DEFAULT 5,
        ADD COLUMN IF NOT EXISTS parse_tags_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_batches (
        id TEXT PRIMARY KEY,
        name TEXT,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        items_count INTEGER DEFAULT 0,
        status TEXT,
        stage TEXT DEFAULT 'SCRAPED',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE scraping_batches
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'SCRAPED',
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_tasks (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result_path TEXT,
        items_count INTEGER DEFAULT 0,
        error_message TEXT,
        end_date TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE scraping_tasks
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES scraping_batches(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS result_path TEXT,
        ADD COLUMN IF NOT EXISTS items_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_message TEXT,
        ADD COLUMN IF NOT EXISTS end_date TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        name TEXT,
        description TEXT,
        price DECIMAL(10,2),
        status TEXT,
        brand TEXT[],
        category TEXT,
        subcategory TEXT,
        gender TEXT,
        photos JSONB,
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS external_id TEXT,
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS price DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS brand TEXT[],
        ADD COLUMN IF NOT EXISTS category TEXT,
        ADD COLUMN IF NOT EXISTS subcategory TEXT,
        ADD COLUMN IF NOT EXISTS gender TEXT,
        ADD COLUMN IF NOT EXISTS photos JSONB,
        ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_idx
      ON products (external_id)
      WHERE external_id IS NOT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_cache (
        hash TEXT PRIMARY KEY,
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES
        ('general_ai_rules', ''),
        ('selected_ai_model', 'google/gemini-2.0-flash-lite:free')
      ON CONFLICT (key) DO NOTHING;
    `);

    await pool.query('COMMIT');
    console.log('Scraping schema migration complete');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Scraping schema migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();

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
        szwego_parse_mode TEXT NOT NULL DEFAULT 'images',
        cookie TEXT,
        group_id TEXT DEFAULT '',
        tag_id TEXT DEFAULT '',
        default_category TEXT,
        default_subcategory TEXT,
        default_brand TEXT,
        allowed_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        allowed_subcategory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        allowed_brand_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        default_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
        min_photos INTEGER DEFAULT 0,
        max_on_model_media INTEGER NOT NULL DEFAULT 5,
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
        price_ai_instructions TEXT NOT NULL DEFAULT '',
        avatar_url TEXT,
        post_process_script TEXT,
        post_process_description TEXT NOT NULL DEFAULT '',
        post_process_enabled BOOLEAN DEFAULT FALSE,
        ai_photo_models TEXT DEFAULT '',
        ai_photo_instructions TEXT DEFAULT '',
        ai_parallel_enabled BOOLEAN DEFAULT FALSE,
        ai_parallel_count INTEGER DEFAULT 5,
        parse_tags_enabled BOOLEAN DEFAULT FALSE,
        is_favorite BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS szwego_parse_mode TEXT NOT NULL DEFAULT 'images',
        ADD COLUMN IF NOT EXISTS cookie TEXT,
        ADD COLUMN IF NOT EXISTS group_id TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS tag_id TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS default_category TEXT,
        ADD COLUMN IF NOT EXISTS default_subcategory TEXT,
        ADD COLUMN IF NOT EXISTS default_brand TEXT,
        ADD COLUMN IF NOT EXISTS allowed_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS allowed_subcategory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS allowed_brand_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS default_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS min_photos INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS max_on_model_media INTEGER NOT NULL DEFAULT 5,
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
        ADD COLUMN IF NOT EXISTS price_ai_instructions TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS avatar_url TEXT,
        ADD COLUMN IF NOT EXISTS post_process_script TEXT,
        ADD COLUMN IF NOT EXISTS post_process_description TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS post_process_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_photo_models TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS ai_photo_instructions TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS ai_parallel_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_parallel_count INTEGER DEFAULT 5,
        ADD COLUMN IF NOT EXISTS parse_tags_enabled BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      UPDATE suppliers SET allowed_category_ids=jsonb_build_array(default_category)
      WHERE default_category IS NOT NULL AND jsonb_array_length(allowed_category_ids)=0;
      UPDATE suppliers SET allowed_subcategory_ids=jsonb_build_array(default_subcategory)
      WHERE default_subcategory IS NOT NULL AND jsonb_array_length(allowed_subcategory_ids)=0;
      UPDATE suppliers SET allowed_brand_ids=jsonb_build_array(default_brand)
      WHERE default_brand IS NOT NULL AND jsonb_array_length(allowed_brand_ids)=0;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog_id_mappings (
        entity_type TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        name TEXT NOT NULL,
        legacy_parent_id TEXT,
        canonical_parent_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (entity_type, legacy_id),
        UNIQUE (entity_type, canonical_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog_attribute_definitions (
        code TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        category_scope TEXT NOT NULL DEFAULT 'Все категории',
        value_type TEXT NOT NULL DEFAULT 'text',
        show_as_characteristic BOOLEAN NOT NULL DEFAULT TRUE,
        use_as_filter BOOLEAN NOT NULL DEFAULT FALSE,
        use_as_variant_dimension BOOLEAN NOT NULL DEFAULT FALSE,
        parser_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog_attribute_values (
        id BIGSERIAL PRIMARY KEY,
        attribute_code TEXT NOT NULL REFERENCES catalog_attribute_definitions(code) ON DELETE CASCADE,
        canonical_value TEXT NOT NULL,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (attribute_code, canonical_value)
      );
    `);

    await pool.query(`
      UPDATE suppliers
      SET default_gender = CASE
        WHEN lower(trim(default_gender)) IN ('для мужчин', 'мужской', 'male') THEN 'male'
        WHEN lower(trim(default_gender)) IN ('для женщин', 'женский', 'female') THEN 'female'
        WHEN lower(trim(default_gender)) IN ('унисекс', 'unisex') THEN 'unisex'
        ELSE NULL
      END
      WHERE default_gender IS NOT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_batches (
        id TEXT PRIMARY KEY,
        name TEXT,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        items_count INTEGER DEFAULT 0,
        status TEXT,
        stage TEXT DEFAULT 'SCRAPED',
        catalog_deleted_at TIMESTAMPTZ,
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
        ADD COLUMN IF NOT EXISTS catalog_deleted_at TIMESTAMPTZ,
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
      CREATE TABLE IF NOT EXISTS scraping_files (
        id SERIAL PRIMARY KEY,
        task_id INTEGER UNIQUE REFERENCES scraping_tasks(id) ON DELETE CASCADE,
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        status TEXT,
        file_name TEXT NOT NULL,
        result_path TEXT,
        mime_type TEXT DEFAULT 'text/csv',
        size_bytes INTEGER DEFAULT 0,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE scraping_files
        ADD COLUMN IF NOT EXISTS task_id INTEGER UNIQUE REFERENCES scraping_tasks(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS file_name TEXT,
        ADD COLUMN IF NOT EXISTS result_path TEXT,
        ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT 'text/csv',
        ADD COLUMN IF NOT EXISTS size_bytes INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS content TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS scraping_files_batch_id_idx
      ON scraping_files (batch_id);
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS scraping_files_task_id_idx
      ON scraping_files (task_id)
      WHERE task_id IS NOT NULL;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS scraping_files_result_path_idx
      ON scraping_files (result_path);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS scraping_files_file_name_idx
      ON scraping_files (file_name);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        external_id TEXT,
        name TEXT,
        description TEXT,
        price DECIMAL(10,2),
        status TEXT,
        brand TEXT,
        category TEXT,
        subcategory TEXT,
        gender TEXT,
        photos JSONB,
        slug TEXT,
        photo_alts JSONB NOT NULL DEFAULT '[]'::jsonb,
        photo_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        supplier_published_on DATE,
        source_position INTEGER,
        ai_processed BOOLEAN DEFAULT FALSE,
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS source_position INTEGER,
        ADD COLUMN IF NOT EXISTS external_id TEXT,
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS price DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS brand TEXT,
        ADD COLUMN IF NOT EXISTS category TEXT,
        ADD COLUMN IF NOT EXISTS subcategory TEXT,
        ADD COLUMN IF NOT EXISTS gender TEXT,
        ADD COLUMN IF NOT EXISTS photos JSONB,
        ADD COLUMN IF NOT EXISTS slug TEXT,
        ADD COLUMN IF NOT EXISTS photo_alts JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS photo_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS supplier_published_on DATE,
        ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_batch_external_id_idx
      ON products (batch_id, external_id);
    `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS products_batch_id_idx
      ON products (batch_id);

    CREATE INDEX IF NOT EXISTS products_attributes_gin_idx
      ON products USING GIN (attributes);
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

const { Pool } = require('pg');
require('dotenv').config();

async function init() {
  const connectionString = process.env.SCRAPING_DATABASE_URL;
  
  if (!connectionString) {
    console.error('Error: SCRAPING_DATABASE_URL not found in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    console.log('Connecting to scraping database and dropping old tables...');
    
    await pool.query('DROP TABLE IF EXISTS products CASCADE');
    await pool.query('DROP TABLE IF EXISTS scraping_tasks CASCADE');
    await pool.query('DROP TABLE IF EXISTS scraping_batches CASCADE');
    await pool.query('DROP TABLE IF EXISTS suppliers CASCADE');

    console.log('Creating fresh tables with EXACT matching columns...');

    // 1. Поставщики
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT,
        album_id TEXT,
        szwego_parse_mode TEXT NOT NULL DEFAULT 'images',
        default_category TEXT,
        default_subcategory TEXT,
        default_brand TEXT,
        default_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
        min_photos INTEGER,
        max_on_model_media INTEGER NOT NULL DEFAULT 5,
        min_desc TEXT,
        min_desc_len INTEGER,
        brand_tags TEXT,
        aliases TEXT,
        gender TEXT,
        default_price DECIMAL(10,2),
        default_gender TEXT,
        merge_enabled BOOLEAN,
        ai_photo_enabled BOOLEAN,
        post_process_script TEXT,
        post_process_description TEXT NOT NULL DEFAULT '',
        post_process_enabled BOOLEAN DEFAULT FALSE,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
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

    // 2. Партии
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_batches (
        id TEXT PRIMARY KEY,
        name TEXT,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        items_count INTEGER,
        status TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 3. Задачи
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_tasks (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
        status TEXT,
        result_path TEXT,
        items_count INTEGER,
        error_message TEXT,
        end_date TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 4. Товары (черновики)
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
        source_position INTEGER,
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS products_batch_external_id_idx
      ON products (batch_id, external_id);
    `);

    console.log('✅ Scraping database PERFECTLY re-initialized!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  }
}

init();

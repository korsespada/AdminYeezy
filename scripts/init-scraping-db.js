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
        default_category TEXT,
        default_subcategory TEXT,
        default_brand TEXT,
        min_photos INTEGER,
        min_desc TEXT,
        min_desc_len INTEGER,
        brand_tags TEXT,
        aliases TEXT,
        gender TEXT,
        default_price DECIMAL(10,2),
        default_gender TEXT,
        merge_enabled BOOLEAN,
        ai_photo_enabled BOOLEAN,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
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
        batch_id TEXT REFERENCES scraping_batches(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ Scraping database PERFECTLY re-initialized!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  }
}

init();

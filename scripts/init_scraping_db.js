const { Client } = require('pg');
require('dotenv').config();

async function init() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database');

    await client.query(`
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
        avatar_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ Table "suppliers" created');

    await client.query(`
      CREATE TABLE IF NOT EXISTS scraping_tasks (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        end_date TEXT,
        result_path TEXT,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✓ Table "scraping_tasks" created');

    await client.end();
    console.log('Database initialization complete');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

init();

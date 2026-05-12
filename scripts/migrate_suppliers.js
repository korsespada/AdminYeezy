const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function migrate() {
  try {
    console.log('Adding new columns to suppliers table...');
    await pool.query(`
      ALTER TABLE suppliers 
      ADD COLUMN IF NOT EXISTS ai_deep_search_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_resize_enabled BOOLEAN DEFAULT TRUE;
    `);
    console.log('Success! Columns added.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();

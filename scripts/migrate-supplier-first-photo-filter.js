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
    await pool.query(`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS first_photo_screenshot_filter BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log('suppliers.first_photo_screenshot_filter is ready');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();

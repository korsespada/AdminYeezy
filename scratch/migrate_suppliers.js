
const { Pool } = require('pg');
require('dotenv').config();

const scrapingPool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function migrate() {
  try {
    console.log('Adding ai_photo_models column to suppliers table...');
    await scrapingPool.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ai_photo_models TEXT');
    console.log('Column added successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await scrapingPool.end();
  }
}

migrate();


const { Pool } = require('pg');
require('dotenv').config();

const scrapingPool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function run() {
  try {
    console.log('Connecting to technical DB...');
    await scrapingPool.query(`
      ALTER TABLE suppliers 
      ADD COLUMN IF NOT EXISTS ai_parallel_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_parallel_count INTEGER DEFAULT 5;
    `);
    console.log('Columns added successfully!');
  } catch (err) {
    console.error('SQL Error:', err.message);
  } finally {
    await scrapingPool.end();
  }
}

run();

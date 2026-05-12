
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding parallel processing columns to suppliers...');
    await client.query(`
      ALTER TABLE suppliers 
      ADD COLUMN IF NOT EXISTS ai_parallel_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ai_parallel_count INTEGER DEFAULT 5;
    `);
    console.log('Success!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();


const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function check() {
  try {
    console.log('Checking scraping_batches table...');
    const resBatches = await pool.query('SELECT id, name, stage FROM scraping_batches ORDER BY created_at DESC LIMIT 5');
    console.log('Recent batches:', resBatches.rows);

    console.log('\nChecking scraping_tasks table...');
    const resTasks = await pool.query('SELECT id, status, batch_id, result_path FROM scraping_tasks ORDER BY created_at DESC LIMIT 5');
    console.log('Recent tasks:', resTasks.rows);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();

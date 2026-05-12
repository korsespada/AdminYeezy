const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS avatar_url TEXT');
    console.log('Added avatar_url column to suppliers table.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}
run();

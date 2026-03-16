const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function test() {
  try {
    // Проверяем osList
    const osRes = await pool.query(`
      SELECT meta->>'os' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE 1=1 AND meta->>'os' IS NOT NULL
      GROUP BY name ORDER BY visitors DESC LIMIT 5
    `);
    console.log('OS List:', osRes.rows);
    
    // Проверяем countryList
    const countryRes = await pool.query(`
      SELECT meta->>'country' as name, COUNT(DISTINCT session_id) as visitors
      FROM analytics_events
      WHERE 1=1 AND meta->>'country' IS NOT NULL
      GROUP BY name ORDER BY visitors DESC LIMIT 5
    `);
    console.log('Country List:', countryRes.rows);

    // Проверим какие значения есть в meta
    const sample = await pool.query(`
      SELECT DISTINCT meta->>'os' as os, meta->>'country' as country
      FROM analytics_events
      WHERE meta->>'os' IS NOT NULL OR meta->>'country' IS NOT NULL
      LIMIT 10
    `);
    console.log('Sample meta values:', sample.rows);
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

test();

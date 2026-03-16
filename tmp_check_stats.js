
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    const res = await pool.query('SELECT event_type, count(*) FROM analytics_events GROUP BY event_type');
    console.log('Stats in DB:', res.rows);
    
    const lastEvents = await pool.query('SELECT created_at FROM analytics_events ORDER BY created_at DESC LIMIT 5');
    console.log('Last events:', lastEvents.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();

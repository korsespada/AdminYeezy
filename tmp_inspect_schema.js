
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    const tableInfo = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'analytics_events'
    `);
    console.log('Columns in analytics_events:', tableInfo.rows);
    
    const sample = await pool.query('SELECT * FROM analytics_events LIMIT 5');
    console.log('Sample rows:', sample.rows);

    const eventCounts = await pool.query('SELECT event_type, count(*) FROM analytics_events GROUP BY event_type').catch(e => e.message);
    console.log('Event type counts (if event_type exists):', eventCounts);

    const eventNameCounts = await pool.query('SELECT event, count(*) FROM analytics_events GROUP BY event').catch(e => e.message);
    console.log('Event counts (if event exists):', eventNameCounts);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
check();

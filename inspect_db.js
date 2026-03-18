
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  try {
    const resNow = await pool.query('SELECT NOW()');
    console.log('Postgres NOW():', resNow.rows[0].now);

    const resCheckFields = await pool.query(`
      SELECT event, "productId", name, created_at 
      FROM analytics_events 
      WHERE event = 'product_view' 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    console.log('Recent product_view fields:', resCheckFields.rows);
    
    const resJoinTest = await pool.query('SELECT ae."productId", p.id FROM analytics_events ae LEFT JOIN products p ON p.id = ae."productId" WHERE ae."productId" IS NOT NULL LIMIT 5');
    console.log('Join test (ae.productId -> p.id):', resJoinTest.rows);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();

async function testApi() {
  const { Pool } = require('pg');
  require('dotenv').config();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const res = await pool.query(`
      SELECT 
        event, 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE "productId" IS NULL OR "productId" = '') as empty_id,
        COUNT(*) FILTER (WHERE "productId" IS NOT NULL AND "productId" != '') as has_id
      FROM analytics_events 
      WHERE created_at >= NOW() - INTERVAL '1 day'
      GROUP BY event
    `);
    console.log('Database Check (Last 24h):');
    console.table(res.rows);
  } catch (err) {
    console.error('DB Error:', err.message);
  } finally {
    await pool.end();
  }
}
testApi();

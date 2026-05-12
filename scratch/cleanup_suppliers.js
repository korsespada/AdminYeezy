const { Pool } = require('pg');
require('dotenv').config();

async function cleanup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('--- Cleaning up suppliers metadata ---');
    
    // 1. Remove "Группа: ..." patterns from group_id
    const res = await pool.query(`
      UPDATE suppliers 
      SET group_id = '' 
      WHERE group_id LIKE 'Группа: %' OR group_id LIKE '%=%'
    `);
    
    console.log(`Cleaned up ${res.rowCount} suppliers.`);
    
  } catch (err) {
    console.error('Cleanup failed:', err);
  } finally {
    await pool.end();
  }
}

cleanup();

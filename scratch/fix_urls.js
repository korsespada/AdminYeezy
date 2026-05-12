const { Pool } = require('pg');
require('dotenv').config();

async function fix() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query(`
      UPDATE products 
      SET photos = replace(photos::text, '85758a34b2c7-yeezyunique-static.s3.ru1.storage.beget.cloud', 'static.yeezyunique.ru')::jsonb 
      WHERE photos::text LIKE '%beget.cloud%'
    `);
    console.log('Updated rows in Main DB:', res.rowCount);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }

  // Also fix the CSV file
  const fs = require('fs');
  const path = 'tmp/task_9.csv';
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, 'utf8');
    content = content.replace(/85758a34b2c7-yeezyunique-static\.s3\.ru1\.storage\.beget\.cloud/g, 'static.yeezyunique.ru');
    fs.writeFileSync(path, content);
    console.log('CSV file fixed');
  }
}

fix();

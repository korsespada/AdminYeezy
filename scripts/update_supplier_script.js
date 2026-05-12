require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL
});

async function main() {
  const result = await pool.query(
    "UPDATE suppliers SET post_process_script = 'process_task_151.py' WHERE id = 58 RETURNING id, name, post_process_script"
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}

main().catch(console.error);

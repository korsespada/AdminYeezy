const { Pool } = require('pg');
require('dotenv').config();
const p = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const tables = ['suppliers', 'scraping_tasks', 'scraping_batches', 'products'];
  for(const t of tables) {
    const r = await p.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [t]);
    console.log(t + ': ' + r.rows.map(row => row.column_name).sort().join(', '));
  }
  p.end();
}
run();

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log('Tables:', tables.rows.map(r => r.table_name));
  
  // Try common names
  const brandTable = tables.rows.find(r => r.table_name.toLowerCase().includes('brand'))?.table_name;
  if (brandTable) {
    const res = await pool.query(`SELECT id, name FROM ${brandTable}`);
    console.log('Brands:', JSON.stringify(res.rows));
  } else {
    console.log('Brand table not found');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  
  const brands = await client.query('SELECT id, name FROM brands');
  const subcats = await client.query('SELECT id, name FROM subcategories');
  
  console.log('--- BRANDS ---');
  brands.rows.forEach(r => console.log(`${r.id}: ${r.name}`));
  
  console.log('--- SUBCATS ---');
  subcats.rows.forEach(r => console.log(`${r.id}: ${r.name}`));
  
  await client.end();
}

main().catch(console.error);

const { Client } = require('pg');
require('dotenv').config();

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database');

    await client.query(`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);
    console.log('✓ Column "avatar_url" added to "suppliers" table');

    await client.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

migrate();

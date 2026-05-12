const { Client } = require('pg');
require('dotenv').config();

const suppliers = [
  { name: 'Supplier 1 (Example)', album_id: 'A20180101000000', cookie: 'your_cookie_here' },
  { name: 'Supplier 2 (Example)', album_id: 'A20190101000000', cookie: 'your_cookie_here' }
];

async function seed() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    for (const s of suppliers) {
      await client.query(
        'INSERT INTO suppliers (name, album_id, cookie) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [s.name, s.album_id, s.cookie]
      );
    }
    console.log('Seed complete');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

seed();

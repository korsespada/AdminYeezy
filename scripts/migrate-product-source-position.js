require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS source_position INTEGER');
    await client.query(`
      WITH positions AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY id) - 1 AS position
        FROM products
        WHERE source_position IS NULL
      )
      UPDATE products p
      SET source_position = positions.position
      FROM positions
      WHERE positions.id = p.id
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS products_batch_source_position_idx
      ON products(batch_id, source_position, id)
    `);
    await client.query('COMMIT');
    console.log('Product source positions migrated.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});

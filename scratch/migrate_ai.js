const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function migrate() {
  try {
    console.log('Starting migrations...');
    
    // 1. Add ai_instructions to suppliers
    await pool.query(`
      ALTER TABLE suppliers 
      ADD COLUMN IF NOT EXISTS ai_instructions TEXT;
    `);
    console.log('Column suppliers.ai_instructions added.');

    // 2. Add ai_processed to products and batches in tech DB
    await pool.query(`
      ALTER TABLE products 
      ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE;
      
      ALTER TABLE scraping_batches
      ADD COLUMN IF NOT EXISTS ai_processed BOOLEAN DEFAULT FALSE;
    `);
    console.log('Columns ai_processed added.');

    // 3. Create app_settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table app_settings created.');

    // 4. Initialize general_ai_rules if not exists
    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES ('general_ai_rules', '')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('Initialized general_ai_rules setting.');

    console.log('Migrations completed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();

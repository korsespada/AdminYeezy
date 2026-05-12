const { Client } = require('pg');

async function migrate() {
  const client = new Client({
    connectionString: "postgresql://shop_user:shop_pass_very_strong@85.198.97.100:5432/yeezy_scraping"
  });

  try {
    await client.connect();
    console.log('Connected to DB');
    
    await client.query("ALTER TABLE scraping_tasks ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50);");
    console.log('Column "batch_id" added to scraping_tasks');

  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

migrate();

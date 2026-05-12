const { Client } = require('pg');

async function migrate() {
  const client = new Client({
    connectionString: "postgresql://shop_user:shop_pass_very_strong@85.198.97.100:5432/yeezy_scraping"
  });

  try {
    await client.connect();
    console.log('Connected to DB');
    
    await client.query("ALTER TABLE scraping_batches ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'SCRAPED';");
    console.log('Column "stage" added successfully to scraping_batches');
    
    // Также заполним существующие записи, чтобы они не были пустыми
    await client.query("UPDATE scraping_batches SET stage = 'SCRAPED' WHERE stage IS NULL;");
    console.log('Existing records updated');

  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

migrate();

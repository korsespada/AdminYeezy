const { Client } = require('pg');

async function checkSchema() {
  const client = new Client({
    connectionString: "postgresql://shop_user:shop_pass_very_strong@85.198.97.100:5432/yeezy_scraping"
  });

  try {
    await client.connect();
    const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'scraping_tasks';");
    console.log('Columns in scraping_tasks:', res.rows.map(r => r.column_name).join(', '));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

checkSchema();

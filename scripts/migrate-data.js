const { Pool } = require('pg');
require('dotenv').config();

async function migrate() {
  const oldUrl = process.env.DATABASE_URL;
  const newUrl = process.env.SCRAPING_DATABASE_URL;

  if (!oldUrl || !newUrl || oldUrl === newUrl) {
    console.error('Error: DATABASE_URL and SCRAPING_DATABASE_URL must be different and exist in .env');
    process.exit(1);
  }

  const oldPool = new Pool({ connectionString: oldUrl });
  const newPool = new Pool({ connectionString: newUrl });

  try {
    console.log('🚀 Starting migration...');

    // 1. Поставщики
    console.log('Migrating suppliers...');
    const suppliersRes = await oldPool.query('SELECT * FROM suppliers');
    for (const s of suppliersRes.rows) {
      const keys = Object.keys(s);
      const values = Object.values(s);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      
      await newPool.query(
        `INSERT INTO suppliers (${columns}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values
      );
    }
    console.log(`✅ Migrated ${suppliersRes.rows.length} suppliers`);

    // 2. Партии (batches)
    console.log('Migrating batches...');
    const batchesRes = await oldPool.query('SELECT * FROM scraping_batches');
    for (const b of batchesRes.rows) {
      const keys = Object.keys(b);
      const values = Object.values(b);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      
      await newPool.query(
        `INSERT INTO scraping_batches (${columns}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values
      );
    }
    console.log(`✅ Migrated ${batchesRes.rows.length} batches`);

    // 3. Задачи (tasks)
    console.log('Migrating tasks...');
    const tasksRes = await oldPool.query('SELECT * FROM scraping_tasks');
    for (const t of tasksRes.rows) {
      const keys = Object.keys(t);
      const values = Object.values(t);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      
      await newPool.query(
        `INSERT INTO scraping_tasks (${columns}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values
      );
    }
    console.log(`✅ Migrated ${tasksRes.rows.length} tasks`);

    console.log('✨ Migration finished successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();

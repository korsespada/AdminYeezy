require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
});

async function migrate() {
  await pool.query(`
    UPDATE scraping_tasks
    SET result_path = CASE
      WHEN status IN ('Сырой CSV', 'Сырой товар', 'completed')
        THEN 'db://batch/' || batch_id || '/raw'
      WHEN status = 'Обработано скриптом'
        THEN 'db://batch/' || batch_id || '/script'
      WHEN status = 'Обработано ИИ'
        THEN 'db://batch/' || batch_id || '/ai'
      ELSE result_path
    END,
    status = CASE
      WHEN status IN ('Сырой CSV', 'completed') THEN 'Сырой товар'
      ELSE status
    END,
    updated_at = NOW()
    WHERE batch_id IS NOT NULL
      AND status IN ('Сырой CSV', 'Сырой товар', 'completed', 'Обработано скриптом', 'Обработано ИИ')
      AND (
        COALESCE(result_path, '') NOT LIKE 'db://%'
        OR status IN ('Сырой CSV', 'completed')
      )
  `);
  console.log('Task history now points to JSONB batch stages.');
  await pool.end();
}

migrate().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});

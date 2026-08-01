const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({ connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL })

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_operation_locks (
        batch_id TEXT PRIMARY KEY REFERENCES scraping_batches(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_publications (
        batch_id TEXT NOT NULL REFERENCES scraping_batches(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        rails_product_id TEXT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(batch_id, external_id)
      )
    `)
    await client.query('ALTER TABLE batch_publications ADD COLUMN IF NOT EXISTS payload_hash TEXT')
    await client.query('CREATE INDEX IF NOT EXISTS batch_publications_external_idx ON batch_publications(external_id, published_at DESC)')
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS batch_ai_runs_one_active_per_batch_idx
      ON batch_ai_runs(batch_id) WHERE status IN ('queued','running')
    `)
    await client.query(`
      WITH duplicate_running AS (
        SELECT id,ROW_NUMBER() OVER(PARTITION BY supplier_id ORDER BY updated_at DESC,id DESC) AS row_number
        FROM scraping_tasks WHERE status='running'
      )
      UPDATE scraping_tasks SET status='failed',error_message='Остановлено миграцией: дублирующий активный запуск',updated_at=NOW()
      WHERE id IN (SELECT id FROM duplicate_running WHERE row_number>1)
    `)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS scraping_tasks_one_running_per_supplier_idx
      ON scraping_tasks(supplier_id) WHERE status='running'
    `)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE scraping_tasks ADD CONSTRAINT scraping_tasks_batch_id_fkey
          FOREIGN KEY(batch_id) REFERENCES scraping_batches(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `)
    await client.query(`
      INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
      SELECT gen_random_uuid()::text,b.id,'SCRAPED','Сырой товар',current.products,'{}'::jsonb
      FROM scraping_batches b
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb) AS products
        FROM products p WHERE p.batch_id=b.id
      ) current
      WHERE b.stage='SCRAPED' AND jsonb_array_length(current.products)>0
        AND NOT EXISTS(SELECT 1 FROM batch_snapshots s WHERE s.batch_id=b.id AND s.stage='SCRAPED')
    `)
    await client.query(`
      INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
      SELECT gen_random_uuid()::text,b.id,'SCRIPT_PROCESSED','Обработан скриптом',current.products,'{}'::jsonb
      FROM scraping_batches b
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb) AS products
        FROM products p WHERE p.batch_id=b.id
      ) current
      WHERE b.stage='SCRIPT_PROCESSED' AND jsonb_array_length(current.products)>0
        AND NOT EXISTS(SELECT 1 FROM batch_snapshots s WHERE s.batch_id=b.id AND s.stage='SCRIPT_PROCESSED')
    `)
    await client.query(`
      INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
      SELECT gen_random_uuid()::text,b.id,'AI_PROCESSED','Обработано ИИ',current.products,'{}'::jsonb
      FROM scraping_batches b
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb) AS products
        FROM products p WHERE p.batch_id=b.id
      ) current
      WHERE b.stage IN ('AI_PROCESSED','PUSHED') AND jsonb_array_length(current.products)>0
        AND NOT EXISTS(SELECT 1 FROM batch_snapshots s WHERE s.batch_id=b.id AND s.stage='AI_PROCESSED')
    `)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE scraping_tasks ADD CONSTRAINT scraping_tasks_completed_requires_batch
          CHECK (batch_id IS NOT NULL OR status IN ('pending','running','failed'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `)
    await client.query("ALTER TABLE products ALTER COLUMN batch_id SET NOT NULL")
    await client.query("ALTER TABLE products ALTER COLUMN external_id SET NOT NULL")
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE products ADD CONSTRAINT products_external_id_not_blank CHECK (BTRIM(external_id) <> '');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `)
    await client.query(`
      DELETE FROM batch_snapshots s
      USING (
        SELECT id,row_number FROM (
          SELECT id,label,ROW_NUMBER() OVER (
            PARTITION BY batch_id,
              CASE
                WHEN label LIKE 'До AI · %' THEN 'before_ai'
                WHEN label LIKE 'Обработано ИИ%' THEN 'ai_done'
                WHEN label LIKE 'Частично обработано ИИ%' OR label LIKE 'AI-тест%' THEN 'ai_partial'
                ELSE label
              END
            ORDER BY created_at DESC
          ) AS row_number
          FROM batch_snapshots
          WHERE label NOT IN ('Сырой товар','Обработан скриптом')
        ) AS old WHERE old.row_number > 10
      ) doomed
      WHERE s.id=doomed.id
    `)
    await client.query(`
      UPDATE scraping_batches b SET items_count=current.count,updated_at=NOW()
      FROM (
        SELECT b2.id,COUNT(p.id)::int AS count
        FROM scraping_batches b2 LEFT JOIN products p ON p.batch_id=b2.id
        WHERE b2.stage NOT IN ('DELETED_FROM_DB','ADMIN_DELETED')
        GROUP BY b2.id
      ) current
      WHERE b.id=current.id AND b.items_count<>current.count
    `)
    await client.query('COMMIT')
    console.log('Batch workflow hardening migration complete')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((error) => {
  console.error('Batch workflow hardening migration failed:', error.message)
  process.exitCode = 1
})

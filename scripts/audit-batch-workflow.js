const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({ connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL })

const checks = [
  ['products without batch', `SELECT COUNT(*)::int AS count FROM products p LEFT JOIN scraping_batches b ON b.id=p.batch_id WHERE b.id IS NULL`],
  ['snapshots without batch', `SELECT COUNT(*)::int AS count FROM batch_snapshots s LEFT JOIN scraping_batches b ON b.id=s.batch_id WHERE b.id IS NULL`],
  ['tasks with missing batch', `SELECT COUNT(*)::int AS count FROM scraping_tasks t LEFT JOIN scraping_batches b ON b.id=t.batch_id WHERE t.batch_id IS NOT NULL AND b.id IS NULL`],
  ['AI runs without batch', `SELECT COUNT(*)::int AS count FROM batch_ai_runs r LEFT JOIN scraping_batches b ON b.id=r.batch_id WHERE b.id IS NULL`],
  ['publications without batch', `SELECT COUNT(*)::int AS count FROM batch_publications p LEFT JOIN scraping_batches b ON b.id=p.batch_id WHERE b.id IS NULL`],
  ['blank external_id', `SELECT COUNT(*)::int AS count FROM products WHERE BTRIM(external_id)=''`],
  ['batch count mismatch', `SELECT COUNT(*)::int AS count FROM scraping_batches b WHERE b.stage NOT IN ('DELETED_FROM_DB','ADMIN_DELETED') AND b.items_count<>(SELECT COUNT(*) FROM products p WHERE p.batch_id=b.id)`],
  ['duplicate running scraper', `SELECT COUNT(*)::int AS count FROM (SELECT supplier_id FROM scraping_tasks WHERE status='running' GROUP BY supplier_id HAVING COUNT(*)>1) duplicates`],
  ['duplicate active AI run', `SELECT COUNT(*)::int AS count FROM (SELECT batch_id FROM batch_ai_runs WHERE status IN ('queued','running') GROUP BY batch_id HAVING COUNT(*)>1) duplicates`],
  ['stale operation lock', `SELECT COUNT(*)::int AS count FROM batch_operation_locks WHERE updated_at<NOW()-INTERVAL '6 hours'`],
  ['completed task without batch', `SELECT COUNT(*)::int AS count FROM scraping_tasks WHERE batch_id IS NULL AND status NOT IN ('pending','running','failed')`],
  ['duplicate external_id inside batch', `SELECT COUNT(*)::int AS count FROM (SELECT batch_id,external_id FROM products GROUP BY batch_id,external_id HAVING COUNT(*)>1) duplicates`],
  ['supplier defaults still using legacy ids', `SELECT COUNT(*)::int AS count FROM suppliers s WHERE EXISTS(SELECT 1 FROM catalog_id_mappings m WHERE s.default_brand=m.legacy_id OR s.default_category=m.legacy_id OR s.default_subcategory=m.legacy_id)`],
]

const observations = [
  ['historical batches without raw snapshot', `SELECT COUNT(*)::int AS count FROM scraping_batches b WHERE b.stage NOT IN ('DELETED_FROM_DB','ADMIN_DELETED') AND EXISTS(SELECT 1 FROM products p WHERE p.batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM batch_snapshots s WHERE s.batch_id=b.id AND s.stage='SCRAPED')`],
  ['historical AI batches without AI snapshot', `SELECT COUNT(*)::int AS count FROM scraping_batches b WHERE b.stage IN ('AI_PROCESSED','PUSHED') AND NOT EXISTS(SELECT 1 FROM batch_snapshots s WHERE s.batch_id=b.id AND s.stage='AI_PROCESSED')`],
  ['historical PUSHED batches without publication registry', `SELECT COUNT(*)::int AS count FROM scraping_batches b WHERE b.stage='PUSHED' AND NOT EXISTS(SELECT 1 FROM batch_publications p WHERE p.batch_id=b.id)`],
  ['historical empty batches', `SELECT COUNT(*)::int AS count FROM scraping_batches b WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.batch_id=b.id)`],
  ['products without photos', `SELECT COUNT(*)::int AS count FROM products WHERE jsonb_array_length(COALESCE(photos,'[]'::jsonb))=0`],
]

async function audit() {
  let failures = 0
  for (const [name, sql] of checks) {
    const result = await pool.query(sql)
    const count = Number(result.rows[0]?.count || 0)
    console.log(`${count === 0 ? 'OK' : 'FAIL'} ${name}: ${count}`)
    if (count !== 0) failures += 1
  }
  for (const [name, sql] of observations) {
    const result = await pool.query(sql)
    const count = Number(result.rows[0]?.count || 0)
    console.log(`${count === 0 ? 'OK' : 'INFO'} ${name}: ${count}`)
  }
  await pool.end()
  if (failures) throw new Error(`Batch workflow audit failed: ${failures} check(s)`)
  console.log('Batch workflow audit complete')
}

audit().catch(async (error) => {
  console.error(error.message)
  await pool.end().catch(() => undefined)
  process.exitCode = 1
})

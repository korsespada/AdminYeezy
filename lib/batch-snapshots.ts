import crypto from 'crypto'
import { scrapingQuery } from '@/lib/db'

export async function recordBatchSnapshot(batchId: string, stage: string, label: string, settings: any = {}) {
  const products = await scrapingQuery(
    'SELECT * FROM products WHERE batch_id=$1 ORDER BY source_position ASC NULLS LAST, id',
    [batchId],
  )
  const id = crypto.randomUUID()
  await scrapingQuery(`
    INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
  `, [id, batchId, stage, label, JSON.stringify(products.rows), JSON.stringify(settings || {})])
  return id
}

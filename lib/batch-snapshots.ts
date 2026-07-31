import crypto from 'crypto'
import { scrapingQuery } from '@/lib/db'

export async function recordBatchSnapshot(batchId: string, stage: string, label: string, settings: any = {}) {
  const products = await scrapingQuery(
    'SELECT * FROM products WHERE batch_id=$1 ORDER BY source_position ASC NULLS LAST, id',
    [batchId],
  )
  const id = crypto.randomUUID()
  const serializedProducts = JSON.stringify(products.rows)
  const serializedSettings = JSON.stringify(settings || {})
  const duplicate = await scrapingQuery(`
    SELECT id FROM batch_snapshots
    WHERE batch_id=$1 AND stage=$2 AND label=$3 AND products=$4::jsonb AND settings_snapshot=$5::jsonb
    ORDER BY created_at DESC LIMIT 1
  `, [batchId, stage, label, serializedProducts, serializedSettings])
  if (duplicate.rows[0]) return String(duplicate.rows[0].id)
  await scrapingQuery(`
    INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
  `, [id, batchId, stage, label, serializedProducts, serializedSettings])
  if (!['Сырой товар','Обработан скриптом'].includes(label)) {
    await scrapingQuery(`
      DELETE FROM batch_snapshots s USING (
        SELECT id,row_number FROM (
          SELECT id,label,ROW_NUMBER() OVER (
            PARTITION BY CASE
              WHEN label LIKE 'До AI · %' THEN 'before_ai'
              WHEN label LIKE 'Обработано ИИ%' THEN 'ai_done'
              WHEN label LIKE 'Частично обработано ИИ%' OR label LIKE 'AI-тест%' THEN 'ai_partial'
              ELSE label
            END ORDER BY created_at DESC
          ) AS row_number
          FROM batch_snapshots WHERE batch_id=$1
            AND label NOT IN ('Сырой товар','Обработан скриптом')
        ) ranked WHERE row_number>10
      ) old WHERE s.id=old.id
    `, [batchId])
  }
  return id
}

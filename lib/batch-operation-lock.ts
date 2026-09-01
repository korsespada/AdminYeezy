import crypto from 'crypto'
import { scrapingQuery } from '@/lib/db'

export type BatchOperation = 'ai' | 'script' | 'publish' | 'rollback' | 'delete'

export async function claimBatchOperation(batchId: string, operation: BatchOperation, ownerId: string = crypto.randomUUID()) {
  const result = await scrapingQuery(`
    INSERT INTO batch_operation_locks(batch_id,operation,owner_id)
    VALUES($1,$2,$3)
    ON CONFLICT(batch_id) DO UPDATE SET
      operation=EXCLUDED.operation,owner_id=EXCLUDED.owner_id,created_at=NOW(),updated_at=NOW()
    WHERE batch_operation_locks.updated_at < NOW() - INTERVAL '6 hours'
    RETURNING owner_id
  `, [batchId, operation, ownerId])
  return result.rows[0] ? ownerId : null
}

export async function releaseBatchOperation(batchId: string, ownerId: string) {
  await scrapingQuery('DELETE FROM batch_operation_locks WHERE batch_id=$1 AND owner_id=$2', [batchId, ownerId])
}

export async function touchBatchOperation(batchId: string, ownerId: string) {
  await scrapingQuery('UPDATE batch_operation_locks SET updated_at=NOW() WHERE batch_id=$1 AND owner_id=$2', [batchId, ownerId])
}

export async function updateBatchOperation(batchId: string, ownerId: string, operation: string) {
  await scrapingQuery(
    'UPDATE batch_operation_locks SET operation=$3,updated_at=NOW() WHERE batch_id=$1 AND owner_id=$2',
    [batchId, ownerId, operation],
  )
}

export async function activeBatchOperation(batchId: string) {
  const result = await scrapingQuery('SELECT operation FROM batch_operation_locks WHERE batch_id=$1', [batchId])
  return result.rows[0]?.operation || null
}

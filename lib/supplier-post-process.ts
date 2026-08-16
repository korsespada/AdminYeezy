import { scrapingQuery } from '@/lib/db'

export type ActiveSupplierPostProcess = {
  id: string
  name: string
  source: string
}

export async function getActiveSupplierPostProcess(supplierId: number): Promise<ActiveSupplierPostProcess | null> {
  const result = await scrapingQuery(`
    SELECT id,name,source FROM supplier_post_process_scripts
    WHERE supplier_id=$1 AND is_active=TRUE
    LIMIT 1
  `, [supplierId])
  return result.rows[0] as ActiveSupplierPostProcess | null
}

import { NextResponse } from 'next/server'
import { isAdminAuthError, requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import { parseBatchScriptProgress } from '@/lib/batch-script-progress'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
}

export async function GET(request: Request) {
  try {
    await requireAdmin()
    const batchId = new URL(request.url).searchParams.get('batchId')?.trim()
    if (!batchId) {
      return NextResponse.json({ success: false, error: 'batchId is required' }, { status: 400, headers: noStoreHeaders })
    }

    const [operationResult, taskResult] = await Promise.all([
      scrapingQuery('SELECT operation,updated_at FROM batch_operation_locks WHERE batch_id=$1', [batchId]),
      scrapingQuery(`
        SELECT status,error_message,updated_at
        FROM scraping_tasks
        WHERE batch_id=$1 AND result_path=$2
        ORDER BY id DESC
        LIMIT 1
      `, [batchId, `db://batch/${batchId}/script`]),
    ])
    const task = taskResult.rows[0]
    return NextResponse.json({
      success: true,
      data: parseBatchScriptProgress(
        operationResult.rows[0]?.operation,
        operationResult.rows[0]?.updated_at,
        task?.status,
        task?.error_message,
      ),
    }, { headers: noStoreHeaders })
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
    }
    return NextResponse.json({ success: false, error: error.message || 'Failed to read script progress' }, {
      status: 500,
      headers: noStoreHeaders,
    })
  }
}

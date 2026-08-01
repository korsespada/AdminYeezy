import { NextResponse } from 'next/server'
import { isAdminAuthError, requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import { parseBatchPublishProgress } from '@/lib/batch-publish-progress'

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

    const result = await scrapingQuery(
      'SELECT operation,updated_at FROM batch_operation_locks WHERE batch_id=$1',
      [batchId],
    )
    return NextResponse.json({
      success: true,
      data: parseBatchPublishProgress(result.rows[0]?.operation, result.rows[0]?.updated_at),
    }, { headers: noStoreHeaders })
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
    }
    return NextResponse.json({ success: false, error: error.message || 'Failed to read publication progress' }, {
      status: 500,
      headers: noStoreHeaders,
    })
  }
}

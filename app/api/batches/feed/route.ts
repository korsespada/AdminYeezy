import { NextResponse } from 'next/server'
import { isAdminAuthError, requireAdmin } from '@/lib/admin-session'
import { getExportHistoryAction, getSupplierSiteCountsAction } from '@/actions/suppliers'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
}

// Обновление ленты выгрузок идёт обычным GET, а не серверным экшеном:
// серверные экшены и переходы App Router стоят в одной очереди, поэтому
// опрос ленты через экшен задерживал открытие выгрузки до своего ответа.
export async function GET() {
  try {
    await requireAdmin()
    const [history, counts] = await Promise.all([getExportHistoryAction(), getSupplierSiteCountsAction()])
    if (!history.success) {
      return NextResponse.json({ success: false, error: history.error || 'Не удалось прочитать ленту выгрузок' }, {
        status: 500,
        headers: noStoreHeaders,
      })
    }
    return NextResponse.json({
      success: true,
      data: { batches: history.data, siteCounts: counts.success ? counts.data : null },
    }, { headers: noStoreHeaders })
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
    }
    return NextResponse.json({ success: false, error: error.message || 'Не удалось прочитать ленту выгрузок' }, {
      status: 500,
      headers: noStoreHeaders,
    })
  }
}

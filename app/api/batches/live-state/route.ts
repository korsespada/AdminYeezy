import { NextResponse } from 'next/server'
import { isAdminAuthError } from '@/lib/admin-session'
import { getBatchLiveStateAction } from '@/actions/batch-ai'
import { getBatchProductsByIdsAction } from '@/actions/csv-import'

export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
}

// Опрос открытой выгрузки идёт обычным GET, а не серверным экшеном: экшены и
// переходы App Router стоят в одной очереди, и опрос задерживал навигацию.
// Ответ содержит только товары, изменённые ИИ-запуском после `since`.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const batchId = params.get('batchId')?.trim()
    if (!batchId) {
      return NextResponse.json({ success: false, error: 'batchId is required' }, { status: 400, headers: noStoreHeaders })
    }
    const state = await getBatchLiveStateAction(batchId, params.get('since'))
    const ids = state.data.fullReload ? [] : state.data.changedProductIds
    const products = ids.length ? await getBatchProductsByIdsAction(batchId, ids) : { success: true, data: [] }
    return NextResponse.json({
      success: true,
      data: {
        ...state.data,
        changedProducts: products.success ? products.data : [],
        fullReload: state.data.fullReload || !products.success,
      },
    }, { headers: noStoreHeaders })
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
    }
    return NextResponse.json({ success: false, error: error.message || 'Не удалось прочитать состояние выгрузки' }, {
      status: 500,
      headers: noStoreHeaders,
    })
  }
}

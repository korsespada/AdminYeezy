import { NextResponse } from 'next/server'
import { startScrapingLocalAction } from '@/actions/suppliers'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const expectedSecret = process.env.SCRAPER_WORKER_SECRET
    if (expectedSecret) {
      const auth = request.headers.get('authorization') || ''
      if (auth !== `Bearer ${expectedSecret}`) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await request.json()
    const supplierId = Number(body?.supplierId)
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid supplierId' }, { status: 400 })
    }

    const result = await startScrapingLocalAction(
      supplierId,
      body?.endDate || undefined,
      body?.overrideTag || undefined,
      body?.overrideGroup || undefined,
      expectedSecret || (process.env.NODE_ENV !== 'production' ? 'dev-api-route' : undefined),
    )

    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Worker request failed' },
      { status: 500 },
    )
  }
}

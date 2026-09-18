import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import { DAVID_SUPPLIER_NAME } from '@/lib/david-studio-import'
import { loadDavidStudioCatalog } from '@/lib/david-studio-catalog-server'

export const dynamic = 'force-dynamic'

/**
 * Очередь чистки фото David: сколько всего, сколько осталось и по каким товарам.
 * Экран выгрузки открывает это в модалке, чтобы понимать остаток работы.
 */
export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [stats, perProduct, drafts] = await Promise.all([
      scrapingQuery(
        `SELECT status, clean_status, COUNT(*)::int AS count
           FROM photo_clean_jobs WHERE supplier=$1
          GROUP BY status, clean_status`,
        [DAVID_SUPPLIER_NAME],
      ),
      scrapingQuery(
        `SELECT source_product,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status='pending')::int AS pending,
                COUNT(*) FILTER (WHERE status='claimed')::int AS claimed,
                COUNT(*) FILTER (WHERE status='done' AND clean_status='ok')::int AS ok,
                COUNT(*) FILTER (WHERE status='done' AND clean_status='review')::int AS review,
                COUNT(*) FILTER (WHERE status='done' AND clean_status='miss')::int AS miss,
                COUNT(*) FILTER (WHERE status='failed')::int AS failed,
                MAX(updated_at) AS last_update
           FROM photo_clean_jobs WHERE supplier=$1
          GROUP BY source_product
          ORDER BY (COUNT(*) FILTER (WHERE status IN ('pending','claimed'))) DESC, source_product`,
        [DAVID_SUPPLIER_NAME],
      ),
      scrapingQuery('SELECT handle, rails_product_id FROM david_import_drafts'),
    ])

    const totals = {
      total: 0, pending: 0, claimed: 0, ok: 0, review: 0, miss: 0, failed: 0,
    }
    for (const row of stats.rows as any[]) {
      const count = Number(row.count || 0)
      totals.total += count
      if (row.status === 'pending') totals.pending += count
      else if (row.status === 'claimed') totals.claimed += count
      else if (row.status === 'failed') totals.failed += count
      else if (row.status === 'done') {
        if (row.clean_status === 'ok') totals.ok += count
        else if (row.clean_status === 'review') totals.review += count
        else if (row.clean_status === 'miss') totals.miss += count
      }
    }

    const catalog = loadDavidStudioCatalog()
    const titles = new Map<string, string>()
    for (const product of (catalog?.products || []) as any[]) titles.set(String(product.handle), String(product.title || ''))
    const published = new Set(
      (drafts.rows as any[]).filter((row) => row.rails_product_id).map((row) => String(row.handle)),
    )

    const products = (perProduct.rows as any[]).map((row) => {
      const handle = String(row.source_product)
      return {
        handle,
        title: titles.get(handle) || handle,
        total: Number(row.total || 0),
        pending: Number(row.pending || 0),
        claimed: Number(row.claimed || 0),
        ok: Number(row.ok || 0),
        review: Number(row.review || 0),
        miss: Number(row.miss || 0),
        failed: Number(row.failed || 0),
        published: published.has(handle),
        lastUpdate: row.last_update ? new Date(row.last_update).toISOString() : null,
      }
    })

    return NextResponse.json({
      ok: true,
      totals,
      products,
      productsInCatalog: titles.size,
      remaining: totals.pending + totals.claimed,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'queue_error' }, { status: 500 })
  }
}

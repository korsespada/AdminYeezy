import { scrapingQuery } from '@/lib/db'

/**
 * Состояние товара David для списка выгрузки: метки «опубликован в Chromoff» и
 * «фото очищены» плюс прогресс чистки. Данные уже есть — это david_import_drafts
 * и photo_clean_jobs, отдельного источника не заводим.
 */

export interface DavidProductStatus {
  handle: string
  draftStatus: string | null
  draftError: string | null
  railsProductId: string | null
  chromoffListingId: string | null
  publishedInChromoff: boolean
  photosExpected: number
  photosDone: number
  photosPending: number
  photosFailed: number
  photosCleaned: boolean
  cleaning: boolean
}

export async function loadDavidProductsStatus(
  products: Array<{ handle: string; photos: number }>,
): Promise<Record<string, DavidProductStatus>> {
  const handles = [...new Set(products.map((product) => String(product.handle)))].filter(Boolean)
  const result: Record<string, DavidProductStatus> = {}
  if (!handles.length) return result

  const expected = new Map(products.map((product) => [String(product.handle), Number(product.photos) || 0]))

  const [drafts, photoCounts] = await Promise.all([
    scrapingQuery(
      `SELECT handle, status, error, rails_product_id, chromoff_listing_id
         FROM david_import_drafts WHERE handle = ANY($1::text[])`,
      [handles],
    ),
    scrapingQuery(
      `SELECT source_product, status,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'done')::int AS done,
              COUNT(*) FILTER (WHERE status = 'pending' OR status = 'claimed')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM photo_clean_jobs
        WHERE supplier = 'David Studio' AND source_product = ANY($1::text[])
        GROUP BY source_product, status`,
      [handles],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const draftByHandle = new Map(drafts.rows.map((row: any) => [String(row.handle), row]))

  for (const handle of handles) {
    const draft: any = draftByHandle.get(handle)
    result[handle] = {
      handle,
      draftStatus: draft?.status || null,
      draftError: draft?.error || null,
      railsProductId: draft?.rails_product_id || null,
      chromoffListingId: draft?.chromoff_listing_id || null,
      publishedInChromoff: Boolean(draft?.rails_product_id) && String(draft?.status || '') === 'created',
      photosExpected: expected.get(handle) || 0,
      photosDone: 0,
      photosPending: 0,
      photosFailed: 0,
      photosCleaned: false,
      cleaning: false,
    }
  }

  for (const row of photoCounts.rows as any[]) {
    const status = result[String(row.source_product)]
    if (!status) continue
    if (row.status === 'done') status.photosDone += Number(row.done || 0)
    if (row.status === 'pending' || row.status === 'claimed') status.photosPending += Number(row.pending || 0)
    if (row.status === 'failed') status.photosFailed += Number(row.failed || 0)
  }

  for (const status of Object.values(result)) {
    const total = Math.max(status.photosExpected, status.photosDone + status.photosPending + status.photosFailed)
    status.photosExpected = total
    status.cleaning = status.photosPending > 0
    status.photosCleaned = total > 0 && status.photosDone >= total && status.photosFailed === 0
  }

  return result
}

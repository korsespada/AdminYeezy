import { randomUUID } from 'node:crypto'
import { scrapingQuery } from '@/lib/db'

/**
 * Фото David, которые оператор убрал из импорта.
 *
 * Исключение, а не удаление: очищенный файл остаётся в S3, задание чистки — в
 * очереди, поэтому кадр можно вернуть. Исключения учитываются при сборке
 * промпта ИИ, создании товара и привязке к существующему товару.
 */

export async function listDavidPhotoExclusions(handle: string): Promise<string[]> {
  const result = await scrapingQuery(
    `SELECT source_key FROM david_photo_exclusions WHERE handle=$1 ORDER BY created_at`,
    [handle],
  )
  return result.rows.map((row: any) => String(row.source_key))
}

export async function listDavidPhotoExclusionsForHandles(handles: string[]): Promise<Record<string, string[]>> {
  if (!handles.length) return {}
  const result = await scrapingQuery(
    `SELECT handle, source_key FROM david_photo_exclusions WHERE handle = ANY($1::text[]) ORDER BY created_at`,
    [handles],
  )
  const grouped: Record<string, string[]> = {}
  for (const row of result.rows as any[]) {
    const handle = String(row.handle)
    grouped[handle] = [...(grouped[handle] || []), String(row.source_key)]
  }
  return grouped
}

/** Повторное удаление того же кадра ничего не меняет. */
export async function excludeDavidPhoto(handle: string, sourceKey: string): Promise<boolean> {
  const inserted = await scrapingQuery(
    `INSERT INTO david_photo_exclusions (id, handle, source_key)
     VALUES ($1,$2,$3)
     ON CONFLICT (handle, source_key) DO NOTHING
     RETURNING id`,
    [randomUUID(), handle, sourceKey],
  )
  return Boolean(inserted.rowCount)
}

export async function restoreDavidPhoto(handle: string, sourceKey: string): Promise<boolean> {
  const removed = await scrapingQuery(
    `DELETE FROM david_photo_exclusions WHERE handle=$1 AND source_key=$2`,
    [handle, sourceKey],
  )
  return Boolean(removed.rowCount)
}

export async function clearDavidPhotoExclusions(handle: string): Promise<number> {
  const removed = await scrapingQuery(`DELETE FROM david_photo_exclusions WHERE handle=$1`, [handle])
  return removed.rowCount || 0
}

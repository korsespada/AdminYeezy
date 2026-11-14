import { scrapingQuery } from '@/lib/db'

// Число товаров в снимке этапа. `jsonb_array_length(products)` заставляет
// Postgres распаковать весь снимок (до 17 МБ), и подсчёт по 270 снимкам
// занимал ~3,5 с на каждое обновление ленты и открытие выгрузки. Снимок после
// записи не меняется (UPDATE batch_snapshots нигде нет), поэтому число
// считается один раз на снимок и хранится в памяти процесса. Удалённый снимок
// просто перестаёт запрашиваться.
const snapshotItemCounts = new Map<string, number>()

export async function batchSnapshotItemCounts(snapshotIds: string[]) {
  const ids = [...new Set(snapshotIds.map(String).filter(Boolean))]
  const missing = ids.filter((id) => !snapshotItemCounts.has(id))
  if (missing.length > 0) {
    const result = await scrapingQuery(`
      SELECT id, jsonb_array_length(products)::int AS items_count
      FROM batch_snapshots WHERE id = ANY($1::text[])
    `, [missing])
    for (const row of result.rows) snapshotItemCounts.set(String(row.id), Number(row.items_count) || 0)
  }
  return new Map(ids.filter((id) => snapshotItemCounts.has(id)).map((id) => [id, snapshotItemCounts.get(id)!]))
}

/** Метаданные снимков без распаковки products; items_count — из кэша. */
export async function batchSnapshotsWithCounts<T extends { id: unknown }>(rows: T[]) {
  const counts = await batchSnapshotItemCounts(rows.map((row) => String(row.id)))
  return rows.map((row) => ({ ...row, items_count: counts.get(String(row.id)) ?? 0 }))
}

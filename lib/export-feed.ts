import type { ExportHistoryBatch } from '@/actions/suppliers'

/**
 * Единая лента выгрузок: строка = поставщик, раскрытие = его партии.
 * Здесь только чистые функции, чтобы этапы и счётчики можно было проверить тестами.
 */

export type BatchFeedKind =
  | 'scraping'
  | 'raw'
  | 'script'
  | 'ai_running'
  | 'ready'
  | 'publishing'
  | 'pushed'
  | 'archived'
  | 'failed'
  | 'deleted'

export const BATCH_FEED_LABELS: Record<BatchFeedKind, string> = {
  scraping: 'Выгрузка идёт',
  raw: 'Сырой',
  script: 'Обработан скриптом',
  ai_running: 'Обработка ИИ',
  ready: 'Готово к публикации',
  publishing: 'Публикация',
  pushed: 'Опубликовано',
  archived: 'В архиве',
  failed: 'Ошибка',
  deleted: 'Удалено локально',
}

export const RUNNING_KINDS: BatchFeedKind[] = ['scraping', 'ai_running', 'publishing']
export const WAITING_KINDS: BatchFeedKind[] = ['raw', 'script', 'ready']

export type ProductBucket = 'site' | 'push' | 'ready' | 'ai' | 'script' | 'raw' | 'err' | 'arch'
export type ProductCounts = Record<ProductBucket, number>

export const PRODUCT_BUCKETS: { key: ProductBucket; label: string }[] = [
  { key: 'site', label: 'на сайте' },
  { key: 'push', label: 'публикуется' },
  { key: 'ready', label: 'готово' },
  { key: 'ai', label: 'в ИИ' },
  { key: 'script', label: 'после скрипта' },
  { key: 'raw', label: 'сырые' },
  { key: 'err', label: 'ошибки ИИ' },
  { key: 'arch', label: 'в архиве' },
]

export function emptyProductCounts(): ProductCounts {
  return { site: 0, push: 0, ready: 0, ai: 0, script: 0, raw: 0, err: 0, arch: 0 }
}

const n = (value: unknown) => Math.max(0, Number(value) || 0)

export function isAiRunning(batch: Pick<ExportHistoryBatch, 'ai_run_status'>) {
  return ['queued', 'running'].includes(String(batch.ai_run_status || ''))
}

export function isPublishing(batch: Pick<ExportHistoryBatch, 'active_operation'>) {
  return Boolean(batch.active_operation?.includes('publish'))
}

export function batchFeedKind(batch: ExportHistoryBatch): BatchFeedKind {
  if (batch.status === 'Удалено из БД' || batch.stage === 'DELETED_FROM_DB') return 'deleted'
  if (isPublishing(batch)) return 'publishing'
  if (isAiRunning(batch)) return 'ai_running'
  if (batch.status === 'Запущено') return 'scraping'
  if (batch.catalog_deleted_at) return 'archived'
  if (batch.status === 'failed') return 'failed'
  if (batch.stage === 'PUSHED') return 'pushed'
  if (batch.status === 'Обработано ИИ') return 'ready'
  if (batch.status === 'Обработан скриптом') return 'script'
  return 'raw'
}

export function batchProductCount(batch: ExportHistoryBatch) {
  return n(batch.product_count) || n(batch.items_count)
}

export function batchErrorMessage(batch: ExportHistoryBatch) {
  return batch.files.find((file) => file.error_message)?.error_message?.trim() || ''
}

/** Товары партии, которые ещё не дошли до сайта, разложенные по этапам. */
export function batchProductCounts(batch: ExportHistoryBatch, kind = batchFeedKind(batch)): ProductCounts {
  const counts = emptyProductCounts()
  const total = batchProductCount(batch)
  const aiDone = Math.min(total, n(batch.ai_product_count))
  const pendingBucket: ProductBucket = kind === 'script' ? 'script' : 'raw'

  switch (kind) {
    case 'raw':
    case 'script': {
      const lastRunFinished = ['completed', 'failed', 'cancelled'].includes(String(batch.ai_run_status || ''))
      const failed = lastRunFinished ? Math.min(total - aiDone, n(batch.ai_failed_count)) : 0
      counts.ready = aiDone
      counts.err = failed
      counts[pendingBucket] = total - aiDone - failed
      break
    }
    case 'ai_running': {
      const runTotal = n(batch.ai_total_count)
      const runDone = n(batch.ai_completed_count)
      const runFailed = n(batch.ai_failed_count)
      const inAi = Math.max(0, runTotal - runDone - runFailed)
      counts.ready = aiDone
      counts.err = runFailed
      counts.ai = Math.min(inAi, Math.max(0, total - aiDone - runFailed))
      counts[batch.status === 'Обработан скриптом' ? 'script' : 'raw'] = Math.max(0, total - aiDone - runFailed - counts.ai)
      break
    }
    case 'ready':
      counts.ready = total
      break
    case 'publishing':
      counts.push = total
      break
    case 'archived':
      counts.arch = total
      break
    default:
      break
  }
  return counts
}

export type SupplierFeedInput = {
  id: number
  name: string
  is_favorite?: boolean
  operator_note?: string | null
  feed_position?: number | null
}

export type SupplierFeedRow<S extends SupplierFeedInput = SupplierFeedInput> = {
  supplier: S | null
  key: string
  name: string
  batches: ExportHistoryBatch[]
  latest: ExportHistoryBatch | null
  latestKind: BatchFeedKind | null
  lastExportAt: number | null
  counts: ProductCounts
}

const UNASSIGNED_KEY = 'unassigned'

function batchTime(batch: ExportHistoryBatch) {
  const time = new Date(batch.created_at).getTime()
  return Number.isFinite(time) ? time : 0
}

/**
 * Собирает строки ленты: у каждого поставщика его партии (новые сверху) и
 * сводка товаров. «На сайте» берётся из реестра публикаций (`siteCounts`),
 * чтобы повторные публикации тех же товаров не задваивались; для старых
 * партий без реестра — по последней опубликованной партии.
 */
export function buildSupplierFeedRows<S extends SupplierFeedInput>(
  suppliers: S[],
  batches: ExportHistoryBatch[],
  siteCounts: Record<number, number> = {},
): SupplierFeedRow<S>[] {
  const bySupplier = new Map<string, ExportHistoryBatch[]>()
  const known = new Set(suppliers.map((supplier) => supplier.id))
  for (const batch of batches) {
    const key = batch.supplier_id && known.has(batch.supplier_id) ? String(batch.supplier_id) : UNASSIGNED_KEY
    const list = bySupplier.get(key) || []
    list.push(batch)
    bySupplier.set(key, list)
  }

  const build = (key: string, supplier: S | null, name: string): SupplierFeedRow<S> => {
    const list = (bySupplier.get(key) || []).sort((a, b) => batchTime(b) - batchTime(a))
    const counts = emptyProductCounts()
    let latestPushed: ExportHistoryBatch | null = null
    for (const batch of list) {
      const kind = batchFeedKind(batch)
      if (kind === 'pushed' && !latestPushed) latestPushed = batch
      const batchCounts = batchProductCounts(batch, kind)
      for (const bucket of Object.keys(counts) as ProductBucket[]) counts[bucket] += batchCounts[bucket]
    }
    const registered = supplier ? n(siteCounts[supplier.id]) : 0
    counts.site = registered || (latestPushed ? batchProductCount(latestPushed) : 0)
    const latest = list[0] || null
    return {
      supplier,
      key,
      name,
      batches: list,
      latest,
      latestKind: latest ? batchFeedKind(latest) : null,
      lastExportAt: latest ? batchTime(latest) : null,
      counts,
    }
  }

  const rows = suppliers.map((supplier) => build(String(supplier.id), supplier, supplier.name))
  if (bySupplier.has(UNASSIGNED_KEY)) rows.push(build(UNASSIGNED_KEY, null, 'Без поставщика'))
  return rows
}

export const STALE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export function daysSinceExport(row: Pick<SupplierFeedRow, 'lastExportAt'>, now = Date.now()) {
  return row.lastExportAt === null ? Infinity : (now - row.lastExportAt) / DAY_MS
}

export type FeedSort = 'manual' | 'attention' | 'recent' | 'oldest' | 'name'

/** Поставщик, у которого сейчас идёт выгрузка, ИИ или публикация любой партии. */
export function isSupplierRowRunning(row: Pick<SupplierFeedRow, 'batches'>) {
  return row.batches.some((batch) => RUNNING_KINDS.includes(batchFeedKind(batch)))
}

// Порядок групп не зависит от выбранной сортировки: всё, что сейчас в работе,
// всегда сверху, поставщики без партий — всегда в самом низу.
function feedTier(row: SupplierFeedRow) {
  if (isSupplierRowRunning(row)) return 0
  if (!row.latest) return 2
  return 1
}

function attentionRank(row: SupplierFeedRow) {
  if (row.latestKind === 'failed') return 0
  if (row.latestKind && WAITING_KINDS.includes(row.latestKind)) return 1
  return 2
}

export function sortFeedRows<T extends SupplierFeedRow>(rows: T[], sort: FeedSort): T[] {
  const time = (row: SupplierFeedRow) => row.lastExportAt ?? 0
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'ru')
  const position = (row: SupplierFeedRow) => {
    const value = row.supplier?.feed_position
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? Infinity : Number(value)
  }
  const compare: Record<FeedSort, (a: T, b: T) => number> = {
    // Свой порядок задаётся перетаскиванием; поставщики без позиции идут после
    // расставленных, по названию.
    manual: (a, b) => {
      const pa = position(a)
      const pb = position(b)
      return pa === pb ? byName(a, b) : pa < pb ? -1 : 1
    },
    attention: (a, b) => attentionRank(a) - attentionRank(b) || time(b) - time(a) || byName(a, b),
    recent: (a, b) => time(b) - time(a) || byName(a, b),
    oldest: (a, b) => time(a) - time(b) || byName(a, b),
    name: byName,
  }
  return [...rows].sort((a, b) => feedTier(a) - feedTier(b) || compare[sort](a, b))
}

/**
 * Переносит строку `dragKey` до или после `targetKey` в уже отсортированном
 * списке ключей и возвращает новый порядок.
 */
export function moveFeedKey(keys: string[], dragKey: string, targetKey: string, after: boolean): string[] {
  if (dragKey === targetKey || !keys.includes(dragKey) || !keys.includes(targetKey)) return keys
  const rest = keys.filter((key) => key !== dragKey)
  const index = rest.indexOf(targetKey) + (after ? 1 : 0)
  return [...rest.slice(0, index), dragKey, ...rest.slice(index)]
}

export function formatRelativeTime(timestamp: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round(hours / 24)
  const mod10 = days % 10
  const mod100 = days % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
  return `${days} ${word} назад`
}

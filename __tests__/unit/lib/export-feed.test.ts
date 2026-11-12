import { describe, expect, it } from 'vitest'
import type { ExportHistoryBatch } from '@/actions/suppliers'
import {
  batchFeedKind,
  batchProductCounts,
  buildSupplierFeedRows,
  formatRelativeTime,
  moveFeedKey,
  sortFeedRows,
} from '@/lib/export-feed'

const NOW = Date.parse('2026-11-11T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000).toISOString()

function batch(overrides: Partial<ExportHistoryBatch> = {}): ExportHistoryBatch {
  return {
    id: overrides.id || 'b1',
    isSynthetic: false,
    name: 'Пуховики - 09.11.2026, 09:54:01',
    supplier_id: 1,
    supplier_name: 'Пуховики',
    supplier_avatar: null,
    has_script: false,
    items_count: 100,
    product_count: 100,
    ai_product_count: 0,
    stage: 'SCRAPED',
    status: 'Сырой товар',
    end_date: null,
    created_at: hoursAgo(2),
    updated_at: hoursAgo(2),
    raw_path: null,
    ai_path: null,
    files: [],
    folder_id: null,
    folder_name: null,
    ...overrides,
  }
}

const supplier = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra })

describe('batchFeedKind', () => {
  it('prefers live operations over the stored stage', () => {
    expect(batchFeedKind(batch({ stage: 'AI_PROCESSED', active_operation: 'publish|media|120|500' }))).toBe('publishing')
    expect(batchFeedKind(batch({ ai_run_status: 'running' }))).toBe('ai_running')
    expect(batchFeedKind(batch({ status: 'Запущено' }))).toBe('scraping')
  })

  it('maps stored stages to feed states', () => {
    expect(batchFeedKind(batch())).toBe('raw')
    expect(batchFeedKind(batch({ status: 'Обработан скриптом', stage: 'SCRIPT_PROCESSED' }))).toBe('script')
    expect(batchFeedKind(batch({ status: 'Обработано ИИ', stage: 'AI_PROCESSED' }))).toBe('ready')
    expect(batchFeedKind(batch({ status: 'Запушено в БД', stage: 'PUSHED' }))).toBe('pushed')
    expect(batchFeedKind(batch({ status: 'В архиве', stage: 'PUSHED', catalog_deleted_at: hoursAgo(1) }))).toBe('archived')
    expect(batchFeedKind(batch({ status: 'failed' }))).toBe('failed')
    expect(batchFeedKind(batch({ status: 'Удалено из БД', stage: 'DELETED_FROM_DB' }))).toBe('deleted')
  })
})

describe('batchProductCounts', () => {
  it('splits a running AI batch into ready, in-progress and waiting products', () => {
    const counts = batchProductCounts(batch({
      product_count: 1000,
      ai_product_count: 400,
      ai_run_status: 'running',
      ai_total_count: 600,
      ai_completed_count: 0,
      ai_failed_count: 10,
      status: 'Обработан скриптом',
    }))
    expect(counts).toMatchObject({ ready: 400, ai: 590, err: 10, script: 0, raw: 0 })
  })

  it('keeps AI failures of a finished run separate from raw products', () => {
    const counts = batchProductCounts(batch({ product_count: 50, ai_product_count: 40, ai_run_status: 'completed', ai_failed_count: 3 }))
    expect(counts).toMatchObject({ ready: 40, err: 3, raw: 7 })
  })

  it('puts processed-by-script products in their own bucket', () => {
    expect(batchProductCounts(batch({ status: 'Обработан скриптом', product_count: 20 }))).toMatchObject({ script: 20, raw: 0 })
  })
})

describe('buildSupplierFeedRows', () => {
  it('groups batches per supplier, newest first, with suppliers without batches kept', () => {
    const rows = buildSupplierFeedRows(
      [supplier(1, 'Пуховики'), supplier(2, 'Часы')],
      [
        batch({ id: 'old', created_at: hoursAgo(200), stage: 'PUSHED', status: 'Запушено в БД', product_count: 640 }),
        batch({ id: 'new', created_at: hoursAgo(1), ai_run_status: 'running', ai_total_count: 500, ai_completed_count: 100, product_count: 500 }),
        batch({ id: 'orphan', supplier_id: 99, isSynthetic: true }),
      ],
      { 1: 900 },
    )
    const first = rows.find((row) => row.key === '1')!
    expect(first.batches.map((item) => item.id)).toEqual(['new', 'old'])
    expect(first.latestKind).toBe('ai_running')
    expect(first.counts.site).toBe(900)
    expect(first.counts.ai).toBe(400)
    expect(rows.find((row) => row.key === '2')!.latest).toBeNull()
    expect(rows.find((row) => row.key === 'unassigned')!.batches.map((item) => item.id)).toEqual(['orphan'])
  })

  it('falls back to the latest pushed batch when the publication registry is empty', () => {
    const [row] = buildSupplierFeedRows([supplier(1, 'Пуховики')], [
      batch({ id: 'p2', created_at: hoursAgo(5), stage: 'PUSHED', status: 'Запушено в БД', product_count: 300 }),
      batch({ id: 'p1', created_at: hoursAgo(50), stage: 'PUSHED', status: 'Запушено в БД', product_count: 250 }),
    ])
    expect(row.counts.site).toBe(300)
  })

  it('counts archived batches separately from the site', () => {
    const [row] = buildSupplierFeedRows([supplier(1, 'Пуховики')], [
      batch({ stage: 'PUSHED', status: 'В архиве', catalog_deleted_at: hoursAgo(1), product_count: 120 }),
    ])
    expect(row.counts.arch).toBe(120)
    expect(row.counts.site).toBe(0)
  })
})

describe('sortFeedRows', () => {
  const rows = buildSupplierFeedRows(
    [supplier(1, 'Ошибка'), supplier(2, 'Готово'), supplier(3, 'Опубликован'), supplier(4, 'Новый'), supplier(5, 'ИИ идёт'), supplier(6, 'Ещё новый')],
    [
      batch({ id: 'f', supplier_id: 1, status: 'failed', created_at: hoursAgo(3) }),
      batch({ id: 'r', supplier_id: 2, status: 'Обработано ИИ', stage: 'AI_PROCESSED', created_at: hoursAgo(1) }),
      batch({ id: 'p', supplier_id: 3, status: 'Запушено в БД', stage: 'PUSHED', created_at: hoursAgo(24 * 10) }),
      // Работа идёт в старой партии, а последняя уже опубликована: поставщик всё равно сверху.
      batch({ id: 'ai-old', supplier_id: 5, ai_run_status: 'running', created_at: hoursAgo(24 * 30) }),
      batch({ id: 'ai-new', supplier_id: 5, status: 'Запушено в БД', stage: 'PUSHED', created_at: hoursAgo(24 * 20) }),
    ],
  )
  const order = (sort: Parameters<typeof sortFeedRows>[1]) => sortFeedRows(rows, sort).map((row) => row.name)

  it('keeps running suppliers first and suppliers without batches last for every sort', () => {
    expect(order('attention')).toEqual(['ИИ идёт', 'Ошибка', 'Готово', 'Опубликован', 'Ещё новый', 'Новый'])
    expect(order('recent')).toEqual(['ИИ идёт', 'Готово', 'Ошибка', 'Опубликован', 'Ещё новый', 'Новый'])
    expect(order('oldest')).toEqual(['ИИ идёт', 'Опубликован', 'Ошибка', 'Готово', 'Ещё новый', 'Новый'])
    expect(order('name')).toEqual(['ИИ идёт', 'Готово', 'Опубликован', 'Ошибка', 'Ещё новый', 'Новый'])
  })

  it('orders by saved feed position inside each group, unplaced suppliers after placed ones', () => {
    const placed = buildSupplierFeedRows(
      [supplier(1, 'А', { feed_position: 3 }), supplier(2, 'Б', { feed_position: 1 }), supplier(3, 'В'), supplier(4, 'Г', { feed_position: 2 }), supplier(5, 'Д', { feed_position: 0 })],
      [
        batch({ id: 'a', supplier_id: 1 }),
        batch({ id: 'b', supplier_id: 2 }),
        batch({ id: 'c', supplier_id: 3 }),
        batch({ id: 'd', supplier_id: 4 }),
      ],
    )
    expect(sortFeedRows(placed, 'manual').map((row) => row.name)).toEqual(['Б', 'Г', 'А', 'В', 'Д'])
  })
})

describe('moveFeedKey', () => {
  it('moves a key before or after the target', () => {
    expect(moveFeedKey(['1', '2', '3', '4'], '4', '2', false)).toEqual(['1', '4', '2', '3'])
    expect(moveFeedKey(['1', '2', '3', '4'], '1', '3', true)).toEqual(['2', '3', '1', '4'])
    expect(moveFeedKey(['1', '2'], '1', '1', true)).toEqual(['1', '2'])
    expect(moveFeedKey(['1', '2'], '9', '1', true)).toEqual(['1', '2'])
  })
})

describe('formatRelativeTime', () => {
  it('uses Russian plural forms for days', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('только что')
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 мин назад')
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW)).toBe('3 ч назад')
    expect(formatRelativeTime(NOW - 24 * 3600_000, NOW)).toBe('1 день назад')
    expect(formatRelativeTime(NOW - 3 * 24 * 3600_000, NOW)).toBe('3 дня назад')
    expect(formatRelativeTime(NOW - 11 * 24 * 3600_000, NOW)).toBe('11 дней назад')
  })
})

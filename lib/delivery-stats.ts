// Форматирование сводки раздела «Доставка». Отдельно от компонента, чтобы
// покрыть тестами без рендера.

import type { RailsDeliveryParcelListRow, RailsDeliveryStage } from '@/lib/rails-admin'

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

export const DELIVERY_STAGES: RailsDeliveryStage[] = ['created', 'shipped', 'customs', 'sorting', 'delivered', 'unknown']

export type DeliveryParcelFilters = { stage?: RailsDeliveryStage | 'active'; q?: string }

function firstParam(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

/** Фильтры списка посылок из query: stage — этап или active (не вручены), q — поиск. */
export function deliveryParcelFilters(params: { stage?: string | string[]; q?: string | string[] }): DeliveryParcelFilters {
  const stage = firstParam(params.stage)
  return {
    stage: stage === 'active' || DELIVERY_STAGES.includes(stage as RailsDeliveryStage) ? (stage as DeliveryParcelFilters['stage']) : undefined,
    q: firstParam(params.q)?.slice(0, 100),
  }
}

/** Поиск по треку, получателю, городу и последнему событию без учёта регистра. */
export function filterDeliveryParcels(rows: RailsDeliveryParcelListRow[], { stage, q }: DeliveryParcelFilters) {
  const query = q?.toLocaleLowerCase('ru-RU')
  return rows.filter((row) => {
    const rowStage = row.stage || 'unknown'
    if (stage === 'active' ? rowStage === 'delivered' : stage && rowStage !== stage) return false
    if (!query) return true
    return [row.number, row.recipient, row.destination, row.last_event_text]
      .some((value) => value?.toLocaleLowerCase('ru-RU').includes(query))
  })
}

/** Дата из query-параметра, если она в формате ГГГГ-ММ-ДД; иначе Rails возьмёт период по умолчанию. */
export function deliveryPeriodParam(value: string | string[] | undefined) {
  const date = Array.isArray(value) ? value[0] : value
  return date && DATE_FORMAT.test(date) ? date : undefined
}

export function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} дн.`
}

export function formatShare(part: number, total: number) {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

/** «2026-11-02» → «02.11» */
export function formatWeek(value: string) {
  const [, month, day] = value.split('-')
  return day && month ? `${day}.${month}` : value
}

/** «2026-11-02T…» → «02.11.2026» по Москве. */
export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' })
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
}

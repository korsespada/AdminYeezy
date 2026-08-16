const MOSCOW_TIME_ZONE = 'Europe/Moscow'

function moscowIsoDate(date: Date) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(values.map((part) => [part.type, part.value]))
  const year = byType.get('year')
  const month = byType.get('month')
  const day = byType.get('day')
  return year && month && day ? `${year}-${month}-${day}` : ''
}

export function normalizeSupplierPublishedOn(value: unknown) {
  const text = String(value ?? '').trim()
  const date = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (date) return `${date[1]}-${date[2]}-${date[3]}`
  if (!/^\d{10,13}$/.test(text)) return ''

  const timestamp = Number(text)
  if (!Number.isFinite(timestamp)) return ''
  const milliseconds = text.length === 13 ? timestamp : timestamp * 1_000
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? '' : moscowIsoDate(parsed)
}

export function supplierPublishedOnFromAttributes(attributes: Record<string, unknown> | null | undefined) {
  return normalizeSupplierPublishedOn(
    attributes?.supplier_published_on
    || attributes?.szwego_timestamp
    || attributes?.time_stamp
    || attributes?.update_time
    || attributes?.new_send_time,
  )
}

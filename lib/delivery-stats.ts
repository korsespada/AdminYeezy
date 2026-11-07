// Форматирование сводки раздела «Доставка». Отдельно от компонента, чтобы
// покрыть тестами без рендера.

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

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

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
}

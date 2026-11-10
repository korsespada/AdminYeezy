/**
 * Числовые размерные ряды одежды: 28–36 означает 28, 30, 32, 34, 36.
 *
 * Поставщики пишут диапазон через дефис, а магазин продаёт только чётные
 * размеры (брюки по обхвату пояса, европейские размеры одежды). Раньше
 * диапазон разворачивался с шагом 1, поэтому у джинсов появлялись 29, 31, 33,
 * а у верхней одежды — 49, 51, 53. Обувь, головные уборы и детские размеры
 * (меньше 20) к этому правилу не относятся: там нечётные значения нормальны.
 */
const ADULT_NUMERIC_MIN = 20

const INTEGER_RE = /^\d+$/

export function numericSize(size: unknown): number | null {
  const text = String(size ?? '').trim()
  return INTEGER_RE.test(text) ? Number(text) : null
}

/**
 * Возвращает чётный ряд, который нужно оставить вместо смешанного: снимает
 * нечётные значения внутри полного чётного интервала (и по одному соседнему
 * значению с каждой стороны). `null` — ряд не подходит под правило, его надо
 * оставить как есть: одиночный нечётный размер, нечётные границы, разрывы.
 */
export function planEvenClothingSizes(sizes: string[]): { removed: string[]; kept: string[] } | null {
  const values = sizes
    .map(numericSize)
    .filter((value): value is number => value !== null && value >= ADULT_NUMERIC_MIN)
  const evens = [...new Set(values.filter((value) => value % 2 === 0))].sort((a, b) => a - b)
  if (evens.length < 2) return null

  const min = evens[0]
  const max = evens[evens.length - 1]
  const complete = evens.length === (max - min) / 2 + 1
  if (!complete) return null

  const removed = sizes.filter((size) => {
    const value = numericSize(size)
    if (value === null || value % 2 === 0) return false
    return value >= min - 1 && value <= max + 1
  })
  if (removed.length === 0) return null

  const removedSet = new Set(removed)
  const kept = sizes.filter((size) => !removedSet.has(size))
  return kept.length > 0 ? { removed, kept } : null
}

/** Разворачивает диапазон «28–36» в чётный ряд; прочие значения не меняет. */
export function expandEvenSizeRange(value: string): string[] {
  const text = String(value ?? '').trim().replace(',', '.')
  const match = text.match(/^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/)
  if (!match) return [value]
  const from = Number(match[1])
  const to = Number(match[2])
  if (to <= from || from < ADULT_NUMERIC_MIN) return [value]
  const start = from % 2 === 0 ? from : from + 1
  const values: string[] = []
  for (let current = start; current <= to; current += 2) values.push(String(current))
  return values.length > 0 ? values : [value]
}

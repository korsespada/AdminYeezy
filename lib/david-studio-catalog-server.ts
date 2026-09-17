import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildSummary } from '@/lib/david-studio-catalog'
import type { DavidStudioCatalog } from '@/lib/david-studio-catalog'

/**
 * Серверное чтение выгрузки David_Studio.
 *
 * Данные лежат в JSON-файле, его обновляет scripts/sync-david-studio-catalog.mjs.
 * Боевые таблицы не затрагиваются: страница только читает выгрузку.
 * Импортировать модуль можно только из серверных компонентов (node:fs).
 */

export const DAVID_STUDIO_CATALOG_FILE = path.join(process.cwd(), 'data', 'david-studio', 'catalog.json')

let cached: { mtimeMs: number; catalog: DavidStudioCatalog } | null = null

/**
 * Читает выгрузку с диска. Возвращает null, если файла ещё нет —
 * страница в этом случае показывает подсказку про скрипт синхронизации.
 * Кэш сбрасывается по mtime, поэтому пересинхронизация подхватывается без рестарта.
 */
export function loadDavidStudioCatalog(): DavidStudioCatalog | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(DAVID_STUDIO_CATALOG_FILE).mtimeMs
  } catch {
    return null
  }

  if (cached && cached.mtimeMs === mtimeMs) return cached.catalog

  const parsed = JSON.parse(readFileSync(DAVID_STUDIO_CATALOG_FILE, 'utf8')) as DavidStudioCatalog
  if (!parsed || !Array.isArray(parsed.products)) {
    throw new Error(`Файл ${DAVID_STUDIO_CATALOG_FILE} повреждён: нет массива products`)
  }

  const catalog: DavidStudioCatalog = {
    source: parsed.source || 'https://www.david-studio.com',
    parsed_at: parsed.parsed_at || '',
    currency: parsed.currency || 'USD',
    summary: parsed.summary || buildSummary(parsed.products),
    products: parsed.products,
  }
  cached = { mtimeMs, catalog }
  return catalog
}

/** Сброс кэша — для тестов и ручного обновления после синхронизации. */
export function resetDavidStudioCatalogCache() {
  cached = null
}

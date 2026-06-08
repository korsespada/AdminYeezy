'use server'

import { revalidatePath } from 'next/cache'
import {
  getRailsAdminProduct,
  listRailsAdminProducts,
  patchRailsAdminProduct,
  searchRailsAdminProductsExact,
} from '@/lib/rails-admin'
import {
  buildPreviewRow,
  compactProductSummary,
  findExactProductMatch,
  isGenderValue,
  parseGenderCsv,
  productMatchIds,
  serializeGenderBackfillReport,
  type GenderBackfillProductSummary,
  type GenderBackfillPreviewRow,
  type GenderCsvRow,
  type GenderValue,
} from '@/lib/gender-backfill'
import type { Product } from '@/lib/types'

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000
const CATALOG_PAGE_SIZE = 200
const CATALOG_STATUSES: Product['status'][] = ['active', 'hidden', 'draft']

let cachedCatalog:
  | { loadedAt: number; byKey: Map<string, GenderBackfillProductSummary> }
  | null = null

function normalizeLookupKey(value: unknown) {
  return String(value || '').trim()
}

async function loadGenderBackfillCatalog() {
  if (cachedCatalog && Date.now() - cachedCatalog.loadedAt < CATALOG_CACHE_TTL_MS) {
    return cachedCatalog.byKey
  }

  const byKey = new Map<string, GenderBackfillProductSummary>()

  for (const status of CATALOG_STATUSES) {
    let page = 1
    let totalPages = 1

    do {
      const result = await listRailsAdminProducts({
        page,
        perPage: CATALOG_PAGE_SIZE,
        status,
      })

      for (const product of result.products) {
        const compact = compactProductSummary(product)
        for (const key of productMatchIds(product)) {
          if (!byKey.has(key)) byKey.set(key, compact)
        }
      }

      totalPages = Number(result.totalPages || 1)
      page += 1
    } while (page <= totalPages)
  }

  cachedCatalog = { loadedAt: Date.now(), byKey }
  return byKey
}

export async function parseGenderCsvAction(csvText: string) {
  try {
    const rows = parseGenderCsv(csvText)
    return {
      success: true,
      data: {
        rows,
        totalRows: rows.length,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось прочитать CSV' }
  }
}

export async function previewGenderMatchesAction(
  rows: GenderCsvRow[],
  cursor = 0,
  chunkSize = 50
) {
  try {
    const slice = rows.slice(cursor, cursor + chunkSize)
    const cache = new Map<string, Awaited<ReturnType<typeof searchRailsAdminProductsExact>>>()

    const previews = await Promise.all(slice.map(async (row) => {
      try {
        if (!cache.has(row.productId)) {
          cache.set(row.productId, await searchRailsAdminProductsExact(row.productId))
        }
        const candidates = cache.get(row.productId) || []
        const product = findExactProductMatch(candidates, row.productId)
        return buildPreviewRow(row, product)
      } catch (error: any) {
        return {
          rowNumber: row.rowNumber,
          csvProductId: row.productId,
          csvName: row.name,
          csvDescription: row.description,
          suggestedGender: '',
          selectedGender: '',
          confidence: 0,
          reason: 'Ошибка поиска товара',
          status: 'error',
          selected: false,
          message: error.message || 'Не удалось найти товар',
        } satisfies GenderBackfillPreviewRow
      }
    }))

    const nextCursor = cursor + slice.length
    return {
      success: true,
      data: {
        rows: previews,
        nextCursor,
        done: nextCursor >= rows.length,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось построить preview' }
  }
}

export async function lookupGenderBackfillProductsAction(productIds: string[]) {
  try {
    const uniqueIds = Array.from(new Set(productIds.map(normalizeLookupKey).filter(Boolean)))
    const catalogByKey = await loadGenderBackfillCatalog()
    const matches: Record<string, GenderBackfillProductSummary> = {}

    for (const id of uniqueIds) {
      const product = catalogByKey.get(id)
      if (product) matches[id] = product
    }

    return {
      success: true,
      data: {
        totalIds: uniqueIds.length,
        matched: Object.keys(matches).length,
        matches,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось найти товары в Rails CRM' }
  }
}

export async function applyGenderUpdatesAction(updates: { productId: string; gender: GenderValue }[]) {
  try {
    const results = {
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
      items: [] as { productId: string; status: 'updated' | 'skipped' | 'failed'; message: string }[],
    }

    for (const update of updates) {
      try {
        if (!isGenderValue(update.gender)) {
          results.failed += 1
          const message = 'Некорректный gender'
          results.errors.push(`${update.productId}: ${message}`)
          results.items.push({ productId: update.productId, status: 'failed', message })
          continue
        }

        const product = await getRailsAdminProduct(update.productId)
        if (product.status === 'archived') {
          results.skipped += 1
          results.items.push({ productId: update.productId, status: 'skipped', message: 'Archived товар пропущен' })
          continue
        }
        if (product.gender) {
          results.skipped += 1
          results.items.push({ productId: update.productId, status: 'skipped', message: 'Gender уже заполнен' })
          continue
        }

        await patchRailsAdminProduct(product.id, { gender: update.gender })
        results.updated += 1
        results.items.push({ productId: update.productId, status: 'updated', message: 'Обновлено' })
      } catch (error: any) {
        results.failed += 1
        const message = error.message || 'Ошибка обновления'
        results.errors.push(`${update.productId}: ${message}`)
        results.items.push({ productId: update.productId, status: 'failed', message })
      }
    }

    cachedCatalog = null
    revalidatePath('/admin')
    revalidatePath('/admin/gender-backfill')
    return { success: true, data: results }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось применить обновления' }
  }
}

export async function exportGenderBackfillReportAction(rows: GenderBackfillPreviewRow[]) {
  try {
    return {
      success: true,
      data: {
        fileName: `gender-backfill-${Date.now()}.csv`,
        content: serializeGenderBackfillReport(rows),
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось сформировать отчет' }
  }
}

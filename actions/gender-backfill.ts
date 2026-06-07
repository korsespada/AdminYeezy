'use server'

import { revalidatePath } from 'next/cache'
import {
  getRailsAdminProduct,
  patchRailsAdminProduct,
  searchRailsAdminProductsExact,
} from '@/lib/rails-admin'
import {
  buildPreviewRow,
  findExactProductMatch,
  isGenderValue,
  parseGenderCsv,
  serializeGenderBackfillReport,
  type GenderBackfillPreviewRow,
  type GenderCsvRow,
  type GenderValue,
} from '@/lib/gender-backfill'

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

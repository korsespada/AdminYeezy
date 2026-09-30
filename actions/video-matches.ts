'use server'

import { requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import {
  getRailsCatalogLookups,
  listRailsAdminProducts,
  patchRailsAdminProduct,
} from '@/lib/rails-admin'
import {
  buildAlbumIndex,
  buildMatchRows,
  duplicateVideoUrls,
  type AlbumCandidate,
  type CatalogProductInput,
} from '@/lib/video-match-build'
import { parseCatalogFields } from '@/lib/video-match-fields'
import {
  approveMatches,
  approveMatchesByBand,
  clearBatchMatches,
  countVideoMatches,
  listMatchAlternatives,
  listScopeWithoutCandidates,
  listVideoMatches,
  markMatchApplied,
  markMatchFailed,
  rejectMatches,
  resetApprovedMatches,
  resetMatches,
  retryFailedMatches,
  saveMatchRows,
  saveMatchScope,
  selectApprovedForApply,
  videoMatchCounts,
  type VideoMatchStatus,
} from '@/lib/product-video-matches'
import { findVideoMatchPreset } from '@/lib/video-match-presets'
import type { ActionResponse } from '@/lib/types'

const PAGE_SIZE = 100
/** Сколько PATCH-запросов к Rails держим одновременно при закреплении поставщика. */
const SUPPLIER_PATCH_CONCURRENCY = 6
/** Пустой статус = все неархивные товары, второй проход добирает архив. */
const STATUS_PASSES: Array<{ value?: 'archived'; label: string }> = [
  { value: undefined, label: 'в каталоге' },
  { value: 'archived', label: 'архив' },
]

export interface VideoMatchCursor {
  categoryIndex: number
  statusIndex: number
  page: number
}

interface AlbumIndex {
  albums: AlbumCandidate[]
  withoutFields: number
  withoutVideo: number
  duplicated: Set<string>
  loadedAt: number
}

// Индекс выгрузки переиспользуется между чанками сборки: 11k альбомов читаются
// из scraping-БД один раз, дальше сравнение идёт в памяти.
let albumIndexCache: { batchId: string; value: AlbumIndex } | null = null
let categoryNamesCache: { expiresAt: number; value: Map<string, string> } | null = null

async function loadAlbumIndex(batchId: string): Promise<AlbumIndex> {
  if (albumIndexCache && albumIndexCache.batchId === batchId) return albumIndexCache.value
  const result = await scrapingQuery<{
    id: number; external_id: string; source_position: number | null; description: string | null
    photos: any; attributes: any
  }>(
    `SELECT id, external_id, source_position, description, photos, attributes
     FROM products WHERE batch_id = $1 ORDER BY source_position NULLS LAST, id`,
    [batchId],
  )
  const { albums, withoutFields, withoutVideo } = buildAlbumIndex(result.rows)
  const value: AlbumIndex = {
    albums,
    withoutFields,
    withoutVideo,
    duplicated: duplicateVideoUrls(albums),
    loadedAt: Date.now(),
  }
  albumIndexCache = { batchId, value }
  return value
}

async function categoryNames() {
  if (categoryNamesCache && categoryNamesCache.expiresAt > Date.now()) return categoryNamesCache.value
  const lookups = await getRailsCatalogLookups()
  const map = new Map<string, string>()
  for (const item of [...lookups.categories, ...lookups.subcategories]) {
    if (item?.id) map.set(String(item.id), String(item.name || ''))
  }
  categoryNamesCache = { expiresAt: Date.now() + 5 * 60 * 1000, value: map }
  return map
}

function toCatalogInput(product: any, names: Map<string, string>, fallbackCategory: string): CatalogProductInput {
  const categoryId = String(product.subcategory || product.category || '')
  return {
    id: String(product.id),
    slug: product.slug || null,
    name: product.name || null,
    category: names.get(categoryId) || fallbackCategory,
    status: product.status || null,
    photoUrl: product.photos?.[0] || product.thumb || null,
    description: product.description || null,
  }
}

function nextCursor(cursor: VideoMatchCursor, totalPages: number, presetKeyCategories: number): VideoMatchCursor | null {
  if (cursor.page < totalPages) return { ...cursor, page: cursor.page + 1 }
  const nextStatus = cursor.statusIndex + 1
  if (nextStatus < STATUS_PASSES.length) return { categoryIndex: cursor.categoryIndex, statusIndex: nextStatus, page: 1 }
  const nextCategory = cursor.categoryIndex + 1
  if (nextCategory < presetKeyCategories) return { categoryIndex: nextCategory, statusIndex: 0, page: 1 }
  return null
}

export async function getVideoMatchStatsAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const [counts, index] = await Promise.all([videoMatchCounts(preset.batchId), loadAlbumIndex(preset.batchId)])
    const scope = await scrapingQuery<{ products: string }>(
      `SELECT COUNT(*)::text AS products FROM product_video_match_scope WHERE source_batch_id = $1`,
      [preset.batchId],
    )
    return {
      success: true,
      data: {
        counts,
        scannedProducts: Number(scope.rows[0]?.products || 0),
        albums: index.albums.length,
        albumsWithoutFields: index.withoutFields,
        albumsWithoutVideo: index.withoutVideo,
        albumIndexLoadedAt: index.loadedAt,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось получить статистику' }
  }
}

export async function listVideoMatchesAction(input: {
  presetKey: string
  status?: VideoMatchStatus | 'all'
  bands?: string[]
  onlyBest?: boolean
  onlySingleCandidate?: boolean
  search?: string
  category?: string
  limit?: number
  offset?: number
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(input.presetKey)
    const filters = { ...input, batchId: preset.batchId }
    const [rows, total] = await Promise.all([
      listVideoMatches(filters),
      countVideoMatches(filters),
    ])
    const alternatives = await listMatchAlternatives(preset.batchId, [...new Set(rows.map((row) => row.crm_product_id))])
    const grouped = new Map<string, typeof alternatives>()
    for (const row of alternatives) {
      const bucket = grouped.get(row.crm_product_id)
      if (bucket) bucket.push(row)
      else grouped.set(row.crm_product_id, [row])
    }
    return {
      success: true,
      data: {
        rows: rows.map((row) => ({ ...row, alternatives: grouped.get(row.crm_product_id) || [] })),
        total,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить совпадения' }
  }
}

export async function listVideoMatchMissesAction(presetKey: string, limit = 50): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    return { success: true, data: await listScopeWithoutCandidates(preset.batchId, limit) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить товары без совпадений' }
  }
}

/** Один чанк сборки совпадений: страница товаров каталога + пересчёт вариантов. */
export async function buildVideoMatchesChunkAction(
  presetKey: string,
  cursor?: VideoMatchCursor,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const position: VideoMatchCursor = cursor || { categoryIndex: 0, statusIndex: 0, page: 1 }
    const category = preset.categories[position.categoryIndex]
    if (!category) {
      return { success: true, data: { done: true, cursor: position, next: null, scanned: 0, candidates: 0 } }
    }

    const [index, names] = await Promise.all([loadAlbumIndex(preset.batchId), categoryNames()])
    const status = STATUS_PASSES[position.statusIndex]?.value
    const page = await listRailsAdminProducts({
      page: position.page,
      perPage: PAGE_SIZE,
      brand: preset.brandSlug,
      category: category.slug,
      status: status as any,
    })

    const products = page.products.map((product) => toCatalogInput(product, names, category.name))
    const rows = buildMatchRows({ products, albums: index.albums, duplicateVideos: index.duplicated })
    const perProduct = new Map<string, number>()
    for (const row of rows) perProduct.set(row.crmProductId, Math.max(perProduct.get(row.crmProductId) || 0, row.candidatesTotal))

    await saveMatchRows(preset.batchId, preset.supplierId, rows, products.map((product) => product.id))
    await saveMatchScope(preset.batchId, products.map((product) => ({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      status: product.status,
      photoUrl: product.photoUrl,
      candidates: perProduct.get(product.id) || 0,
      crmFields: parseCatalogFields(product.description) as unknown as Record<string, string | null>,
    })))

    const totalPages = Math.max(Number(page.totalPages || 1), 1)
    const next = nextCursor(position, totalPages, preset.categories.length)
    return {
      success: true,
      data: {
        done: next === null,
        cursor: position,
        next,
        scanned: products.length,
        candidates: rows.length,
        matched: perProduct.size,
        totalItems: page.totalItems,
        category: category.name,
        stage: STATUS_PASSES[position.statusIndex]?.label,
        albumIndex: {
          albums: index.albums.length,
          withoutFields: index.withoutFields,
          withoutVideo: index.withoutVideo,
        },
      },
    }
  } catch (error: any) {
    console.error('Build video matches chunk error:', error)
    return { success: false, error: error.message || 'Не удалось собрать совпадения' }
  }
}

/** Один чанк закрепления поставщика за товарами выбранных категорий. */
export async function attachVideoMatchSupplierChunkAction(
  presetKey: string,
  cursor?: VideoMatchCursor,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const position: VideoMatchCursor = cursor || { categoryIndex: 0, statusIndex: 0, page: 1 }
    const category = preset.categories[position.categoryIndex]
    if (!category) {
      return { success: true, data: { done: true, next: null, updated: 0, skipped: 0 } }
    }

    const status = STATUS_PASSES[position.statusIndex]?.value
    const page = await listRailsAdminProducts({
      page: position.page,
      perPage: PAGE_SIZE,
      brand: preset.brandSlug,
      category: category.slug,
      status: status as any,
    })

    let updated = 0
    let skipped = 0
    const failures: string[] = []
    // Один товар = один PATCH в Rails; последовательный обход 100 товаров занимал
    // около минуты, поэтому страница обрабатывается небольшим пулом.
    const queue = [...page.products]
    const workers = Array.from({ length: Math.min(SUPPLIER_PATCH_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const product = queue.shift()
        if (!product) return
        if (String(product.supplier?.name || '').trim() === preset.supplierName) { skipped += 1; continue }
        try {
          await patchRailsAdminProduct(String(product.id), { supplierName: preset.supplierName })
          updated += 1
        } catch (error: any) {
          failures.push(`${product.slug || product.id}: ${error?.message || 'ошибка'}`)
        }
      }
    })
    await Promise.all(workers)

    const totalPages = Math.max(Number(page.totalPages || 1), 1)
    const next = nextCursor(position, totalPages, preset.categories.length)
    return {
      success: true,
      data: {
        done: next === null,
        next,
        updated,
        skipped,
        failures: failures.slice(0, 5),
        totalItems: page.totalItems,
        category: category.name,
      },
    }
  } catch (error: any) {
    console.error('Attach supplier chunk error:', error)
    return { success: false, error: error.message || 'Не удалось закрепить поставщика' }
  }
}

export async function approveVideoMatchesAction(ids: number[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const updated = await approveMatches(ids.map(Number).filter(Number.isFinite))
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось апрувить' }
  }
}

export async function rejectVideoMatchesAction(ids: number[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const updated = await rejectMatches(ids.map(Number).filter(Number.isFinite))
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось отклонить' }
  }
}

export async function resetVideoMatchesAction(ids: number[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const updated = await resetMatches(ids.map(Number).filter(Number.isFinite))
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось вернуть в ожидание' }
  }
}

/** Откат массового апрува: все апрувнутые варианты партии возвращаются в ожидание. */
export async function resetApprovedVideoMatchesAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const updated = await resetApprovedMatches(preset.batchId)
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось сбросить апрув' }
  }
}

/** Повтор упавших заливок (таймаут загрузки видео и подобные сбои). */
export async function retryFailedVideoMatchesAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const updated = await retryFailedMatches(preset.batchId)
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось вернуть ошибки в очередь' }
  }
}

export async function bulkApproveVideoMatchesAction(
  presetKey: string,
  bands: string[],
  onlySingleCandidate = false,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const allowed = bands.filter((band) => ['exact', 'strong', 'probable', 'weak'].includes(band))
    if (allowed.length === 0) return { success: false, error: 'Не выбран ни один уровень совпадения' }
    const updated = await approveMatchesByBand(preset.batchId, allowed, onlySingleCandidate)
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось выполнить массовый апрув' }
  }
}

export async function clearVideoMatchesAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const deleted = await clearBatchMatches(preset.batchId)
    return { success: true, data: { deleted } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось очистить очередь' }
  }
}

/**
 * Один чанк применения: видео уезжает в S3 и прикрепляется к товару каталога.
 * Повторный запуск безопасен: S3-ключ детерминирован по ссылке источника.
 */
export async function applyApprovedVideoMatchesAction(presetKey: string, limit = 2): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findVideoMatchPreset(presetKey)
    const rows = await selectApprovedForApply(preset.batchId, limit)
    if (rows.length === 0) return { success: true, data: { processed: 0, applied: 0, failed: 0 } }

    const workflow = await import('../scripts/batch-workflow')

    let applied = 0
    let failed = 0
    await Promise.all(rows.map(async (row) => {
      try {
        const { videoKey, posterKey } = workflow.videoStorageKeys(row.video_source_url)
        const hosted = await workflow.uploadVideoIfNeeded(row.video_source_url, videoKey, posterKey)
        if (!hosted?.url) throw new Error('S3 не вернул ссылку на видео')
        await patchRailsAdminProduct(row.crm_product_id, {
          videoUrl: hosted.url,
          videoPosterUrl: hosted.posterUrl || null,
        })
        await markMatchApplied(row.id, hosted.url, hosted.posterUrl || null)
        applied += 1
      } catch (error: any) {
        failed += 1
        await markMatchFailed(row.id, error?.message || 'ошибка применения')
      }
    }))

    return { success: true, data: { processed: rows.length, applied, failed } }
  } catch (error: any) {
    console.error('Apply approved video matches error:', error)
    return { success: false, error: error.message || 'Не удалось применить видео' }
  }
}

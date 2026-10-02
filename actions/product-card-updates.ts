'use server'

import { requireAdmin } from '@/lib/admin-session'
import { listRailsAdminProducts } from '@/lib/rails-admin'
import { buildHermesCardProposal, type HermesCardKind } from '@/lib/hermes-card-build'
import { findProductCardPreset, PRODUCT_CARD_PRESETS } from '@/lib/product-card-presets'
import {
  approveCardUpdates,
  approveCardUpdatesSafe,
  cardUpdateCounts,
  clearPendingCardUpdates,
  countCardUpdates,
  listCardUpdates,
  listCardUpdatesByIds,
  markCardUpdateAiFailed,
  rejectCardUpdates,
  resetCardUpdates,
  saveCardProposals,
  saveCardUpdateAi,
  selectPendingCardUpdatesForAi,
  type CardAiStatus,
  type CardKind,
  type CardMediaItem,
  type CardUpdateStatus,
} from '@/lib/product-card-updates'
import { applyApprovedCardUpdates } from '@/lib/product-card-apply'
import { runProductCardAi, PRODUCT_CARD_AI_SYSTEM_PROMPT } from '@/lib/product-card-ai'
import { resolveCardSupplierPrompt, saveCardSupplierSettings } from '@/lib/product-card-suppliers'
import {
  cardAiRunProgress,
  ensureCardAiTasks,
  getCardAiRun,
  isCardAiRunActive,
  startCardAiRun,
  stopCardAiRun,
} from '@/lib/product-card-ai-run'
import { hydrateBatchAiSettings } from '@/lib/batch-ai-settings'
import type { BatchAiSettings } from '@/lib/batch-ai'
import { getBatchAiSettingsAction } from '@/actions/batch-ai'
import type { ActionResponse } from '@/lib/types'

/**
 * Обработка уже опубликованных карточек поставщика по правилам выгрузки.
 *
 * Скан идёт по страницам каталога Rails (поставщик + категория + статус
 * `active`), предложение собирается детерминированным слоем, а ИИ-текст и
 * альты добавляются отдельным проходом. Ничего не пишется в Rails до апрува.
 */

const PAGE_SIZE = 100
/** Сколько товаров применяем за один вызов: два запроса Rails на товар. */
const APPLY_LIMIT = 10

export interface ProductCardCursor {
  categoryIndex: number
  page: number
}

function toCardMedia(media: unknown): CardMediaItem[] {
  if (!Array.isArray(media)) return []
  return media
    .filter((item: any) => item?.original_url || item?.preview_url)
    .map((item: any) => ({
      original_url: String(item.original_url || item.preview_url || ''),
      thumb_url: item.thumb_url || '',
      preview_url: item.preview_url || '',
      og_image_url: item.og_image_url || '',
      alt_text: String(item.alt_text || ''),
      sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : 0,
      processing_status: item.processing_status || 'processed',
    }))
}

/**
 * Пресеты как список поставщиков: сколько товаров в очереди, сколько обработал
 * ИИ и сколько осталось. По этой строке оператор открывает карточки поставщика.
 */
export async function listProductCardSuppliersAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const suppliers = await Promise.all(PRODUCT_CARD_PRESETS.map(async (preset) => {
      const [counts, prompt] = await Promise.all([
        cardUpdateCounts(preset.supplierUuid),
        resolveCardSupplierPrompt(preset.key),
      ])
      return {
        key: preset.key,
        title: preset.title,
        supplierName: preset.supplierName,
        brandSlug: preset.brandSlug,
        categories: preset.categories.length,
        counts,
        promptStored: prompt.stored.trim().length > 0,
        promptLength: prompt.stored.trim().length,
        packagingStored: prompt.packagingStored.trim().length > 0,
      }
    }))
    return { success: true, data: { suppliers } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить поставщиков' }
  }
}

/** Запускает фоновый прогон ИИ по всем карточкам поставщика. */
export async function startProductCardsAiRunAction(presetKey: string, batchSize = 4): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    await startCardAiRun(preset.supplierUuid, batchSize)
    // Будим супервизор, чтобы прогон начался без ожидания его таймера.
    void ensureCardAiTasks().catch(() => {})
    return { success: true, data: { run: await getCardAiRun(preset.supplierUuid) } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось запустить прогон ИИ' }
  }
}

export async function stopProductCardsAiRunAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const stopped = await stopCardAiRun(preset.supplierUuid)
    return { success: true, data: { stopped } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось остановить прогон ИИ' }
  }
}

/** Прогресс прогона ИИ: сколько обработано, сколько осталось, жив ли цикл. */
export async function getProductCardsAiRunAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const [run, active, progress] = await Promise.all([
      getCardAiRun(preset.supplierUuid),
      isCardAiRunActive(preset.supplierUuid),
      cardAiRunProgress(preset.supplierUuid),
    ])
    return {
      success: true,
      data: {
        run,
        active,
        remaining: progress.remaining,
        aiReady: progress.counts.aiReady,
        aiFailed: progress.counts.aiFailed,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось прочитать прогресс ИИ' }
  }
}

/** Промпт поставщика и блок комплектации: сохранённые тексты и подсказки. */
export async function getProductCardPromptAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const resolved = await resolveCardSupplierPrompt(preset.key)
    return {
      success: true,
      data: {
        supplierName: preset.supplierName,
        stored: resolved.stored,
        fallback: resolved.fallback,
        effective: resolved.effective,
        packagingStored: resolved.packagingStored,
        packagingFallback: resolved.packagingFallback,
        packaging: resolved.packaging,
        base: PRODUCT_CARD_AI_SYSTEM_PROMPT,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось прочитать промпт поставщика' }
  }
}

export async function saveProductCardPromptAction(
  presetKey: string,
  prompt: string,
  packaging: string,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    await saveCardSupplierSettings(preset.supplierUuid, { prompt, packaging })
    const resolved = await resolveCardSupplierPrompt(preset.key)
    return {
      success: true,
      data: {
        stored: resolved.stored,
        effective: resolved.effective,
        packagingStored: resolved.packagingStored,
        packaging: resolved.packaging,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось сохранить промпт поставщика' }
  }
}

export async function getProductCardStatsAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const counts = await cardUpdateCounts(preset.supplierUuid)
    return {
      success: true,
      data: {
        counts,
        preset: { key: preset.key, title: preset.title, supplierName: preset.supplierName, categories: preset.categories.length },
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось получить статистику' }
  }
}

export async function listProductCardsAction(input: {
  presetKey: string
  status?: CardUpdateStatus | 'all'
  kind?: CardKind | 'all'
  aiStatus?: CardAiStatus | 'all'
  search?: string
  limit?: number
  offset?: number
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(input.presetKey)
    const filters = {
      supplierId: preset.supplierUuid,
      status: input.status || 'pending',
      kind: input.kind || 'all',
      aiStatus: input.aiStatus || 'all',
      search: input.search,
    }
    const [rows, total] = await Promise.all([
      listCardUpdates({ ...filters, limit: input.limit, offset: input.offset }),
      countCardUpdates(filters),
    ])
    return { success: true, data: { rows, total } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить карточки' }
  }
}

/**
 * Один чанк сканирования: страница каталога поставщика в выбранной категории,
 * затем следующая страница, затем следующая категория. Решения оператора
 * сохраняются: обновляются только строки в статусе `pending`.
 */
export async function scanProductCardsChunkAction(
  presetKey: string,
  cursor?: ProductCardCursor,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const position: ProductCardCursor = cursor || { categoryIndex: 0, page: 1 }
    const category = preset.categories[position.categoryIndex]
    if (!category) {
      return { success: true, data: { done: true, next: null, scanned: 0, saved: 0 } }
    }

    const page = await listRailsAdminProducts({
      page: position.page,
      perPage: PAGE_SIZE,
      supplier: preset.supplierUuid,
      category: category.slug,
      status: 'active',
    })

    const rows = (page.products || []).map((product) => {
      const attributes = product.catalog_attributes && typeof product.catalog_attributes === 'object'
        ? product.catalog_attributes as Record<string, unknown>
        : {}
      const currentMedia = toCardMedia(product.media)
      const proposal = buildHermesCardProposal({
        name: product.name,
        description: product.description,
        attributes,
        mediaCount: currentMedia.length,
        kind: category.kind as HermesCardKind,
        categoryName: category.name,
        gender: (product as any).gender || null,
        brandSlug: preset.brandSlug,
        article: product.seo_article,
        currentSlug: product.slug,
      })
      return {
        crmProductId: String(product.id),
        crmSlug: product.slug || null,
        category: category.name,
        categorySlug: category.slug,
        kind: category.kind,
        currentName: product.name || null,
        currentSlug: product.slug || null,
        currentDescription: product.description || null,
        currentAttributes: attributes,
        currentMedia,
        proposedName: proposal.name,
        proposedSlug: proposal.slug,
        proposedDescription: proposal.description,
        proposedAttributes: proposal.attributes,
        proposedPhotoAlts: proposal.photoAlts,
        attributePatch: proposal.attributePatch,
        warnings: proposal.warnings,
        modelName: proposal.modelName,
        sizeToken: proposal.sizeToken,
      }
    })

    const saved = await saveCardProposals(preset.supplierUuid, rows)
    const totalPages = Math.max(Number(page.totalPages || 1), 1)
    const next: ProductCardCursor | null = position.page < totalPages
      ? { categoryIndex: position.categoryIndex, page: position.page + 1 }
      : (position.categoryIndex + 1 < preset.categories.length
        ? { categoryIndex: position.categoryIndex + 1, page: 1 }
        : null)

    return {
      success: true,
      data: {
        done: next === null,
        next,
        scanned: rows.length,
        saved,
        totalItems: page.totalItems,
        category: category.name,
        kind: category.kind,
      },
    }
  } catch (error: any) {
    console.error('Scan product cards chunk error:', error)
    return { success: false, error: error.message || 'Не удалось собрать предложения' }
  }
}

export async function decideProductCardsAction(
  ids: number[],
  action: 'approve' | 'reject' | 'reset',
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const clean = ids.map(Number).filter(Number.isFinite)
    if (clean.length === 0) return { success: false, error: 'Не выбрано ни одной карточки' }
    const updated = action === 'approve'
      ? await approveCardUpdates(clean)
      : action === 'reject'
        ? await rejectCardUpdates(clean)
        : await resetCardUpdates(clean)
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось сохранить решение' }
  }
}

/** Массовый апрув: карточки без спорных предупреждений и с готовым ИИ-текстом. */
export async function approveSafeProductCardsAction(
  presetKey: string,
  kind: CardKind | 'all' = 'all',
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const updated = await approveCardUpdatesSafe(preset.supplierUuid, { kind })
    return { success: true, data: { updated } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось выполнить массовый апрув' }
  }
}

/** Применение порции апрувнутых карточек: содержимое и явный адрес в Rails. */
export async function applyProductCardsChunkAction(presetKey: string, limit = APPLY_LIMIT): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const result = await applyApprovedCardUpdates(preset.supplierUuid, limit)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось применить карточки' }
  }
}

/**
 * ИИ-проход по выбранным карточкам: полное описание и альты фотографий.
 * Обрабатываем небольшими порциями — один запрос модели и contact sheet на товар.
 */
export async function runProductCardsAiAction(
  presetKey: string,
  ids: number[] = [],
  limit = 3,
): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const clean = ids.map(Number).filter(Number.isFinite)
    const rows = clean.length > 0
      ? (await listCardUpdatesByIds(clean)).slice(0, Math.max(1, limit))
      : await selectPendingCardUpdatesForAi(preset.supplierUuid, limit)
    if (rows.length === 0) {
      return { success: true, data: { processed: 0, ready: 0, failed: 0, failures: [] } }
    }

    const settingsResult = await getBatchAiSettingsAction()
    if (!settingsResult.success || !settingsResult.data) {
      throw new Error('Не удалось прочитать настройки ИИ в «Выгрузках»')
    }
    const settings = await hydrateBatchAiSettings(settingsResult.data as BatchAiSettings)
    const model = settings.provider === 'byesu' ? settings.byesuModel : settings.openrouterModel
    const supplierPrompt = await resolveCardSupplierPrompt(preset.key)

    let ready = 0
    let failed = 0
    const failures: string[] = []
    for (const row of rows) {
      try {
        const result = await runProductCardAi(row, settings, supplierPrompt.effective, supplierPrompt.packaging)
        // Материалы из ответа модели дополняют характеристики, если там пусто.
        const attributes = { ...(row.proposed_attributes || {}) }
        if (result.materials.length > 0 && !attributes.materials) attributes.materials = result.materials
        await saveCardUpdateAi(row.id, {
          description: result.description,
          photoAlts: result.photoAlts,
          model,
          attributes,
        })
        ready += 1
      } catch (error: any) {
        failed += 1
        const message = String(error?.message || error || 'ошибка ИИ').slice(0, 500)
        failures.push(`${row.current_slug || row.crm_product_id}: ${message}`)
        await markCardUpdateAiFailed(row.id, message, model)
      }
    }

    return {
      success: true,
      data: {
        processed: rows.length,
        ready,
        failed,
        failures: failures.slice(0, 5),
        provider: settings.provider,
        model,
        promptSource: supplierPrompt.stored.trim() ? 'supplier' : 'default',
      },
    }
  } catch (error: any) {
    console.error('Product card AI error:', error)
    return { success: false, error: error.message || 'Не удалось обработать карточки ИИ' }
  }
}

export async function clearPendingProductCardsAction(presetKey: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const preset = findProductCardPreset(presetKey)
    const deleted = await clearPendingCardUpdates(preset.supplierUuid)
    return { success: true, data: { deleted } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось очистить очередь' }
  }
}

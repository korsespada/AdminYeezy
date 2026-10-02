import { getRailsAdminProduct, patchRailsAdminProduct, setRailsAdminProductSlug } from '@/lib/rails-admin'
import {
  markCardUpdateApplied,
  markCardUpdateFailed,
  selectApprovedCardUpdates,
  type CardMediaItem,
  type CardUpdateRecord,
} from '@/lib/product-card-updates'

/**
 * Применение апрувнутых карточек в Rails.
 *
 * Порядок: сначала содержимое (`PATCH /admin/products/:id`: название, описание,
 * характеристики, альты фото), затем явный адрес отдельным вызовом, потому что
 * Rails пересчитывает канонический slug на каждой записи, а `set_slug`
 * закрепляет его флагом `slug_locked`.
 *
 * Медиа переносится из свежей карточки Rails, а не из снимка сканирования:
 * если у товара появились новые фото, они не потеряются. Альты подставляются
 * по совпадению URL, поэтому порядок кадров не важен.
 */

const APPLY_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1500, 5000]

/** Ошибка Rails занимает килобайты JSON: оставляем суть. */
export function compactCardError(error: unknown) {
  const message = String((error as any)?.message || error || 'ошибка применения')
  return message.length > 500 ? `${message.slice(0, 500)}…` : message
}

/**
 * Подставляет альты из предложения в текущий список медиа.
 * Совпавшие по URL кадры получают новый alt, остальные сохраняют свой.
 */
export function mergeCardPhotoAlts(
  media: CardMediaItem[],
  alts: string[],
  snapshot: CardMediaItem[] = [],
) {
  const byUrl = new Map<string, string>()
  snapshot.forEach((item, index) => {
    const url = String(item.original_url || '')
    const alt = String(alts[index] || '').trim()
    if (url && alt) byUrl.set(url, alt)
  })
  return media.map((item) => {
    const url = String(item.original_url || '')
    const alt = byUrl.get(url) || String(item.alt_text || '').trim()
    return { ...item, alt_text: alt }
  })
}

/** Одна попытка: содержимое карточки плюс явный адрес. */
export async function applyCardUpdateOnce(row: CardUpdateRecord) {
  const fresh = await getRailsAdminProduct(row.crm_product_id)

  // Предложение собрано по снимку сканирования. Если название в каталоге уже
  // другое (кто-то правил карточку после скана), применение остановится, чтобы
  // не перезаписать чужие изменения: строку нужно пересобрать и проверить заново.
  const freshName = String(fresh.name || '')
  const scannedName = String(row.current_name || '')
  const proposedName = String(row.proposed_name || '')
  if (freshName !== scannedName && freshName !== proposedName) {
    throw new Error(`Карточка изменилась после скана («${freshName}» вместо «${scannedName}»): обновите очередь и проверьте предложение`)
  }

  const media = mergeCardPhotoAlts(
    Array.isArray(fresh.media) ? fresh.media as CardMediaItem[] : [],
    row.proposed_photo_alts || [],
    row.current_media || [],
  )

  // Описание заменяет только готовый ИИ-текст: черновик из фактов короче
  // текущего публичного текста и в Rails не уходит.
  const aiDescription = row.ai_status === 'ready' ? String(row.proposed_description || '').trim() : ''

  await patchRailsAdminProduct(row.crm_product_id, {
    name: proposedName || scannedName,
    ...(aiDescription ? { description: aiDescription } : {}),
    catalog_attributes: row.proposed_attributes || {},
    ...(media.length > 0 ? { media } : {}),
  })

  const requestedSlug = String(row.proposed_slug || '').trim()
  if (!requestedSlug) return { slug: null }
  const updated = await setRailsAdminProductSlug(row.crm_product_id, requestedSlug)
  return { slug: updated?.slug || requestedSlug }
}

/** Применяет порцию апрувнутых карточек, повторяя временные сбои. */
export async function applyApprovedCardUpdates(supplierId: string, limit: number) {
  const rows = await selectApprovedCardUpdates(supplierId, limit)
  if (rows.length === 0) return { processed: 0, applied: 0, failed: 0, failures: [] as string[] }

  let applied = 0
  let failed = 0
  const failures: string[] = []

  for (const row of rows) {
    let lastError: unknown = null
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
      try {
        const result = await applyCardUpdateOnce(row)
        await markCardUpdateApplied(row.id, result.slug)
        applied += 1
        lastError = null
        break
      } catch (error) {
        lastError = error
        const delay = RETRY_DELAYS_MS[attempt]
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    if (lastError) {
      const message = compactCardError(lastError)
      failed += 1
      failures.push(`${row.current_slug || row.crm_product_id}: ${message}`)
      await markCardUpdateFailed(row.id, message)
    }
  }

  return { processed: rows.length, applied, failed, failures: failures.slice(0, 10) }
}

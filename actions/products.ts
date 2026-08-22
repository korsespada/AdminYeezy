'use server'

import { revalidatePath } from 'next/cache'
import {
  createRailsAdminProduct,
  deleteRailsAdminProduct,
  getRailsAdminProduct,
  moveRailsAdminProductToTrash,
  restoreRailsAdminProductFromTrash,
  updateRailsAdminProduct,
} from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'

export async function createProductAction(formData: FormData): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const product = await createRailsAdminProduct(formData)
    revalidatePath('/admin')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Create product error:', error)
    return { success: false, error: error.message || 'Failed to create product' }
  }
}

export async function updateProductAction(id: string, formData: FormData): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const product = await updateRailsAdminProduct(id, formData)
    revalidatePath('/admin')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Update product error:', error)
    return { success: false, error: error.message || 'Failed to update product' }
  }
}

export async function getProductAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await getRailsAdminProduct(id) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить товар' }
  }
}

export interface ProductVideoRehostResponse extends ActionResponse {
  /** True, когда ссылка уже ведёт на наш S3 и перезалив не требуется. */
  alreadyHosted?: boolean
  url?: string
  posterUrl?: string | null
}

/**
 * Перезаливает внешнее видео в собственный S3 по схеме выгрузок:
 * детерминированные ключи videos/{sha256}.mp4, перекодирование ffmpeg
 * и автоматический постер. Возвращает публичные ссылки на наш бакет.
 */
export async function rehostProductVideoAction(url: string): Promise<ProductVideoRehostResponse> {
  try {
    await requireAdmin()

    const sourceUrl = String(url || '').trim()
    // Ленивый динамический импорт: модуль выгрузок создаёт пулы и S3-клиент,
    // поэтому не должен загружаться при обычных операциях с товарами.
    const workflow = await import('../scripts/batch-workflow')

    if (!sourceUrl) {
      return { success: false, error: 'Пустая ссылка на видео' }
    }
    const parsed = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Для видео разрешены только HTTP(S) ссылки' }
    }
    if (workflow.isAlreadyHosted(sourceUrl)) {
      return { success: true, alreadyHosted: true, url: sourceUrl, posterUrl: null }
    }
    if (!process.env.S3_BUCKET) {
      return { success: false, error: 'S3_BUCKET не настроен — перезалив видео недоступен' }
    }

    const { videoKey, posterKey } = workflow.videoStorageKeys(sourceUrl)
    const hosted = await workflow.uploadVideoIfNeeded(sourceUrl, videoKey, posterKey)
    return { success: true, url: hosted.url || undefined, posterUrl: hosted.posterUrl || undefined }
  } catch (error: any) {
    console.error('Rehost product video error:', error)
    return { success: false, error: error.message || 'Не удалось перезалить видео в S3' }
  }
}

export async function deleteProductAction(id: string): Promise<ActionResponse> {
  return moveProductToTrashAction(id)
}

export async function moveProductToTrashAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    await moveRailsAdminProductToTrash(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Move product to trash error:', error)
    return { success: false, error: error.message || 'Failed to move product to trash' }
  }
}

export async function restoreProductFromTrashAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const product = await restoreRailsAdminProductFromTrash(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true, data: product }
  } catch (error: any) {
    console.error('Restore product from trash error:', error)
    return { success: false, error: error.message || 'Failed to restore product' }
  }
}

export async function deleteProductPermanentlyAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    await deleteRailsAdminProduct(id)
    revalidatePath('/admin')
    revalidatePath('/admin/trash')
    return { success: true }
  } catch (error: any) {
    console.error('Permanent delete product error:', error)
    return { success: false, error: error.message || 'Failed to permanently delete product' }
  }
}

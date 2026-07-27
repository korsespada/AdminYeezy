'use server'

import { revalidatePath } from 'next/cache'
import {
  applyRailsSeoAiDraft,
  createRailsSeoAiBatch,
  createRailsSeoAiSuggestedSubcategory,
  createRailsSeoAiLandingIdeas,
  deleteRailsSeoAiDraft,
  getRailsAdminProduct,
  getRailsSeoAiBatch,
  getRailsSeoAiSettings,
  listRailsAdminProducts,
  listRailsSeoAiDrafts,
  listRailsSeoAiBatches,
  previewRailsSeoAiBatch,
  rejectRailsSeoAiDraft,
  renameRailsSeoAiBatch,
  reviewRailsSeoAiBatch,
  retryRailsSeoAiGeneration,
  runRailsSeoAiGeneration,
  searchRailsAdminProductsExact,
  updateRailsSeoAiSettings,
  updateRailsSeoAiBatchState,
} from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse, SeoAiGeneration, SeoAiSetting } from '@/lib/types'

const SEO_AI_PATH = '/admin/seo-ai'

export async function getSeoAiSettingsAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await getRailsSeoAiSettings() }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to load SEO AI settings' }
  }
}

export async function updateSeoAiSettingsAction(settings: SeoAiSetting[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const updated = await updateRailsSeoAiSettings(settings)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: updated }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update SEO AI settings' }
  }
}

export async function searchSeoAiProductsAction(query: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const search = query.trim()
    if (!search) return { success: true, data: [] }

    const exact = await searchRailsAdminProductsExact(search)
    if (exact.length > 0) return { success: true, data: exact.slice(0, 12) }

    const list = await listRailsAdminProducts({ page: 1, perPage: 12, search })
    return { success: true, data: list.products }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to search products' }
  }
}

export async function getSeoAiProductAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await getRailsAdminProduct(id) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to load product' }
  }
}

export async function runSeoAiGenerationAction(input: {
  targetType: string
  targetId?: string | null
  draftType?: string
  includeImages?: boolean
  imageLimit?: number
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const generation = await runRailsSeoAiGeneration(input)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: generation }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to run SEO AI generation' }
  }
}

export async function createSeoAiBatchAction(input: {
  ids?: string[]
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  status?: string
  missingSeoOnly?: boolean
  includeProcessed?: boolean
  includeImages?: boolean
  autoApply?: boolean
  itemLimit?: number
  concurrency?: number
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await createRailsSeoAiBatch(input)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create SEO AI batch' }
  }
}

export async function listSeoAiDraftsAction(options: { status?: string; draftType?: string; targetType?: string; limit?: number } = {}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await listRailsSeoAiDrafts(options) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to load SEO AI drafts' }
  }
}

export async function listSeoAiBatchesAction(): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await listRailsSeoAiBatches() }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to load AI batches' }
  }
}

export async function getSeoAiBatchAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await getRailsSeoAiBatch(id) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось загрузить выгрузку' }
  }
}

export async function previewSeoAiBatchAction(input: {
  ids?: string[]
  brand?: string
  category?: string
  subcategory?: string
  gender?: string
  status?: string
  missingSeoOnly?: boolean
  includeProcessed?: boolean
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    return { success: true, data: await previewRailsSeoAiBatch(input) }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось посчитать товары' }
  }
}

export async function updateSeoAiBatchStateAction(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const batch = await updateRailsSeoAiBatchState(id, action)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: batch }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update AI batch' }
  }
}

export async function renameSeoAiBatchAction(id: string, name: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const batch = await renameRailsSeoAiBatch(id, name.trim())
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: batch }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось переименовать выгрузку' }
  }
}

export async function reviewSeoAiBatchAction(id: string, action: 'apply_drafts' | 'apply_safe_drafts' | 'reject_drafts' | 'requeue_rejected'): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await reviewRailsSeoAiBatch(id, action)
    revalidatePath(SEO_AI_PATH)
    revalidatePath('/admin')
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось выполнить массовое действие' }
  }
}

export async function retrySeoAiGenerationAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const generation = await retryRailsSeoAiGeneration(id)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: generation }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to retry AI generation' }
  }
}

export async function createSeoAiSuggestedSubcategoryAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await createRailsSeoAiSuggestedSubcategory(id)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create suggested subcategory' }
  }
}

const SEO_AI_PRODUCT_BULK_FIELDS = [
  'name',
  'description',
  'h1',
  'seo_title',
  'seo_description',
  'gender',
  'catalog_attributes',
  'subcategory_suggestion',
  'image_alt_texts',
]

export async function applySeoAiDecisionGroupAction(input: {
  draftIds: string[]
  createSubcategory?: boolean
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const draftIds = [...new Set(input.draftIds.map((id) => id.trim()).filter(Boolean))].slice(0, 500)
    const generations: SeoAiGeneration[] = []
    const errors: Array<{ id: string; message: string }> = []
    const readyIds: string[] = []

    if (input.createSubcategory) {
      for (const id of draftIds) {
        try {
          await createRailsSeoAiSuggestedSubcategory(id)
          readyIds.push(id)
        } catch (error: any) {
          errors.push({ id, message: error.message || 'Не удалось создать подкатегорию' })
        }
      }
    } else {
      readyIds.push(...draftIds)
    }

    for (let index = 0; index < readyIds.length; index += 10) {
      const results: Array<{
        generation?: SeoAiGeneration
        error?: { id: string; message: string }
      }> = await Promise.all(readyIds.slice(index, index + 10).map(async (id) => {
        try {
          const result = await applyRailsSeoAiDraft(id, SEO_AI_PRODUCT_BULK_FIELDS)
          return { generation: result.generation }
        } catch (error: any) {
          return { error: { id, message: error.message || 'Не удалось применить решение' } }
        }
      }))

      results.forEach((result) => {
        if (result.generation) generations.push(result.generation)
        if (result.error) errors.push(result.error)
      })
    }

    revalidatePath(SEO_AI_PATH)
    revalidatePath('/admin')
    return { success: true, data: { generations, processed: generations.length, errors } }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось применить групповое решение' }
  }
}

export async function applySeoAiDraftAction(id: string, fields?: string[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await applyRailsSeoAiDraft(id, fields)
    revalidatePath(SEO_AI_PATH)
    revalidatePath('/admin')
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to apply SEO AI draft' }
  }
}

export async function rejectSeoAiDraftAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const generation = await rejectRailsSeoAiDraft(id)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: generation }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to reject SEO AI draft' }
  }
}

export async function deleteSeoAiDraftAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    await deleteRailsSeoAiDraft(id)
    revalidatePath(SEO_AI_PATH)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete SEO AI draft' }
  }
}

export async function createSeoAiLandingIdeasAction(filters: Record<string, any>): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const generation = await createRailsSeoAiLandingIdeas(filters)
    revalidatePath(SEO_AI_PATH)
    return { success: true, data: generation }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create landing ideas' }
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import {
  approveRailsCatalogAttributeSuggestion,
  bulkApproveRailsCatalogAttributeSuggestions,
  bulkApproveFilteredRailsCatalogAttributeSuggestions,
  bulkRejectRailsCatalogAttributeSuggestions,
  rejectRailsCatalogAttributeSuggestion,
  updateRailsCatalogAttributeSuggestionValue,
} from '@/lib/rails-admin'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'

const CATALOG_ATTRIBUTES_PATH = '/admin/catalog-attributes'

export async function approveCatalogAttributeSuggestionAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const suggestion = await approveRailsCatalogAttributeSuggestion(id)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: suggestion }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось подтвердить значение' }
  }
}

export async function rejectCatalogAttributeSuggestionAction(id: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const suggestion = await rejectRailsCatalogAttributeSuggestion(id)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: suggestion }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось отклонить значение' }
  }
}

export async function updateCatalogAttributeSuggestionValueAction(id: string, value: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const suggestion = await updateRailsCatalogAttributeSuggestionValue(id, value)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: suggestion }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось изменить предложенное значение' }
  }
}

export async function bulkApproveCatalogAttributeSuggestionsAction(ids: string[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await bulkApproveRailsCatalogAttributeSuggestions(ids)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось подтвердить выбранные значения' }
  }
}

export async function bulkRejectCatalogAttributeSuggestionsAction(ids: string[]): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await bulkRejectRailsCatalogAttributeSuggestions(ids)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось отклонить выбранные значения' }
  }
}

export async function bulkApproveFilteredCatalogAttributeSuggestionsAction(filters: {
  query?: string
  attributeCode?: string
  brand?: string
  category?: string
  subcategory?: string
  suggestedValue?: string
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const result = await bulkApproveFilteredRailsCatalogAttributeSuggestions(filters)
    revalidatePath(CATALOG_ATTRIBUTES_PATH)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось подтвердить предложения по фильтрам' }
  }
}

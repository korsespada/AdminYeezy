'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import {
  updateCatalogAttributeDefinition,
  upsertCatalogAttributeDictionaryValue,
} from '@/lib/catalog-attribute-registry'
import type { ActionResponse } from '@/lib/types'

const REGISTRY_PATH = '/admin/filter-characteristics'

export async function updateCatalogAttributeDefinitionAction(input: {
  code: string
  label?: string
  show_as_characteristic: boolean
  use_as_filter: boolean
  use_as_variant_dimension: boolean
  active: boolean
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const code = input.code.trim()
    if (!code) return { success: false, error: 'Не указан код атрибута' }

    const definition = await updateCatalogAttributeDefinition(code, {
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      show_as_characteristic: true,
      use_as_filter: Boolean(input.use_as_filter),
      use_as_variant_dimension: Boolean(input.use_as_variant_dimension),
      active: Boolean(input.active),
    })
    if (!definition) return { success: false, error: 'Атрибут не найден' }

    revalidatePath(REGISTRY_PATH)
    return { success: true, data: definition }
  } catch (error: any) {
    return { success: false, error: error.message || 'Не удалось сохранить настройки атрибута' }
  }
}

export async function upsertCatalogAttributeDictionaryValueAction(input: {
  id?: string
  attribute_code: string
  filter_value: string
  canonical_value: string
  aliases: string[]
  active: boolean
}): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const attributeCode = input.attribute_code.trim()
    const filterValue = input.filter_value.trim()
    const canonicalValue = input.canonical_value.trim()
    if (!attributeCode) return { success: false, error: 'Не указан атрибут' }
    if (!filterValue) return { success: false, error: 'Введите код для API' }
    if (!canonicalValue) return { success: false, error: 'Введите каноническое значение' }

    const value = await upsertCatalogAttributeDictionaryValue({
      id: input.id,
      attribute_code: attributeCode,
      filter_value: filterValue,
      canonical_value: canonicalValue,
      aliases: Array.isArray(input.aliases) ? input.aliases : [],
      active: Boolean(input.active),
    })
    if (!value) return { success: false, error: 'Значение справочника не найдено' }

    revalidatePath(REGISTRY_PATH)
    return { success: true, data: value }
  } catch (error: any) {
    const duplicate = error?.code === '23505'
    return {
      success: false,
      error: duplicate
        ? 'Такое каноническое значение уже есть в справочнике'
        : error.message || 'Не удалось сохранить значение справочника',
    }
  }
}

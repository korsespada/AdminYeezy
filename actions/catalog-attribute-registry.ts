'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import { updateCatalogAttributeDefinition } from '@/lib/catalog-attribute-registry'
import type { ActionResponse } from '@/lib/types'

const REGISTRY_PATH = '/admin/filter-characteristics'

export async function updateCatalogAttributeDefinitionAction(input: {
  code: string
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
      show_as_characteristic: Boolean(input.show_as_characteristic),
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

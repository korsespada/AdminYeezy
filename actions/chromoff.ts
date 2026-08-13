'use server'

import { revalidatePath } from 'next/cache'
import { buildChromoffImportPayload } from '@/lib/chromoff-source'
import { bulkUpdateRailsChromoffListingsPublished, createRailsChromoffListing, runRailsChromoffImport, updateRailsChromoffListing } from '@/lib/rails-admin'

export async function setChromoffListingPublishedAction(formData: FormData) {
  const id = String(formData.get('id') || '').trim()
  if (!id) return { success: false, message: 'Не указан товар Chromoff.' }

  const published = String(formData.get('published') || '') === 'true'
  try {
    await updateRailsChromoffListing(id, { published })
    revalidatePath('/admin/chromoff')
    return { success: true, message: published ? 'Товар опубликован в Chromoff.' : 'Товар скрыт с Chromoff.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось обновить публикацию.' }
  }
}

export async function setChromoffListingsPublishedAction(listingIds: string[], published: boolean) {
  const ids = [...new Set(listingIds.map(String).map((value) => value.trim()).filter(Boolean))]
  if (!ids.length) return { success: false, message: 'Не выбраны карточки Chromoff.' }

  try {
    const result = await bulkUpdateRailsChromoffListingsPublished(ids, published)
    revalidatePath('/admin/chromoff')
    return { success: true, updated: result.updated, message: published ? 'Товары опубликованы в Chromoff.' : 'Товары скрыты с Chromoff.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось обновить публикацию.' }
  }
}

export async function updateChromoffListingSeoAction(formData: FormData) {
  const id = String(formData.get('id') || '').trim()
  if (!id) return { success: false, message: 'Не указан товар Chromoff.' }

  try {
    await updateRailsChromoffListing(id, {
      h1: String(formData.get('h1') || '').trim(),
      seoTitle: String(formData.get('seo_title') || '').trim(),
      seoDescription: String(formData.get('seo_description') || '').trim(),
    })
    revalidatePath('/admin/chromoff')
    return { success: true, message: 'SEO Chromoff сохранено.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось сохранить SEO Chromoff.' }
  }
}

export async function updateChromoffListingCategoryAction(formData: FormData) {
  const id = String(formData.get('id') || '').trim()
  const categoryId = String(formData.get('chromoff_category_id') || '').trim()
  if (!id || !categoryId) return { success: false, message: 'Выбери категорию Chromoff.' }

  try {
    await updateRailsChromoffListing(id, { chromoffCategoryId: categoryId })
    revalidatePath('/admin/chromoff')
    return { success: true, message: 'Категория Chromoff сохранена.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось сохранить категорию Chromoff.' }
  }
}

export async function updateChromoffListingAction(formData: FormData) {
  const id = String(formData.get('id') || '').trim()
  if (!id) return { success: false, message: 'Не указан товар Chromoff.' }

  try {
    const listing = await updateRailsChromoffListing(id, {
      published: String(formData.get('published') || '') === 'true',
      chromoffCategoryId: String(formData.get('chromoff_category_id') || '').trim() || undefined,
      legacySlug: String(formData.get('legacy_slug') || '').trim(),
      h1: String(formData.get('chromoff_h1') || '').trim(),
      seoTitle: String(formData.get('chromoff_seo_title') || '').trim(),
      seoDescription: String(formData.get('chromoff_seo_description') || '').trim(),
    })
    revalidatePath('/admin/chromoff')
    return { success: true, listing, message: 'Настройки Chromoff сохранены.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось сохранить настройки Chromoff.' }
  }
}

export async function createChromoffListingAction(formData: FormData) {
  const productId = String(formData.get('product_id') || '').trim()
  const chromoffCategoryId = String(formData.get('chromoff_category_id') || '').trim()
  if (!productId || !chromoffCategoryId) return { success: false, message: 'Выбери товар и подкатегорию Chromoff.' }

  try {
    await createRailsChromoffListing({
      productId,
      chromoffCategoryId,
      published: String(formData.get('published') || '') === 'true',
    })
    revalidatePath('/admin/chromoff')
    return { success: true, message: 'Товар добавлен в Chromoff.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось добавить товар в Chromoff.' }
  }
}

export async function previewChromoffImportAction() {
  try {
    const payload = await buildChromoffImportPayload()
    const result = await runRailsChromoffImport(payload, true)
    return { success: true, result }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось выполнить dry-run.' }
  }
}

export async function importChromoffCatalogAction() {
  try {
    const payload = await buildChromoffImportPayload()
    const dryRun = await runRailsChromoffImport(payload, true)
    if (dryRun.categories_missing_catalog_mapping > 0 || dryRun.missing_category_sources.length > 0) {
      return { success: false, message: 'Есть непривязанные категории. Импорт остановлен.', result: dryRun }
    }

    const chunkSize = Math.min(Math.max(Number(process.env.RAILS_IMPORT_CHUNK_SIZE || 200), 1), 200)
    let imported = 0
    for (let index = 0; index < payload.products.length; index += chunkSize) {
      const result = await runRailsChromoffImport({
        categories: payload.categories,
        products: payload.products.slice(index, index + chunkSize),
      }, false)
      imported += result.products_received
    }
    revalidatePath('/admin/chromoff')
    return { success: true, imported }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Не удалось импортировать каталог.' }
  }
}

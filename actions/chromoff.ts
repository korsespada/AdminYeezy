'use server'

import { revalidatePath } from 'next/cache'
import { buildChromoffImportPayload } from '@/lib/chromoff-source'
import { runRailsChromoffImport, updateRailsChromoffListing } from '@/lib/rails-admin'

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

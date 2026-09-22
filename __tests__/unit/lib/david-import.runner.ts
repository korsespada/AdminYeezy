// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => ({ email: 'runner@local' }),
  getAdminSession: async () => null,
  isAdminAuthError: () => false,
}))

const HANDLES = String(process.env.HANDLES || '').split(',').map((value) => value.trim()).filter(Boolean)

/**
 * Импорт оставшихся колец David: ИИ-черновик, затем создание товара и листинга —
 * теми же серверными экшенами, что и кнопки в разделе David Studio.
 */
describe('импорт оставшихся колец David', () => {
  it('считает черновик и создаёт товар', async () => {
    const { generateDavidDraftAction, createDavidChromoffProductAction } = await import('@/actions/david-studio')
    const { scrapingQuery } = await import('@/lib/db')

    console.log(`к импорту: ${HANDLES.length}`)
    for (const handle of HANDLES) {
      const draftResult = await generateDavidDraftAction(handle)
      if (!draftResult.success) {
        console.log(`  ЧЕРНОВИК СБОЙ ${handle}: ${draftResult.error}`)
        continue
      }

      const draft = await scrapingQuery('SELECT ai_output FROM david_import_drafts WHERE handle=$1', [handle])
      const ai: any = draft.rows[0]?.ai_output || {}
      const chromoffCategoryId = String(ai.chromoffCategory?.id || ai.attributes?.chromoff_category_id || '')
      if (!ai.name || !ai.category || !chromoffCategoryId) {
        console.log(`  НЕПОЛНЫЙ ЧЕРНОВИК ${handle}: name=${Boolean(ai.name)} category=${Boolean(ai.category)} chromoff=${Boolean(chromoffCategoryId)}`)
        continue
      }

      const created = await createDavidChromoffProductAction({
        handle,
        name: String(ai.name),
        description: String(ai.description || ''),
        categoryId: String(ai.category),
        chromoffCategoryId,
        gender: ai.gender || null,
        attributes: ai.attributes || {},
        photoAlts: Array.isArray(ai.photoAlts) ? ai.photoAlts : [],
        seoDescription: String(ai.seoDescription || ''),
        published: true,
      })
      if (created.success) {
        console.log(`  СОЗДАН ${handle}: «${ai.name}» — фото ${created.data.photos}, размеров ${created.data.sizes.length}, категория Chromoff «${ai.chromoffCategory?.name || ''}»`)
      } else {
        console.log(`  СБОЙ СОЗДАНИЯ ${handle}: ${created.error}`)
      }
    }
    expect(true).toBe(true)
  }, 5_400_000)
})

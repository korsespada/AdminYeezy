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

/**
 * Описания для откатанных карточек.
 *
 * При откате описание очищается (текст David описывал другое изделие), и новая
 * версия собирается по своим фото. Если модель тогда не ответила, карточка
 * остаётся без описания — этот прогон доводит такие карточки до конца.
 */
describe('описания после отката', () => {
  it('собирает описание по фото товара', async () => {
    const { scrapingQuery } = await import('@/lib/db')
    const { buildBatchAiContactSheets, runBatchAiOpenRouter } = await import('@/lib/batch-ai')
    const { getBatchAiSettingsAction } = await import('@/actions/batch-ai')
    const { railsFetch } = await import('@/lib/rails-admin')

    const settingsResult = await getBatchAiSettingsAction()
    if (!settingsResult.success || !settingsResult.data) throw new Error('нет настроек ИИ')
    const settings = settingsResult.data as any

    const rows = await scrapingQuery(
      "SELECT id, anchor_slug, anchor_product_id, anchor_name FROM david_ring_matches WHERE status='reverted' ORDER BY updated_at",
    )

    let updated = 0
    for (const row of rows.rows as any[]) {
      const response = await railsFetch<{ product: any }>(`/admin/products/${encodeURIComponent(row.anchor_product_id)}`)
      const product = response.product
      const description = String(product?.description || '').trim()
      if (description.length > 40) continue
      const urls = (product?.media || []).map((medium: any) => String(medium.original_url || '')).filter(Boolean).slice(0, 5)
      if (!urls.length) continue
      try {
        const sheets = await buildBatchAiContactSheets(urls)
        const raw = await runBatchAiOpenRouter({
          settings,
          systemPrompt: [
            'Ты описываешь ювелирное кольцо Chrome Hearts по фотографиям.',
            'Пиши только то, что видно на фото: тип шинки, ширину, мотив, камни, покрытие.',
            'Не выдумывай пробу металла, камни и название модели, если их не видно.',
            'Верни строго JSON: {"description":"2-3 предложения на русском"}',
          ].join('\n'),
          userPrompt: `Опиши кольцо «${row.anchor_name}» по фотографиям.`,
          contactSheets: sheets,
        })
        const text = String((raw as any)?.description || (raw as any)?.product?.description || '').trim()
        if (!text) {
          console.log(`  пусто: ${row.anchor_slug}`)
          continue
        }
        await railsFetch(`/admin/products/${encodeURIComponent(row.anchor_product_id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ product: { description: text } }),
        })
        updated += 1
        console.log(`  описание записано: ${row.anchor_slug} — ${text.slice(0, 90)}…`)
      } catch (error: any) {
        console.log(`  сбой ${row.anchor_slug}: ${String(error?.message || error).slice(0, 120)}`)
      }
    }
    console.log(`обновлено описаний: ${updated} из ${rows.rowCount}`)
    expect(rows.rowCount).toBeGreaterThan(0)
  }, 5_400_000)
})

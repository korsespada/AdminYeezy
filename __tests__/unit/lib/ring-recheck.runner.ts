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
 * Строгая перепроверка уже применённых пар.
 *
 * Первый подбор разрешал «вариацию декора»: если камни были только у одной
 * стороны, модель всё равно объявляла пару. Из-за этого широкое бандо David
 * слилось с тонким разомкнутым кольцом. Здесь правило жёстче: тип шинки, ширина
 * и камни обязаны совпасть, иначе это разные изделия.
 */
const STRICT_SYSTEM_PROMPT = [
  'Ты сверяешь два ювелирных кольца Chrome Hearts по фотографиям: первое — уже опубликованная карточка, второе — модель поставщика.',
  'Ответ — только JSON.',
  '',
  'Обязаны совпасть ВСЕ признаки:',
  '1. тип шинки — замкнутое кольцо или разомкнутое (с разрывом);',
  '2. ширина шинки — узкое, среднее или широкое (бандо);',
  '3. форма и расположение мотива;',
  '4. камни: есть они или нет, и где именно. Если камни есть только у одного изделия — это РАЗНЫЕ изделия.',
  '',
  'Разное написание размера, другой ракурс или разный фон — это не различие.',
  'Если хотя бы один признак расходится, верни same_model=false и перечисли расхождения.',
  '',
  'Верни строго JSON: {"same_model":true|false,"differences":["..."],"confidence":0.0-1.0}.',
].join('\n')

describe('строгая перепроверка применённых пар', () => {
  it('находит пары с разными моделями', async () => {
    const { scrapingQuery } = await import('@/lib/db')
    const { buildBatchAiContactSheets, runBatchAiOpenRouter } = await import('@/lib/batch-ai')
    const { getBatchAiSettingsAction } = await import('@/actions/batch-ai')

    const settingsResult = await getBatchAiSettingsAction()
    if (!settingsResult.success || !settingsResult.data) throw new Error('нет настроек ИИ')
    const settings = settingsResult.data as any
    if (String(settings.provider) === 'cockpit') throw new Error('выбран Cockpit')

    const pairs = await scrapingQuery(
      `SELECT id, anchor_name, anchor_slug, anchor_product_id, david_handle, david_title, applied
         FROM david_ring_matches WHERE status='applied' ORDER BY updated_at`,
    )

    const suspicious = []
    const unverifiable = []
    for (const row of pairs.rows as any[]) {
      const davidPhotosCount = Number(row.applied?.copied?.photos || 0)
      const detail = await (await fetch(
        `https://api.yeezyunique.ru/api/v1/catalog/chromoff/products/${encodeURIComponent(row.anchor_slug)}`,
      )).json().catch(() => ({}))
      const media = (detail?.media || []).map((medium: any) => String(medium.original_url || '')).filter(Boolean)
      const davidPhotos = media.slice(0, davidPhotosCount)
      const oldPhotos = media.slice(davidPhotosCount)
      if (oldPhotos.length < 2 || davidPhotos.length < 2) {
        unverifiable.push(`${row.anchor_name} (старых ${oldPhotos.length}, David ${davidPhotos.length})`)
        continue
      }

      const [oldSheet] = await buildBatchAiContactSheets(oldPhotos.slice(0, 4))
      const [davidSheet] = await buildBatchAiContactSheets(davidPhotos.slice(0, 4))
      const raw = await runBatchAiOpenRouter({
        settings,
        systemPrompt: STRICT_SYSTEM_PROMPT,
        userPrompt: `Первое изделие: «${row.anchor_name}». Второе изделие: «${row.david_title}». Верни JSON.`,
        contactSheets: [oldSheet],
        referenceSheets: [davidSheet],
        referenceSheetsLabel: 'Модель David Studio',
      }).catch((error: any) => ({ error: String(error?.message || error) }))

      if ((raw as any)?.error) {
        unverifiable.push(`${row.anchor_name}: ${(raw as any).error.slice(0, 80)}`)
        continue
      }

      const same = (raw as any)?.same_model !== false
      const differences = Array.isArray((raw as any)?.differences) ? (raw as any).differences.join('; ') : ''
      console.log(`  ${same ? 'ок  ' : 'РАЗНЫЕ'} ${row.anchor_name} -> ${row.david_title}${same ? '' : ` | ${differences}`}`)
      if (!same) suspicious.push({ id: row.id, anchor: row.anchor_name, david: row.david_title, differences })
    }

    console.log(`\nпроверено пар: ${pairs.rowCount} | разных моделей: ${suspicious.length} | не удалось проверить: ${unverifiable.length}`)
    for (const item of unverifiable) console.log('  не проверено:', item)
    console.log('\nПОДОЗРИТЕЛЬНЫЕ:')
    for (const item of suspicious) console.log(`  - ${item.anchor} -> ${item.david} | ${item.differences}`)
    expect(pairs.rowCount).toBeGreaterThan(0)
  }, 5_400_000)
})

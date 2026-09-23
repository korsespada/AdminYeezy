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

/** Откат применённых пар: ANCHORS — список slug'ов старых карточек. */
const ANCHORS = String(process.env.ANCHORS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

describe('откат применённых пар', () => {
  it('возвращает старым карточкам их фото и название', async () => {
    const { revertRingMatchAction } = await import('@/actions/david-ring-match')
    const { scrapingQuery } = await import('@/lib/db')

    const rows = await scrapingQuery(
      `SELECT id, anchor_slug, anchor_name FROM david_ring_matches
        WHERE status='applied' AND anchor_slug = ANY($1::text[]) ORDER BY anchor_slug`,
      [ANCHORS],
    )
    console.log(`к откату: ${rows.rowCount} из ${ANCHORS.length}`)

    for (const row of rows.rows as any[]) {
      const result = await revertRingMatchAction(String(row.id))
      if (result.success) {
        console.log(`  ОТКАЧЕНО ${row.anchor_slug}\n     ${result.data.message}${result.data.warning ? ` | ${result.data.warning}` : ''}`)
      } else {
        console.log(`  СБОЙ ${row.anchor_slug}: ${result.error}`)
      }
    }
    expect(rows.rowCount).toBeGreaterThan(0)
  }, 5_400_000)
})

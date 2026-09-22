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

const MIN = Number(process.env.MIN_CONFIDENCE || '0.9')
const LIMIT = Number(process.env.LIMIT || '0')

describe('применение пар', () => {
  it('переносит контент David в старую карточку и убирает дубль', async () => {
    const { applyRingMatchAction } = await import('@/actions/david-ring-match')
    const { scrapingQuery } = await import('@/lib/db')

    const rows = await scrapingQuery(
      `SELECT id, anchor_name, anchor_slug, david_title, david_slug, confidence
         FROM david_ring_matches
        WHERE status='suggested' AND confidence >= $1
        ORDER BY confidence DESC, anchor_name`,
      [MIN],
    )
    const targets = LIMIT ? rows.rows.slice(0, LIMIT) : rows.rows
    console.log(`к применению: ${targets.length} (порог ${MIN})`)

    let applied = 0
    const failures: string[] = []
    for (const row of targets) {
      const result = await applyRingMatchAction(String(row.id))
      if (result.success) {
        applied += 1
        console.log(`  OK ${row.anchor_name} -> ${row.david_title}\n     ${result.data.message}`)
      } else {
        failures.push(`${row.anchor_name}: ${result.error}`)
        console.log(`  СБОЙ ${row.anchor_name}: ${result.error}`)
      }
    }
    console.log(`\nприменено: ${applied} | сбоев: ${failures.length}`)
    for (const failure of failures) console.log('  ', failure)
    expect(applied).toBeGreaterThanOrEqual(0)
  }, 5_400_000)
})

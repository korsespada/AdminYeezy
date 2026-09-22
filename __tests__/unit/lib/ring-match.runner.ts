// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

// Экшены требуют админскую сессию и revalidatePath; в прогонщике и то и другое
// не нужно: он вызывает те же функции, что и кнопки в интерфейсе.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => ({ email: 'runner@local' }),
  getAdminSession: async () => null,
  isAdminAuthError: () => false,
}))

const SHARD = Number(process.env.SHARD || '0')
const SHARDS = Math.max(1, Number(process.env.SHARDS || '1'))
const BATCH = Math.max(1, Number(process.env.BATCH || '3'))

describe('прогон подбора колец', () => {
  it('считает непосчитанные кольца шарда', async () => {
    const { getRingMatchOverviewAction, runRingMatchBatchAction } = await import('@/actions/david-ring-match')

    const before = await getRingMatchOverviewAction()
    if (!before.success) throw new Error(before.error)
    console.log(`шард ${SHARD}/${SHARDS} | до старта: ${JSON.stringify(before.data.stats)}`)

    const pending = before.data.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => (
        index % SHARDS === SHARD &&
        (row.status === 'new' || row.status === 'error' || row.status === 'invalid_index')
      ))
      .map(({ row }) => row.anchor.listingId)

    console.log(`к обработке: ${pending.length}`)
    let cursor = 0

    while (cursor < pending.length) {
      const slice = pending.slice(cursor, cursor + BATCH)
      cursor += slice.length
      const result = await runRingMatchBatchAction({ limit: slice.length, anchorListingIds: slice })
      if (!result.success) {
        console.log(`  ошибка батча: ${result.error}`)
        break
      }
      for (const item of result.data.results) {
        const tail = item.status === 'suggested'
          ? `-> ${item.davidTitle} (${Math.round(Number(item.confidence || 0) * 100)}%)`
          : item.status === 'error' ? `ошибка: ${item.error}` : item.status
        console.log(`  [${cursor - slice.length + result.data.results.indexOf(item) + 1}/${pending.length}] ${item.anchor}: ${tail}`)
      }
    }

    const after = await getRingMatchOverviewAction()
    if (!after.success) throw new Error(after.error)
    console.log(`шард ${SHARD} финиш: ${JSON.stringify(after.data.stats)}`)
    for (const row of after.data.rows.filter((item) => item.status === 'suggested')) {
      console.log(`  ПАРА ${Math.round(Number(row.confidence || 0) * 100)}% | ${row.anchor.name} -> ${row.davidTitle}`)
    }
    expect(after.success).toBe(true)
  }, 5_400_000)
})

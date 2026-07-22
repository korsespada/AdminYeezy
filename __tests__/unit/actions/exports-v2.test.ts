import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() }
  return {
    client,
    getScrapingClient: vi.fn(async () => client),
    scrapingQuery: vi.fn(),
    requireAdmin: vi.fn(),
    revalidatePath: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/db', () => ({
  getScrapingClient: mocks.getScrapingClient,
  scrapingQuery: mocks.scrapingQuery,
}))
vi.mock('@/lib/admin-session', () => ({ requireAdmin: mocks.requireAdmin }))

describe('exports v2 grouping actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com' })
  })

  it('keeps click order and makes the first selected album primary', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT a.id, COALESCE')) {
        return { rows: [{ id: 'album-b' }, { id: 'album-a' }] }
      }
      if (sql.includes('SELECT supplier_id FROM scraping_v2_runs')) {
        return { rows: [{ supplier_id: 7 }] }
      }
      return { rows: [], rowCount: 1 }
    })

    const { createExportsV2DraftAction } = await import('@/actions/exports-v2')
    const result = await createExportsV2DraftAction('run-1', ['album-a', 'album-b'])

    expect(result.success).toBe(true)
    const albumInserts = mocks.client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO scraping_v2_draft_albums'),
    )
    expect(albumInserts).toHaveLength(2)
    expect(albumInserts[0][1]).toEqual([
      expect.any(String), 'album-a', 'PRIMARY_MEDIA', true, true, true, 0,
    ])
    expect(albumInserts[1][1]).toEqual([
      expect.any(String), 'album-b', 'UNASSIGNED', false, false, false, 1,
    ])
    expect(mocks.client.query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('deletes the saved example and reopens the draft for editing', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT run_id') && sql.includes('scraping_v2_product_drafts')) {
        return { rows: [{ run_id: 'run-1' }] }
      }
      if (sql.includes('DELETE FROM scraping_v2_training_examples')) {
        return { rows: [{ id: 'example-1' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })

    const { reopenExportsV2DraftAction } = await import('@/actions/exports-v2')
    const result = await reopenExportsV2DraftAction('draft-1')

    expect(result).toMatchObject({ success: true, data: { removedExamples: 1 } })
    expect(mocks.client.query).toHaveBeenCalledWith(
      'DELETE FROM scraping_v2_training_examples WHERE draft_id=$1 RETURNING id',
      ['draft-1'],
    )
    expect(mocks.client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status='GROUPING_DRAFT'"),
      ['draft-1'],
    )
    expect(mocks.client.query).toHaveBeenLastCalledWith('COMMIT')
  })
})

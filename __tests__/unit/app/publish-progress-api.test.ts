import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAdmin } from '@/lib/admin-session'
import { scrapingQuery } from '@/lib/db'
import { GET } from '@/app/api/batches/publish-progress/route'

vi.mock('@/lib/db', () => ({ scrapingQuery: vi.fn() }))
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: vi.fn(),
  isAdminAuthError: (error: any) => error?.name === 'AdminAuthError',
}))

const mockedRequireAdmin = vi.mocked(requireAdmin)
const mockedScrapingQuery = vi.mocked(scrapingQuery)

describe('batch publication progress API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedRequireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com', source: 'rails' } as any)
  })

  it('returns live progress without caching the response', async () => {
    mockedScrapingQuery.mockResolvedValue({
      rows: [{ operation: 'publish|media|120|607', updated_at: new Date() }],
    } as any)

    const response = await GET(new Request('https://admin.example.com/api/batches/publish-progress?batchId=batch-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({
      success: true,
      data: { running: true, phase: 'media', current: 120, total: 607 },
    })
    expect(mockedScrapingQuery).toHaveBeenCalledWith(expect.any(String), ['batch-1'])
  })

  it('rejects requests without an admin session', async () => {
    const error = new Error('Admin authentication required')
    error.name = 'AdminAuthError'
    mockedRequireAdmin.mockRejectedValue(error)

    const response = await GET(new Request('https://admin.example.com/api/batches/publish-progress?batchId=batch-1'))

    expect(response.status).toBe(401)
    expect(mockedScrapingQuery).not.toHaveBeenCalled()
  })
})

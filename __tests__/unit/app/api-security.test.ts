import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { analyticsQuery } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-session'
import { DELETE, GET, POST } from '@/app/api/analytics/route'
import { GET as downloadGet } from '@/app/api/download/route'
import { GET as resizeGet } from '@/app/api/media/resize/route'

vi.mock('@/lib/db', () => ({
  analyticsQuery: vi.fn(),
}))

vi.mock('@/lib/admin-session', () => ({
  requireAdmin: vi.fn(),
  isAdminAuthError: (error: any) => error?.name === 'AdminAuthError',
}))

const mockedRequireAdmin = vi.mocked(requireAdmin)
const mockedAnalyticsQuery = vi.mocked(analyticsQuery)

function adminError() {
  const error = new Error('Admin authentication required')
  error.name = 'AdminAuthError'
  return error
}

describe('API security', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('DATABASE_URL', 'postgresql://analytics.example/db')
    mockedRequireAdmin.mockResolvedValue({ id: 1, email: 'admin@example.com', source: 'rails' } as any)
    mockedAnalyticsQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('rejects analytics GET without admin session', async () => {
    mockedRequireAdmin.mockRejectedValue(adminError())

    const response = await GET(new Request('https://admin.example.com/api/analytics'))

    expect(response.status).toBe(401)
    expect(mockedAnalyticsQuery).not.toHaveBeenCalled()
  })

  it('rejects analytics DELETE without admin session', async () => {
    mockedRequireAdmin.mockRejectedValue(adminError())

    const response = await DELETE(new Request('https://admin.example.com/api/analytics?type=all'))

    expect(response.status).toBe(401)
    expect(mockedAnalyticsQuery).not.toHaveBeenCalled()
  })

  it('allows valid public analytics POST events', async () => {
    const response = await POST(new Request('https://admin.example.com/api/analytics', {
      method: 'POST',
      body: JSON.stringify({ event: 'page_view', session_id: 'session-1', meta: { channel: 'site' } }),
    }))

    expect(response.status).toBe(200)
    expect(mockedAnalyticsQuery).toHaveBeenCalled()
  })

  it('rejects unsupported public analytics events', async () => {
    const response = await POST(new Request('https://admin.example.com/api/analytics', {
      method: 'POST',
      body: JSON.stringify({ event: 'drop_tables', session_id: 'session-1' }),
    }))

    expect(response.status).toBe(400)
    expect(mockedAnalyticsQuery).not.toHaveBeenCalled()
  })

  it('rejects arbitrary download proxy hosts', async () => {
    const response = await downloadGet(new Request('https://admin.example.com/api/download?url=http%3A%2F%2F127.0.0.1%2Fsecret'))

    expect(response.status).toBe(400)
  })

  it('rejects production resize requests to localhost', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const request = new NextRequest('https://admin.example.com/api/media/resize?url=http%3A%2F%2Flocalhost%2Fimage.jpg')
    const response = await resizeGet(request)

    expect(response.status).toBe(400)
  })
})

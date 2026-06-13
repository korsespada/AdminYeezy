import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cookies } from 'next/headers'
import { getAdminSession, isJwtExpired, requireAdmin } from '@/lib/admin-session'

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

const mockedCookies = vi.mocked(cookies)

function tokenWithExp(expSeconds: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')
  return `${header}.${payload}.signature`
}

function setCookies(values: Record<string, string | undefined>) {
  mockedCookies.mockResolvedValue({
    get: (name: string) => {
      const value = values[name]
      return value ? { value } : undefined
    },
  } as any)
}

describe('admin session security', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubGlobal('fetch', vi.fn())
    setCookies({})
  })

  it('rejects missing admin cookies', async () => {
    await expect(requireAdmin()).rejects.toMatchObject({ name: 'AdminAuthError' })
  })

  it('accepts development admin session fallback', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    setCookies({
      admin_auth: JSON.stringify({ id: 1, email: 'admin@example.com', role: 'admin', source: 'legacy' }),
    })

    await expect(requireAdmin()).resolves.toMatchObject({ email: 'admin@example.com' })
  })

  it('treats expired JWTs as invalid', () => {
    expect(isJwtExpired(tokenWithExp(1), 2_000)).toBe(true)
  })

  it('validates production Rails tokens through Rails auth endpoint', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RAILS_API_URL', 'https://rails.example.com/api/v1')
    const token = tokenWithExp(Math.floor(Date.now() / 1000) + 60)
    setCookies({
      admin_token: token,
      admin_auth: JSON.stringify({ id: 7, email: 'rails@example.com', role: 'admin', source: 'rails' }),
    })
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }) as any)

    await expect(getAdminSession()).resolves.toMatchObject({ email: 'rails@example.com' })
    expect(fetch).toHaveBeenCalledWith(
      'https://rails.example.com/api/v1/admin/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    )
  })

  it('rejects production tokens when Rails verification fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RAILS_API_URL', 'https://rails.example.com/api/v1')
    setCookies({ admin_token: tokenWithExp(Math.floor(Date.now() / 1000) + 60) })
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }) as any)

    await expect(getAdminSession()).resolves.toBeNull()
  })
})

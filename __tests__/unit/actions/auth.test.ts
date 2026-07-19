import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  query: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: mocks.cookieSet,
    delete: vi.fn(),
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

vi.mock('@/lib/db', () => ({
  query: mocks.query,
}))

describe('local admin login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('LOCAL_ADMIN_EMAIL', 'local@example.com')
    vi.stubEnv('LOCAL_ADMIN_PASSWORD', 'local-password')
    vi.stubEnv('RAILS_API_URL', 'http://127.0.0.1:3001')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('accepts configured local credentials without calling Rails', async () => {
    const { loginAction } = await import('@/actions/auth')
    const formData = new FormData()
    formData.set('email', 'local@example.com')
    formData.set('password', 'local-password')

    await expect(loginAction(formData)).rejects.toThrow('NEXT_REDIRECT')

    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'admin_auth',
      JSON.stringify({ id: 'local-admin', email: 'local@example.com', role: 'admin', source: 'local' }),
      expect.objectContaining({ httpOnly: true, path: '/' })
    )
    expect(mocks.redirect).toHaveBeenCalledWith('/admin/home')
  })
})

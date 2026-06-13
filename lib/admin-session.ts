export const ADMIN_SESSION_COOKIE = 'admin_auth'
export const ADMIN_TOKEN_COOKIE = 'admin_token'
export const LEGACY_PB_AUTH_COOKIE = 'pb_auth'

const ADMIN_ENTRY_PATH = '/admin/home'

export interface AdminSession {
  id: string | number
  email: string
  name?: string | null
  role?: string | null
  source: 'rails' | 'local' | 'legacy'
}

export class AdminAuthError extends Error {
  status = 401

  constructor(message = 'Admin authentication required') {
    super(message)
    this.name = 'AdminAuthError'
  }
}

export function isAdminAuthError(error: unknown): error is AdminAuthError {
  return error instanceof AdminAuthError || (error as any)?.name === 'AdminAuthError'
}

export function jwtExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf-8'))
    const exp = Number(payload?.exp)
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null
  } catch {
    return null
  }
}

export function isJwtExpired(token: string, now = Date.now()) {
  const expiresAt = jwtExpiresAt(token)
  return !expiresAt || expiresAt <= now
}

function railsApiUrl(pathname: string) {
  const rawBase = process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL
  if (!rawBase) return null

  let base = rawBase.replace(/\/+$/, '')
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

async function verifyRailsAdminToken(token: string) {
  const configuredPath = process.env.RAILS_ADMIN_VERIFY_PATH?.trim()
  const candidates = [
    configuredPath || '/admin/auth/me',
    '/admin/auth/verify',
  ].filter((value, index, items) => value && items.indexOf(value) === index)

  for (const pathname of candidates) {
    const url = railsApiUrl(pathname)
    if (!url) return false

    const isVerifyPost = pathname.includes('/verify')
    const response = await fetch(url, {
      method: isVerifyPost ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isVerifyPost ? { 'Content-Type': 'application/json' } : {}),
      },
      body: isVerifyPost ? JSON.stringify({ token }) : undefined,
      cache: 'no-store',
    }).catch(() => null)

    if (!response) return false
    if (response.ok) return true
    if (response.status === 404 || response.status === 405) continue
    if (response.status === 401 || response.status === 403) return false
    return false
  }

  return false
}

function parseAdminSession(value?: string) {
  if (!value) return null
  try {
    return JSON.parse(value) as AdminSession
  } catch {
    return null
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_TOKEN_COOKIE)?.value?.trim()
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const legacyCookie = cookieStore.get(LEGACY_PB_AUTH_COOKIE)?.value
  const parsedSession = parseAdminSession(sessionCookie)

  if (process.env.NODE_ENV === 'production') {
    if (!token || isJwtExpired(token)) return null
    if (!await verifyRailsAdminToken(token)) return null
    return parsedSession || { id: 'rails-admin', email: '', role: 'admin', source: 'rails' }
  }

  if (token && !isJwtExpired(token)) {
    return parsedSession || { id: 'rails-admin', email: '', role: 'admin', source: 'rails' }
  }

  if (parsedSession) return parsedSession
  if (legacyCookie) return { id: 'legacy', email: '', role: 'admin', source: 'legacy' }
  return null
}

export async function requireAdmin() {
  const session = await getAdminSession()
  if (!session) throw new AdminAuthError()
  return session
}

export function adminLoginRedirectPath() {
  return ADMIN_ENTRY_PATH
}

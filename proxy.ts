import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, ADMIN_TOKEN_COOKIE, LEGACY_PB_AUTH_COOKIE } from '@/lib/admin-session'

const ADMIN_ENTRY_PATH = '/admin/home'

function isExpiredJwt(token?: string) {
  if (!token) return true

  try {
    const encodedPayload = token.split('.')[1]
    if (!encodedPayload) return true

    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const payload = JSON.parse(atob(padded))
    const exp = Number(payload?.exp)
    return !Number.isFinite(exp) || exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const tokenCookie = request.cookies.get(ADMIN_TOKEN_COOKIE)
  const fallbackCookie = request.cookies.get(ADMIN_SESSION_COOKIE) || request.cookies.get(LEGACY_PB_AUTH_COOKIE)
  const isAuthenticated = process.env.NODE_ENV === 'production'
    ? Boolean(tokenCookie?.value && !isExpiredJwt(tokenCookie.value))
    : Boolean((tokenCookie?.value && !isExpiredJwt(tokenCookie.value)) || fallbackCookie?.value)

  if (pathname.startsWith('/admin')) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  if (pathname === '/login') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL(ADMIN_ENTRY_PATH, request.url))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
}

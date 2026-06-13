import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_SESSION_COOKIE, ADMIN_TOKEN_COOKIE, LEGACY_PB_AUTH_COOKIE } from '@/lib/admin-session'

const ADMIN_ENTRY_PATH = '/admin/home'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const tokenCookie = request.cookies.get(ADMIN_TOKEN_COOKIE)
  const fallbackCookie = request.cookies.get(ADMIN_SESSION_COOKIE) || request.cookies.get(LEGACY_PB_AUTH_COOKIE)
  const isAuthenticated = process.env.NODE_ENV === 'production'
    ? !!tokenCookie?.value
    : Boolean(tokenCookie?.value || fallbackCookie?.value)

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

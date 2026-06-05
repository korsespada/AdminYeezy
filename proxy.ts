import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ADMIN_ENTRY_PATH = '/admin/batches'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const authCookie = request.cookies.get('admin_auth') || request.cookies.get('pb_auth')
  const isAuthenticated = !!authCookie?.value

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

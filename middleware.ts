import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for route protection
 * - Protects /admin routes from unauthenticated access
 * - Redirects authenticated users away from /login
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authCookie = request.cookies.get('pb_auth')
  const isAuthenticated = !!authCookie?.value

  // Check if accessing admin routes
  if (pathname.startsWith('/admin')) {
    if (!isAuthenticated) {
      // Redirect to login if not authenticated
      const loginUrl = new URL('/login', request.url)
      return NextResponse.redirect(loginUrl)
    }
    // Allow access if authenticated
    return NextResponse.next()
  }

  // Check if accessing login page
  if (pathname === '/login') {
    if (isAuthenticated) {
      // Redirect to admin if already authenticated
      const adminUrl = new URL('/admin', request.url)
      return NextResponse.redirect(adminUrl)
    }
    // Allow access to login if not authenticated
    return NextResponse.next()
  }

  // Allow all other routes
  return NextResponse.next()
}

/**
 * Configure which routes the middleware should run on
 */
export const config = {
  matcher: [
    '/admin/:path*',
    '/login',
  ],
}

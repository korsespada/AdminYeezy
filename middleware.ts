import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Проверяем новую куку admin_auth (или старую pb_auth для совместимости)
  const authCookie = request.cookies.get('admin_auth') || request.cookies.get('pb_auth')
  const isAuthenticated = !!authCookie?.value

  // Если пытаемся зайти в админку без авторизации — на логин
  if (pathname.startsWith('/admin')) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  // Если уже вошли и зашли на страницу логина — в админку
  if (pathname === '/login') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/login'],
}

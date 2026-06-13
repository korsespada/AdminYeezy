import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, ADMIN_TOKEN_COOKIE, LEGACY_PB_AUTH_COOKIE } from '@/lib/admin-session'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const cookieStore = await cookies()
  const hasToken = Boolean(cookieStore.get(ADMIN_TOKEN_COOKIE)?.value)
  const hasFallbackSession = Boolean(cookieStore.get(ADMIN_SESSION_COOKIE)?.value || cookieStore.get(LEGACY_PB_AUTH_COOKIE)?.value)
  const isAuthenticated = process.env.NODE_ENV === 'production' ? hasToken : hasToken || hasFallbackSession

  redirect(isAuthenticated ? '/admin/home' : '/login')
}

'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { query } from '@/lib/db'
import { ADMIN_SESSION_COOKIE, ADMIN_TOKEN_COOKIE, LEGACY_PB_AUTH_COOKIE, type AdminSession } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'

const ADMIN_ENTRY_PATH = '/admin/home'

async function setAdminSession(admin: AdminSession, token?: string) {
  const cookieStore = await cookies()
  const sessionData = JSON.stringify(admin)

  cookieStore.set(ADMIN_SESSION_COOKIE, sessionData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 неделя
    path: '/',
  })

  if (token) {
    cookieStore.set(ADMIN_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // Rails admin JWT expires in 24 hours.
      path: '/',
    })
  }
}

function railsApiUrl(pathname: string) {
  const rawBase = process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL
  if (!rawBase) return null

  let base = rawBase.replace(/\/+$/, '')
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

async function loginViaRails(email: string, password: string) {
  const url = railsApiUrl('/admin/auth/login')
  if (!url) return null

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return false
    throw new Error(payload.message || payload.error || `Rails admin login failed with ${response.status}`)
  }

  if (!payload.admin?.email || !payload.token) return false
  return { admin: payload.admin, token: payload.token }
}

/**
 * Вход в админку
 */
export async function loginAction(formData: FormData): Promise<ActionResponse> {
  const email = (formData.get('email') as string)?.trim()
  const password = (formData.get('password') as string)?.trim()

  if (!email || !password) {
    return { success: false, error: 'Email and password are required' }
  }

  try {
    const localAdminEmail = process.env.LOCAL_ADMIN_EMAIL?.trim()
    const localAdminPassword = process.env.LOCAL_ADMIN_PASSWORD?.trim()
    const isLocalAdminEnabled = process.env.NODE_ENV !== 'production' && localAdminEmail && localAdminPassword

    if (isLocalAdminEnabled && email === localAdminEmail && password === localAdminPassword) {
      await setAdminSession({ id: 'local-admin', email, role: 'admin', source: 'local' })
      redirect(ADMIN_ENTRY_PATH)
    }

    const railsSession = await loginViaRails(email, password)
    if (railsSession) {
      await setAdminSession({
        id: railsSession.admin.id,
        email: railsSession.admin.email,
        name: railsSession.admin.name,
        role: railsSession.admin.role,
        source: 'rails',
      }, railsSession.token)
      redirect(ADMIN_ENTRY_PATH)
    }

    if (railsSession === false) {
      return { success: false, error: 'Неверный email или пароль Rails admin.' }
    }

    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'RAILS_API_URL is required for production admin login.' }
    }

    // Development-only fallback for old local databases. Do not configure this
    // path in production; production auth must go through Rails admin JWT.
    const res = await query('SELECT * FROM admins WHERE email = $1 AND password = $2 LIMIT 1', [email, password])

    if (res.rows.length === 0) {
      return { success: false, error: 'Неверный email или пароль. Rails auth не настроен, legacy fallback доступен только локально.' }
    }

    const admin = res.rows[0]
    await setAdminSession({ id: admin.id, email: admin.email, role: 'admin', source: 'legacy' })

  } catch (error: any) {
    if (error?.digest?.startsWith('NEXT_REDIRECT') || error?.message === 'NEXT_REDIRECT') {
      throw error
    }

    console.error('Login error:', error)
    return { success: false, error: `Ошибка базы данных: ${error.message}` }
  }

  redirect(ADMIN_ENTRY_PATH)
}

/**
 * Выход
 */
export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_SESSION_COOKIE)
  cookieStore.delete(ADMIN_TOKEN_COOKIE)
  cookieStore.delete(LEGACY_PB_AUTH_COOKIE)
  redirect('/login')
}

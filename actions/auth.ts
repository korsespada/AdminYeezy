'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { query } from '@/lib/db'
import type { ActionResponse } from '@/lib/types'

const ADMIN_ENTRY_PATH = '/admin/batches'

async function setAdminSession(admin: { id: string | number; email: string }) {
  const cookieStore = await cookies()
  const sessionData = JSON.stringify({
    id: admin.id,
    email: admin.email,
    role: 'admin',
  })

  cookieStore.set('admin_auth', sessionData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 1 неделя
    path: '/',
  })
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

  if (!payload.admin?.email) return false
  return payload.admin
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
      await setAdminSession({ id: 'local-admin', email })
      redirect(ADMIN_ENTRY_PATH)
    }

    const railsAdmin = await loginViaRails(email, password)
    if (railsAdmin) {
      await setAdminSession({ id: railsAdmin.id, email: railsAdmin.email })
      redirect(ADMIN_ENTRY_PATH)
    }

    if (railsAdmin === false) {
      return { success: false, error: 'Неверный email или пароль Rails admin.' }
    }

    // ВАЖНО: Мы ищем пользователя в таблице 'admins'. 
    // Предполагается, что пароли пока лежат в открытом виде или вы проверите их совпадение.
    // Для безопасности потом добавим хеширование (bcrypt).
    const res = await query('SELECT * FROM admins WHERE email = $1 AND password = $2 LIMIT 1', [email, password])

    if (res.rows.length === 0) {
      return { success: false, error: 'Неверный email или пароль. Убедитесь, что в таблице admins есть запись.' }
    }

    const admin = res.rows[0]
    await setAdminSession({ id: admin.id, email: admin.email })

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
  cookieStore.delete('admin_auth')
  cookieStore.delete('pb_auth') // На всякий случай чистим старую
  redirect('/login')
}

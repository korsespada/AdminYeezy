'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { query } from '@/lib/db'
import type { ActionResponse } from '@/lib/types'

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
    // ВАЖНО: Мы ищем пользователя в таблице 'admins'. 
    // Предполагается, что пароли пока лежат в открытом виде или вы проверите их совпадение.
    // Для безопасности потом добавим хеширование (bcrypt).
    const res = await query('SELECT * FROM admins WHERE email = $1 AND password = $2 LIMIT 1', [email, password])

    if (res.rows.length === 0) {
      return { success: false, error: 'Неверный email или пароль. Убедитесь, что в таблице admins есть запись.' }
    }

    const admin = res.rows[0]

    // Сохраняем данные сессии
    const cookieStore = cookies()
    const sessionData = JSON.stringify({
      id: admin.id,
      email: admin.email,
      role: 'admin'
    })

    // Используем то же имя куки для совместимости или меняем на новое
    cookieStore.set('admin_auth', sessionData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 неделя
      path: '/',
    })

  } catch (error: any) {
    console.error('Login error:', error)
    return { success: false, error: `Ошибка базы данных: ${error.message}` }
  }

  redirect('/admin')
}

/**
 * Выход
 */
export async function logoutAction() {
  const cookieStore = cookies()
  cookieStore.delete('admin_auth')
  cookieStore.delete('pb_auth') // На всякий случай чистим старую
  redirect('/login')
}

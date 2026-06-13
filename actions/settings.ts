'use server'

import { scrapingQuery } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import type { ActionResponse } from '@/lib/types'

export async function getSettingAction(key: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    const res = await scrapingQuery('SELECT value FROM app_settings WHERE key = $1', [key])
    return { success: true, data: res.rows[0]?.value || '' }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function updateSettingAction(key: string, value: string): Promise<ActionResponse> {
  try {
    await requireAdmin()
    await scrapingQuery(
      `INSERT INTO app_settings (key, value, updated_at) 
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    )
    revalidatePath('/admin/ai-rules')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

'use server'

import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-session'
import { createRailsStoreTelegramCampaign } from '@/lib/rails-admin'
import { uploadToS3 } from '@/lib/s3'

const TELEGRAM_PATH = '/admin/crm/telegram'
const MAX_MEDIA_SIZE = 20 * 1024 * 1024

function requiredString(formData: FormData, key: string) {
  const value = String(formData.get(key) || '').trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

export async function createStoreTelegramCampaignAction(formData: FormData) {
  await requireAdmin()

  const value = formData.get('media')
  const mediaFile = value instanceof File && value.size > 0 ? value : null
  if (mediaFile && mediaFile.size > MAX_MEDIA_SIZE) {
    throw new Error('Файл должен быть не больше 20 МБ')
  }

  const mediaType = normalizeMediaType(String(formData.get('mediaType') || 'none'), mediaFile)
  const mediaUrl = mediaFile ? await uploadMedia(mediaFile) : String(formData.get('mediaUrl') || '').trim()
  if (mediaType !== 'none' && !mediaUrl) throw new Error('Добавьте файл или URL медиа')

  const audienceValue = String(formData.get('audience') || 'all')
  const audience = audienceValue === 'selected' || audienceValue === 'direct' ? audienceValue : 'all'
  const contactIds = formData.getAll('contactIds').map(String)
  const telegramIds = String(formData.get('telegramIds') || '')
    .split(/[\s,;]+/)
    .map((id) => id.trim())
    .filter(Boolean)
  if (audience === 'selected' && contactIds.length === 0) {
    throw new Error('Выберите хотя бы одного получателя')
  }
  if (audience === 'direct' && telegramIds.length === 0) {
    throw new Error('Укажите Telegram ID')
  }

  const buttons = [1, 2, 3].flatMap((index) => {
    const text = String(formData.get(`buttonText${index}`) || '').trim()
    const url = String(formData.get(`buttonUrl${index}`) || '').trim()
    const webApp = formData.get(`buttonWebApp${index}`) === 'on'
    return text && url ? [{ text, url, web_app: webApp }] : []
  })

  await createRailsStoreTelegramCampaign({
    title: requiredString(formData, 'title'),
    body: requiredString(formData, 'body'),
    mediaType,
    mediaUrl,
    audience,
    contactIds,
    telegramIds,
    buttons,
  })
  revalidatePath(TELEGRAM_PATH)
}

function normalizeMediaType(value: string, file: File | null): 'none' | 'photo' | 'video' {
  if (file?.type.startsWith('video/')) return 'video'
  if (file?.type.startsWith('image/')) return 'photo'
  return value === 'photo' || value === 'video' ? value : 'none'
}

async function uploadMedia(file: File) {
  const extension = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin'
  const key = `telegram-campaigns/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`
  return uploadToS3(
    key,
    Buffer.from(await file.arrayBuffer()),
    file.type || 'application/octet-stream'
  )
}

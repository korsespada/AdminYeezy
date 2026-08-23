import { after } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { getRailsAdminProduct, patchRailsAdminProduct } from '@/lib/rails-admin'
import {
  uploadProductPhotoFromBuffer,
  uploadProductPhotoFromUrl,
  uploadProductVideoFromBuffer,
  uploadProductVideoFromUrl,
} from '@/lib/product-media-upload'

export const runtime = 'nodejs'
export const maxDuration = 300

function parsePhotoUrls(formData: FormData) {
  const values = formData.getAll('photo_url').map((value) => String(value || '').trim()).filter(Boolean)
  const json = String(formData.get('photo_urls') || '').trim()
  if (!json) return values
  try {
    const parsed = JSON.parse(json)
    return [...new Set([...values, ...(Array.isArray(parsed) ? parsed : []).map(String).map((value) => value.trim()).filter(Boolean)])]
  } catch {
    return values
  }
}

function isFile(value: FormDataEntryValue | null | undefined): value is File {
  return Boolean(value && typeof value === 'object' && 'arrayBuffer' in value)
}

async function queueProductMediaUpload(input: {
  productId: string
  photoUrls: string[]
  photoFiles: Array<{ name: string; buffer: Buffer }>
  videoUrl: string
  videoPosterUrl: string
  videoFile?: { name: string; buffer: Buffer }
}) {
  try {
    const [photoUrlResults, photoFileResults, videoResult] = await Promise.all([
      Promise.allSettled(input.photoUrls.map((url) => uploadProductPhotoFromUrl(url))),
      Promise.allSettled(input.photoFiles.map((file) => uploadProductPhotoFromBuffer(file.name, file.buffer))),
      input.videoFile
        ? uploadProductVideoFromBuffer(input.videoFile.name, input.videoFile.buffer).then((result) => ({ status: 'fulfilled' as const, value: result }))
        : input.videoUrl
          ? uploadProductVideoFromUrl(input.videoUrl).then((result) => ({ status: 'fulfilled' as const, value: result })).catch((reason) => ({ status: 'rejected' as const, reason }))
          : Promise.resolve({ status: 'fulfilled' as const, value: null }),
    ])

    const photoUploads = [
      ...photoUrlResults,
      ...photoFileResults,
    ].filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof uploadProductPhotoFromUrl>>> => result.status === 'fulfilled')
    const failures = [
      ...photoUrlResults,
      ...photoFileResults,
      videoResult,
    ].filter((result) => result.status === 'rejected')

    if (photoUploads.length === 0 && videoResult.status !== 'fulfilled') {
      throw new Error(failures.map((failure) => String(failure.reason?.message || failure.reason || 'ошибка загрузки')).join('; '))
    }

    const current = await getRailsAdminProduct(input.productId)
    const currentMedia = Array.isArray(current.media) && current.media.length > 0
      ? current.media
      : (current.photos || []).map((url, index) => ({
        original_url: url,
        thumb_url: url,
        preview_url: url,
        og_image_url: url,
        alt_text: current.name || '',
        sort_order: index,
        processing_status: 'processed' as const,
      }))
    const additions = photoUploads.map((result) => ({
      ...result.value.media,
      alt_text: current.name || '',
    }))
    const media = [...currentMedia, ...additions].filter((item, index, all) => (
      all.findIndex((candidate) => candidate.original_url === item.original_url) === index
    )).map((item, index) => ({ ...item, sort_order: index }))
    const video = videoResult.status === 'fulfilled' ? videoResult.value : null

    const patch: Record<string, unknown> = {}
    if (additions.length > 0) patch.media = media
    if (video) {
      patch.videoUrl = video.url
      patch.videoPosterUrl = input.videoPosterUrl || video.posterUrl
    }
    if (Object.keys(patch).length === 0) throw new Error('медиа не загрузились')
    await patchRailsAdminProduct(input.productId, patch)

    if (failures.length > 0) {
      console.warn('Some product media uploads failed', {
        productId: input.productId,
        errors: failures.map((failure) => String(failure.reason?.message || failure.reason || 'ошибка загрузки')),
      })
    }
  } catch (error) {
    console.error('Background product media upload failed', { productId: input.productId, error })
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const formData = await request.formData()
    const productId = String(formData.get('product_id') || '').trim()
    const photoUrls = parsePhotoUrls(formData)
    const photoFiles = await Promise.all(formData.getAll('photo_file').filter(isFile).map(async (file) => ({
      name: file.name || 'photo',
      buffer: Buffer.from(await file.arrayBuffer()),
    })))
    const videoFileEntry = formData.get('video_file')
    const videoFile = isFile(videoFileEntry)
      ? { name: videoFileEntry.name || 'video', buffer: Buffer.from(await videoFileEntry.arrayBuffer()) }
      : undefined
    const videoUrl = String(formData.get('video_url') || '').trim()
    const videoPosterUrl = String(formData.get('video_poster_url') || '').trim()

    if (!productId) return Response.json({ success: false, error: 'Не указан товар' }, { status: 400 })
    if (photoUrls.length === 0 && photoFiles.length === 0 && !videoUrl && !videoFile) {
      return Response.json({ success: false, error: 'Нет медиа для загрузки' }, { status: 400 })
    }

    after(() => queueProductMediaUpload({ productId, photoUrls, photoFiles, videoUrl, videoPosterUrl, videoFile }))
    return Response.json({ success: true, queued: true }, { status: 202 })
  } catch (error: any) {
    if (error?.message === 'Unauthorized' || error?.status === 401) {
      return Response.json({ success: false, error: 'Необходима авторизация' }, { status: 401 })
    }
    console.error('Queue product media upload error:', error)
    return Response.json({ success: false, error: error?.message || 'Не удалось поставить медиа в очередь' }, { status: 500 })
  }
}

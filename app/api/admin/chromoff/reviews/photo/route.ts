import { requireAdmin } from '@/lib/admin-session'
import { uploadReviewPhoto } from '@/lib/chromoff-review-photo'

export const runtime = 'nodejs'
export const maxDuration = 120

function isFile(value: FormDataEntryValue | null | undefined): value is File {
  return Boolean(value && typeof value === 'object' && 'arrayBuffer' in value)
}

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const formData = await request.formData()
    const files = await Promise.all(
      formData.getAll('photo_file').filter(isFile).map(async (file) => ({
        name: file.name || 'photo',
        buffer: Buffer.from(await file.arrayBuffer()),
      }))
    )

    const photo = await uploadReviewPhoto(files)
    return Response.json({ success: true, photo })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить фото'
    if (message === 'Unauthorized' || (error as { status?: number })?.status === 401) {
      return Response.json({ success: false, error: 'Необходима авторизация' }, { status: 401 })
    }
    console.error('Chromoff review photo upload failed:', error)
    return Response.json({ success: false, error: message }, { status: 400 })
  }
}

import { createHash } from 'node:crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { bucketName, getS3PublicUrl, s3Client } from '@/lib/s3'

const WIDTH = 960
const HEIGHT = 1280
const GAP = 8
const MAX_PHOTOS = 3
const MAX_BYTES = 30 * 1024 * 1024
/** #0e0e10 — фон талона на главной, поля коллажа не должны читаться как рамка */
const BACKGROUND = { r: 14, g: 14, b: 16, alpha: 1 }

export interface UploadedReviewPhoto {
  src: string
  width: number
  height: number
}

/**
 * Готовит кадр для карточки «Отправки»: одно фото режется в 3:4,
 * несколько склеиваются вертикальным коллажем 3:4 с тонкими полями.
 */
export async function uploadReviewPhoto(files: Array<{ name: string; buffer: Buffer }>): Promise<UploadedReviewPhoto> {
  if (!bucketName) throw new Error('S3_BUCKET не настроен')
  if (files.length === 0) throw new Error('прикрепите фото')
  if (files.length > MAX_PHOTOS) throw new Error(`максимум ${MAX_PHOTOS} фото в одной карточке`)

  for (const file of files) {
    if (!file.buffer.length) throw new Error(`пустой файл ${file.name}`)
    if (file.buffer.length > MAX_BYTES) throw new Error(`фото ${file.name} больше 30 МБ`)
  }

  const bandHeights = files.length === 1
    ? [HEIGHT]
    : files.map((_, index) => {
      const band = Math.floor((HEIGHT - GAP * (files.length - 1)) / files.length)
      return index === files.length - 1 ? HEIGHT - (band + GAP) * (files.length - 1) : band
    })

  const tiles: Array<{ input: Buffer; top: number; left: number }> = []
  let top = 0
  for (const [index, file] of files.entries()) {
    const height = bandHeights[index]
    const input = await sharp(file.buffer)
      .rotate()
      .resize(WIDTH, height, { fit: 'cover', position: 'centre' })
      .toBuffer()
    tiles.push({ input, top, left: 0 })
    top += height + GAP
  }

  const output = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BACKGROUND } })
    .composite(tiles)
    .webp({ quality: 82, effort: 4 })
    .toBuffer()

  const hash = createHash('sha256').update(output).digest('hex').slice(0, 16)
  const key = `site/orders/review-${hash}.webp`
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: output,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return { src: getS3PublicUrl(key), width: WIDTH, height: HEIGHT }
}

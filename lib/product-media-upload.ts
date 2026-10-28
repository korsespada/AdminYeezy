import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { bucketName, getS3PublicUrl, s3Client } from '@/lib/s3'

const MAX_PHOTO_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 150 * 1024 * 1024

export interface ProductPhotoUpload {
  source: string
  media: {
    original_url: string
    thumb_url: string
    preview_url: string
    og_image_url: string
    alt_text: string
    processing_status: 'processed'
  }
}

export interface ProductVideoUpload {
  source: string
  url: string
  posterUrl: string
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function requireS3() {
  if (!bucketName) throw new Error('S3_BUCKET не настроен')
}

async function objectExists(key: string) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
    return true
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode || error?.statusCode
    const code = error?.name || error?.Code || error?.code
    if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') return false
    throw error
  }
}

async function fetchSource(url: string, maxBytes: number, label: string) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`для ${label} разрешены только HTTP(S) ссылки`)
  }

  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`источник ${label} вернул HTTP ${response.status}`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > maxBytes) throw new Error(`${label} больше ${maxBytes / 1024 / 1024} МБ`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error(`источник вернул пустой ${label}`)
  if (buffer.length > maxBytes) throw new Error(`${label} больше ${maxBytes / 1024 / 1024} МБ`)
  return buffer
}

async function uploadPhotoBuffer(source: string, buffer: Buffer): Promise<ProductPhotoUpload> {
  requireS3()
  const key = `products/media/${sha256(buffer)}.webp`
  if (!(await objectExists(key))) {
    const normalized = await sharp(buffer).rotate().webp({ quality: 88, effort: 4 }).toBuffer()
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: normalized,
      ContentType: 'image/webp',
    }))
  }

  const url = getS3PublicUrl(key)
  return {
    source,
    media: {
      original_url: url,
      thumb_url: url,
      preview_url: url,
      og_image_url: url,
      alt_text: '',
      processing_status: 'processed',
    },
  }
}

export async function uploadProductPhotoFromUrl(url: string) {
  const source = String(url || '').trim()
  if (!source) throw new Error('пустая ссылка на фото')
  return uploadPhotoBuffer(source, await fetchSource(source, MAX_PHOTO_BYTES, 'фото'))
}

export async function uploadProductPhotoFromBuffer(source: string, buffer: Buffer) {
  if (!buffer.length) throw new Error('пустой файл фото')
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error('фото больше 30 МБ')
  return uploadPhotoBuffer(source, buffer)
}

function videoTranscode() {
  // Общий модуль нужен и публикации выгрузок (scripts/batch-workflow.js), поэтому он на CommonJS.
  return require('../scripts/lib/video-transcode') as {
    transcodeVideoForWeb: (sourcePath: string, outputPath: string, posterJpegPath: string) => Promise<{ mode: 'remux' | 'transcode' }>
  }
}

export async function uploadProductVideoFromBuffer(source: string, buffer: Buffer): Promise<ProductVideoUpload> {
  requireS3()
  if (!buffer.length) throw new Error('пустой файл видео')
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('видео больше 150 МБ')

  const fingerprint = sha256(buffer)
  const videoKey = `videos/${fingerprint}.mp4`
  const posterKey = `videos/${fingerprint}-poster.webp`
  if (await objectExists(videoKey) && await objectExists(posterKey)) {
    return { source, url: getS3PublicUrl(videoKey), posterUrl: getS3PublicUrl(posterKey) }
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'yeezy-product-video-'))
  const sourcePath = join(tempDir, 'source-video')
  const outputPath = join(tempDir, 'video.mp4')
  const posterJpegPath = join(tempDir, 'poster.jpg')

  try {
    writeFileSync(sourcePath, buffer)
    await videoTranscode().transcodeVideoForWeb(sourcePath, outputPath, posterJpegPath)

    const video = readFileSync(outputPath)
    const poster = await sharp(readFileSync(posterJpegPath)).webp({ quality: 84, effort: 4 }).toBuffer()
    await Promise.all([
      s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: videoKey, Body: video, ContentType: 'video/mp4' })),
      s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: posterKey, Body: poster, ContentType: 'image/webp' })),
    ])

    return { source, url: getS3PublicUrl(videoKey), posterUrl: getS3PublicUrl(posterKey) }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export async function uploadProductVideoFromUrl(url: string) {
  const source = String(url || '').trim()
  if (!source) throw new Error('пустая ссылка на видео')
  return uploadProductVideoFromBuffer(source, await fetchSource(source, MAX_VIDEO_BYTES, 'видео'))
}

export const productMediaUploadLimits = {
  maxPhotoBytes: MAX_PHOTO_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
}

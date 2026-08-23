import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
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

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} завершился с кодом ${code}: ${stderr.trim()}`))
    })
  })
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
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
    await runProcess(ffmpeg, [
      '-y', '-i', sourcePath,
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', "scale=w='min(1080,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath,
    ])
    await runProcess(ffmpeg, [
      '-y', '-ss', '0.5', '-i', outputPath, '-frames:v', '1', '-q:v', '3', posterJpegPath,
    ])

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

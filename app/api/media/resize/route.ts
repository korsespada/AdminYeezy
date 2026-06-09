import { NextResponse, type NextRequest } from 'next/server'
import sharp from 'sharp'

const ALLOWED_HOSTS = new Set([
  'static.yeezyunique.ru',
  'cdn.yeezyunique.ru',
  'yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru',
  'xcimg.szwego.com',
  'localhost',
  '127.0.0.1',
])

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const sourceUrl = request.nextUrl.searchParams.get('url')
  if (!sourceUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'Unsupported image host' }, { status: 400 })
  }

  try {
    const width = clamp(request.nextUrl.searchParams.get('w'), 64, 2400, 900)
    const height = clamp(request.nextUrl.searchParams.get('h'), 64, 2400, 1200)
    const quality = clamp(request.nextUrl.searchParams.get('q'), 30, 95, 82)
    const fit = request.nextUrl.searchParams.get('fit') === 'inside' ? 'inside' : 'cover'

    const response = await fetch(parsedUrl, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch source image' }, { status: 502 })
    }

    const input = Buffer.from(await response.arrayBuffer())
    const output = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(width, height, {
        fit,
        withoutEnlargement: true,
        position: 'centre',
      })
      .webp({ quality, effort: 4 })
      .toBuffer()

    return new NextResponse(new Uint8Array(output), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to resize image' }, { status: 500 })
  }
}

function clamp(value: string | null, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

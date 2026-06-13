import { NextResponse } from 'next/server'

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'static.yeezyunique.ru',
  'cdn.yeezyunique.ru',
  'yeezy-app-thumbs.hb.ru-msk.vkcloud-storage.ru',
  'xcimg.szwego.com',
])

const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')

    if (!url) {
        return new NextResponse('Missing URL parameter', { status: 400 })
    }

    try {
        const parsedUrl = new URL(url)
        if (!['https:'].includes(parsedUrl.protocol) || !ALLOWED_DOWNLOAD_HOSTS.has(parsedUrl.hostname)) {
            return new NextResponse('Unsupported URL', { status: 400 })
        }

        const response = await fetch(parsedUrl, {
            headers: { Accept: 'image/*' },
            signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream'
        const contentLength = Number(response.headers.get('content-length') || 0)
        if (!contentType.startsWith('image/') || contentLength > MAX_DOWNLOAD_BYTES) {
            return new NextResponse('Unsupported file', { status: 400 })
        }

        const arrayBuffer = await response.arrayBuffer()
        if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
            return new NextResponse('File too large', { status: 413 })
        }

        return new NextResponse(arrayBuffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        })
    } catch (error) {
        console.error('Proxy download error:', error)
        return new NextResponse('Error downloading file', { status: 500 })
    }
}

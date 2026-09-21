/**
 * Зеркалирование фото David Studio с cdn.shopify.com на наш S3.
 *
 * Ссылки выгрузки поставщика ведут на cdn.shopify.com. Пока фото там, сравнение
 * колец зависит от чужого CDN: он бывает недоступен, из-за чего падал целый
 * запрос, а 8 колец без карточки в Chromoff вообще не участвовали в подборе.
 *
 * Что делает:
 *   1. читает data/david-studio/catalog.json;
 *   2. качает каждое фото и кладёт в S3 под ключом по содержимому
 *      supplier-media/david-studio/<sha256>.<ext> (одинаковые кадры не дублируются);
 *   3. пишет соответствие «адрес поставщика → наш адрес» в david_media_mirror.
 *
 * Повторный запуск пропускает уже зеркалированные адреса, поэтому скрипт можно
 * прерывать и догонять. Адрес поставщика без query-строки: у Shopify там версия
 * файла, и без неё один кадр не превращается в два.
 *
 * Запуск:
 *   node scripts/mirror-david-studio-media.mjs --scope rings --dry-run
 *   node scripts/mirror-david-studio-media.mjs --scope rings
 *   node scripts/mirror-david-studio-media.mjs --scope all --concurrency 4
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Pool } from 'pg'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const args = process.argv.slice(2)
const argValue = (name, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const SCOPE = argValue('--scope', 'rings')
const DRY_RUN = args.includes('--dry-run')
const LIMIT = Number(argValue('--limit', '0')) || 0
const CONCURRENCY = Math.max(1, Math.min(8, Number(argValue('--concurrency', '4')) || 4))
const RETRIES = Math.max(1, Number(argValue('--retries', '3')) || 3)
const CATALOG_FILE = argValue('--catalog', 'data/david-studio/catalog.json')
const KEY_PREFIX = 'supplier-media/david-studio'

const bucketName = process.env.S3_BUCKET || ''
if (!DRY_RUN && !bucketName) {
  console.error('S3_BUCKET не задан')
  process.exit(1)
}

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
})

const pool = new Pool({ connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL })

function s3PublicUrl(key) {
  const domain = (process.env.S3_PUBLIC_DOMAIN || '').replace(/\/+$/, '')
  if (domain) return `${domain}/${key}`
  const endpoint = process.env.S3_ENDPOINT || ''
  if (endpoint.includes('selcloud.ru') || endpoint.includes('beget.cloud')) {
    return `https://${bucketName}.${new URL(endpoint).hostname}/${key}`
  }
  return `${endpoint.replace(/\/+$/, '')}/${bucketName}/${key}`
}

/** Убирает query-строку Shopify: там версия файла, а не другой кадр. */
function canonicalSourceUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    return parsed.toString()
  } catch {
    return String(url || '')
  }
}

function isRing(product) {
  const type = String(product.product_type || '').trim().toLowerCase()
  const category = String(product.category || '').trim().toLowerCase()
  return type === 'rings' || category === 'rings' || category === 'chrome-hearts-cross-rings'
}

function contentTypeFor(url) {
  const extension = extname(new URL(url).pathname).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.avif') return 'image/avif'
  return 'image/jpeg'
}

function extensionFor(url, contentType) {
  const extension = extname(new URL(url).pathname).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(extension)) return extension
  if (contentType === 'image/png') return '.png'
  if (contentType === 'image/webp') return '.webp'
  return '.jpg'
}

async function download(url) {
  let lastError
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error('пустой файл')
      return { buffer, contentType: String(response.headers.get('content-type') || '').split(';')[0] || 'image/jpeg' }
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
    }
  }
  throw lastError
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
    return true
  } catch {
    return false
  }
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
  const products = (catalog.products || []).filter((product) => (SCOPE === 'all' ? true : isRing(product)))

  const jobs = []
  for (const product of products) {
    const handle = String(product.handle || '')
    if (!handle) continue
    for (const [index, image] of (product.images || []).entries()) {
      const source = String(image?.src || '')
      if (!source.startsWith('http')) continue
      jobs.push({ handle, position: Number(image?.position ?? index + 1) || index + 1, source: canonicalSourceUrl(source) })
    }
  }

  const known = await pool.query('SELECT source_url FROM david_media_mirror')
  const knownUrls = new Set(known.rows.map((row) => String(row.source_url)))
  let pending = jobs.filter((job) => !knownUrls.has(job.source))
  if (LIMIT) pending = pending.slice(0, LIMIT)

  console.log(`область: ${SCOPE} | товаров ${products.length} | фото всего ${jobs.length} | уже в зеркале ${knownUrls.size} | к загрузке ${pending.length}`)

  if (DRY_RUN) {
    const byHandle = new Map()
    for (const job of pending) byHandle.set(job.handle, (byHandle.get(job.handle) || 0) + 1)
    console.log(`сухой прогон: качать нечего? ${pending.length === 0}; уникальных товаров ${byHandle.size}`)
    console.log('примеры:', pending.slice(0, 5).map((job) => `${job.handle}#${job.position}`).join(', '))
    await pool.end()
    return
  }

  let uploaded = 0
  let reused = 0
  let failed = 0
  let bytes = 0
  const failures = []
  let cursor = 0
  let done = 0

  async function worker() {
    while (cursor < pending.length) {
      const job = pending[cursor]
      cursor += 1
      try {
        const { buffer, contentType } = await download(job.source)
        const hash = createHash('sha256').update(buffer).digest('hex')
        const key = `${KEY_PREFIX}/${hash}${extensionFor(job.source, contentType)}`
        const publicUrl = s3PublicUrl(key)

        if (await objectExists(key)) {
          reused += 1
        } else {
          await s3.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: buffer,
            ContentType: contentType || contentTypeFor(job.source),
            CacheControl: 'public, max-age=31536000, immutable',
          }))
          uploaded += 1
          bytes += buffer.length
        }

        await pool.query(
          `INSERT INTO david_media_mirror (id, handle, position, source_url, s3_url, bytes, content_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (source_url) DO NOTHING`,
          [randomUUID(), job.handle, job.position, job.source, publicUrl, buffer.length, contentType],
        )
      } catch (error) {
        failed += 1
        if (failures.length < 20) failures.push(`${job.handle}#${job.position}: ${String(error?.message || error)}`)
      }

      done += 1
      if (done % 50 === 0 || done === pending.length) {
        console.log(`  ${done}/${pending.length}: загружено ${uploaded}, уже было ${reused}, сбоев ${failed}, ${(bytes / 1024 / 1024).toFixed(0)} МБ`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const total = await pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(bytes),0)::bigint AS bytes FROM david_media_mirror')
  console.log(`\nитог: загружено ${uploaded}, переиспользовано ${reused}, сбоев ${failed}, новых байт ${(bytes / 1024 / 1024).toFixed(0)} МБ`)
  console.log(`в зеркале всего: ${total.rows[0].n} фото, ${(Number(total.rows[0].bytes) / 1024 / 1024).toFixed(0)} МБ`)
  for (const failure of failures) console.log('  сбой:', failure)

  if (uploaded) {
    const sample = await pool.query('SELECT s3_url FROM david_media_mirror ORDER BY created_at DESC LIMIT 1')
    const url = sample.rows[0]?.s3_url
    const check = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((error) => ({ ok: false, status: String(error?.message) }))
    console.log(`проверка публичного адреса: ${url} -> ${check.status}${check.ok ? ' (доступен)' : ''}`)
  }

  await pool.end()
}

main().catch(async (error) => {
  console.error('ОШИБКА:', error.message)
  await pool.end().catch(() => {})
  process.exit(1)
})

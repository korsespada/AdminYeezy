// Публикация отзывов в блок «Отправки» на главной chromoff.store.
//
//   node scripts/chromoff-review.mjs list
//   node scripts/chromoff-review.mjs create --city Москва --month 2026-10 \
//     --text "Всё отлично, спасибо" --item "Chrome Hearts Кольцо|https://chromoff.store/product/koltso" \
//     --photo ~/Downloads/report.jpg --alt "Фотоотчёт перед отправкой: кольцо, Москва" --publish
//   node scripts/chromoff-review.mjs publish --id <uuid>
//   node scripts/chromoff-review.mjs hide --id <uuid>
//   node scripts/chromoff-review.mjs delete --id <uuid>
//
// Фото: 1–3 файла, режутся в кадр 3:4 и уходят в S3 под своим хешем.
// Публикация идёт в Rails admin API, поэтому деплой сайта не нужен.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import sharp from 'sharp'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true })
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })

const WIDTH = 960
const HEIGHT = 1280
const GAP = 8
const MAX_PHOTOS = 3
const BACKGROUND = { r: 14, g: 14, b: 16, alpha: 1 }
const PHOTO_LABELS = {
  report: 'Фотоотчёт перед отправкой',
  customer: 'Фото покупателя',
  catalog: 'Фото из карточки товара',
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function apiBase() {
  const raw = (process.env.RAILS_API_URL || process.env.VITE_API_URL || '').replace(/\/+$/, '')
  if (!raw) fail('RAILS_API_URL не задан в .env')
  return raw.endsWith('/api/v1') ? raw : `${raw}/api/v1`
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list'
  const rest = command === 'list' && argv[0]?.startsWith('--') ? argv : argv.slice(1)
  const args = { command, photos: [], items: [] }

  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    const value = () => rest[++index]
    switch (key) {
      case '--city': args.city = value(); break
      case '--month': args.month = value(); break
      case '--text': args.text = value(); break
      case '--alt': args.alt = value(); break
      case '--type': args.type = value(); break
      case '--id': args.id = value(); break
      case '--position': args.position = value(); break
      case '--photo': args.photos.push(value()); break
      case '--item': args.items.push(value()); break
      case '--featured': args.featured = true; break
      case '--publish': args.publish = true; break
      case '--help': args.help = true; break
      default: fail(`Неизвестный аргумент: ${key}`)
    }
  }

  return args
}

async function login() {
  const email = process.env.RAILS_ADMIN_EMAIL
  const password = process.env.RAILS_ADMIN_PASSWORD
  if (!email || !password) fail('RAILS_ADMIN_EMAIL / RAILS_ADMIN_PASSWORD не заданы в .env')

  const response = await fetch(`${apiBase()}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) fail(payload.message || payload.error || `Не удалось войти в Rails admin (${response.status})`)
  return payload.token
}

async function request(token, pathname, init = {}) {
  const response = await fetch(`${apiBase()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}))
  if (!response.ok) {
    const details = payload?.details ? `: ${JSON.stringify(payload.details)}` : ''
    fail(`${payload?.message || payload?.error || `HTTP ${response.status}`}${details}`)
  }
  return payload
}

function publicDomain() {
  const domain = (process.env.S3_PUBLIC_DOMAIN || '').replace(/\/+$/, '')
  if (!domain) fail('S3_PUBLIC_DOMAIN не задан в .env')
  return domain
}

async function uploadPhoto(files) {
  if (!files.length) return null
  if (files.length > MAX_PHOTOS) fail(`Максимум ${MAX_PHOTOS} фото`)

  for (const file of files) {
    if (!fs.existsSync(file)) fail(`Нет файла ${file}`)
  }

  const bands = files.length === 1
    ? [HEIGHT]
    : files.map((_, index) => {
      const band = Math.floor((HEIGHT - GAP * (files.length - 1)) / files.length)
      return index === files.length - 1 ? HEIGHT - (band + GAP) * (files.length - 1) : band
    })

  const tiles = []
  let top = 0
  for (const [index, file] of files.entries()) {
    const input = await sharp(file).rotate().resize(WIDTH, bands[index], { fit: 'cover', position: 'centre' }).toBuffer()
    tiles.push({ input, top, left: 0 })
    top += bands[index] + GAP
  }

  const output = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BACKGROUND } })
    .composite(tiles)
    .webp({ quality: 82, effort: 4 })
    .toBuffer()

  const bucket = process.env.S3_BUCKET
  if (!bucket) fail('S3_BUCKET не задан в .env')

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'ru-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    forcePathStyle: true,
  })

  const key = `site/orders/review-${crypto.createHash('sha256').update(output).digest('hex').slice(0, 16)}.webp`
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: output,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return `${publicDomain()}/${key}`
}

function parseItems(values) {
  if (!values.length) fail('Нужен хотя бы один --item "Название|ссылка"')
  return values.map((value) => {
    const [name, href = ''] = value.split('|').map((part) => part.trim())
    if (!name) fail(`Не разобрал товар: ${value}`)
    return { name, href, channel: /^https?:\/\/t\.me\//.test(href) }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 16).join('\n'))
    return
  }

  const token = await login()

  if (args.command === 'list') {
    const payload = await request(token, '/admin/chromoff/reviews')
    for (const review of payload.reviews || []) {
      const mark = review.featured ? '*' : ' '
      console.log(`${mark} ${review.status === 'published' ? 'pub' : 'draft'} ${review.month} ${review.city} — ${review.id} — ${review.review || 'без текста'}`)
    }
    return
  }

  if (args.command === 'create') {
    if (!args.city) fail('Нужен --city')
    if (!args.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) fail('Нужен --month YYYY-MM')

    const items = parseItems(args.items)
    const photoSrc = await uploadPhoto(args.photos)
    const type = args.type || 'report'
    if (!PHOTO_LABELS[type]) fail('--type: report, customer или catalog')
    const city = args.city.trim()
    const alt = args.alt?.trim() || `${PHOTO_LABELS[type]}: ${items[0].name}${type === 'catalog' || !city ? '' : `, ${city}`}`

    if (args.publish && !photoSrc) fail('Для публикации нужно фото (--photo)')
    if (args.publish && !alt) fail('Для публикации нужен --alt')

    const payload = await request(token, '/admin/chromoff/reviews', {
      method: 'POST',
      body: JSON.stringify({
        review: {
          city,
          month: args.month,
          review: args.text?.trim() || null,
          status: args.publish ? 'published' : 'draft',
          featured: Boolean(args.featured),
          position: Number.parseInt(args.position || '0', 10) || 0,
          items,
          photo_src: photoSrc,
          photo_alt: photoSrc ? alt : null,
          photo_customer: type === 'customer',
          photo_catalog: type === 'catalog',
        },
      }),
    })

    console.log(`${args.publish ? 'Опубликован' : 'Черновик сохранён'}: ${payload.review.id}`)
    if (photoSrc) console.log(`Фото: ${photoSrc}`)
    return
  }

  if (args.command === 'publish' || args.command === 'hide') {
    if (!args.id) fail('Нужен --id')
    await request(token, `/admin/chromoff/reviews/${encodeURIComponent(args.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ review: { status: args.command === 'publish' ? 'published' : 'draft' } }),
    })
    console.log(args.command === 'publish' ? 'Опубликован.' : 'Снят с публикации.')
    return
  }

  if (args.command === 'delete') {
    if (!args.id) fail('Нужен --id')
    await request(token, `/admin/chromoff/reviews/${encodeURIComponent(args.id)}`, { method: 'DELETE' })
    console.log('Удалён.')
    return
  }

  fail(`Неизвестная команда: ${args.command}`)
}

await main()

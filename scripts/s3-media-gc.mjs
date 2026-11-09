#!/usr/bin/env node
/**
 * Уборка неиспользуемых медиа в S3: префиксы `videos/` и `products/media/`.
 *
 * Файл удаляется, только если на его ключ не ссылается ни CRM (Rails endpoint
 * GET /api/v1/admin/media_references), ни yu_scraping (все текстовые и JSON-колонки),
 * и он старше --min-age-days. Видео и постер сохраняются парой.
 * Фото партий (`batches/`) сюда не входят: их чистит публикация партии.
 *
 * По умолчанию только отчёт. Удаление — флаг --apply.
 *
 *   node scripts/s3-media-gc.mjs
 *   node scripts/s3-media-gc.mjs --min-age-days 60 --list
 *   node scripts/s3-media-gc.mjs --apply
 *
 * Нужны: S3_*, SCRAPING_DATABASE_URL, RAILS_API_URL и RAILS_ADMIN_TOKEN
 * (или RAILS_ADMIN_EMAIL/RAILS_ADMIN_PASSWORD) с ролью owner или admin.
 */
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'
import pg from 'pg'
import mediaGc from './lib/s3-media-gc.js'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const { MANAGED_PREFIXES, extractStorageKeys, planMediaGc } = mediaGc

const args = process.argv.slice(2)
const argValue = (name, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')
const LIST = args.includes('--list')
const MIN_AGE_DAYS = Math.max(7, Number(argValue('--min-age-days', '30')) || 30)
// Если к удалению больше этой доли файлов, скорее всего сломан сбор ссылок: без --force не удаляем.
const MAX_CANDIDATE_SHARE = 0.5
// Таблицы yu_scraping, где не бывает ссылок на медиа, но много строк.
const SKIPPED_SCRAPING_TABLES = /^(analytics_|pg_)/

function fail(message) {
  console.error(message)
  process.exit(1)
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) fail(`${name} не задан`)
  return value
}

const bucketName = requireEnv('S3_BUCKET')
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
})

function railsApiUrl(pathname) {
  let base = (process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '')
  if (!base) fail('RAILS_API_URL не задан')
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`
  return `${base}${pathname}`
}

async function railsAdminToken() {
  const staticToken = process.env.RAILS_ADMIN_TOKEN || process.env.ADMIN_RAILS_TOKEN
  if (staticToken) return staticToken
  const email = requireEnv('RAILS_ADMIN_EMAIL')
  const password = requireEnv('RAILS_ADMIN_PASSWORD')
  const response = await fetch(railsApiUrl('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) fail(`Rails login: ${payload.message || payload.error || response.status}`)
  return payload.token
}

async function railsReferencedKeys() {
  const token = await railsAdminToken()
  const response = await fetch(railsApiUrl('/admin/media_references'), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) fail(`Rails media_references вернул HTTP ${response.status}`)
  const payload = await response.json()
  const keys = payload?.media_references?.keys
  if (!Array.isArray(keys)) fail('Rails media_references вернул неожиданный ответ')
  return keys.map(String)
}

async function scrapingReferencedKeys() {
  const pool = new pg.Pool({ connectionString: requireEnv('SCRAPING_DATABASE_URL') })
  try {
    const { rows: columns } = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
      ORDER BY table_name, column_name
    `)
    const keys = new Set()
    for (const { table_name: table, column_name: column } of columns) {
      if (SKIPPED_SCRAPING_TABLES.test(table)) continue
      const value = `${pg.escapeIdentifier(column)}::text`
      const { rows } = await pool.query(`
        SELECT ${value} AS value
        FROM ${pg.escapeIdentifier(table)}
        WHERE ${value} LIKE '%videos/%' OR ${value} LIKE '%products/media/%'
      `)
      for (const row of rows) for (const key of extractStorageKeys(row.value)) keys.add(key)
    }
    return [...keys]
  } finally {
    await pool.end()
  }
}

async function listManagedObjects() {
  const objects = []
  for (const prefix of MANAGED_PREFIXES) {
    let token
    do {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, ContinuationToken: token }))
      for (const item of listed.Contents || []) {
        if (item.Key) objects.push({ key: item.Key, size: item.Size || 0, lastModified: item.LastModified })
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined
    } while (token)
  }
  return objects
}

async function deleteKeys(keys) {
  let deleted = 0
  const errors = []
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000)
    const result = await s3.send(new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    }))
    errors.push(...(result.Errors || []))
    deleted += chunk.length - (result.Errors || []).length
  }
  return { deleted, errors }
}

const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`

async function main() {
  const [railsKeys, scrapingKeys, objects] = await Promise.all([
    railsReferencedKeys(),
    scrapingReferencedKeys(),
    listManagedObjects(),
  ])
  if (railsKeys.length === 0) fail('Rails не вернул ни одной ссылки — похоже на ошибку, удаление отменено')

  const plan = planMediaGc({ objects, referencedKeys: [...railsKeys, ...scrapingKeys], minAgeDays: MIN_AGE_DAYS })
  const oldObjects = plan.candidates.length + plan.referenced
  console.log(`в бакете: ${objects.length} файлов в ${MANAGED_PREFIXES.join(', ')}`)
  console.log(`ссылок: Rails ${railsKeys.length}, yu_scraping ${scrapingKeys.length}`)
  console.log(`используются: ${plan.referenced} | моложе ${MIN_AGE_DAYS} дн.: ${plan.young}`)
  console.log(`к удалению: ${plan.candidates.length} файлов, ${formatMb(plan.candidateBytes)}`)
  for (const item of LIST ? plan.candidates : plan.candidates.slice(0, 20)) console.log(`  ${item.key}`)
  if (!LIST && plan.candidates.length > 20) console.log(`  … ещё ${plan.candidates.length - 20} (весь список: --list)`)

  if (!APPLY) {
    console.log('Отчёт без удаления. Чтобы удалить, запустите с --apply.')
    return
  }
  if (!plan.candidates.length) return
  if (!FORCE && plan.candidates.length > oldObjects * MAX_CANDIDATE_SHARE) {
    fail(`к удалению больше ${MAX_CANDIDATE_SHARE * 100}% старых файлов — проверьте отчёт и повторите с --force`)
  }

  const { deleted, errors } = await deleteKeys(plan.candidates.map((item) => item.key))
  console.log(`удалено: ${deleted}`)
  if (errors.length) {
    for (const error of errors.slice(0, 20)) console.error(`  ошибка ${error.Key}: ${error.Code} ${error.Message}`)
    process.exitCode = 1
  }
}

main().catch((error) => fail(error?.stack || String(error)))

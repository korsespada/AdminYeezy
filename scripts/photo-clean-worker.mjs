#!/usr/bin/env node
/**
 * Локальный воркер чистки фотографий от вотермарки (машина оператора).
 *
 * Почему локально: чистка идёт нейросетью LaMa (torch + модель ~200 МБ) и забирает все ядра,
 * в контейнере AdminYeezy это держать нельзя. Воркер сам ходит наружу — в AdminYeezy за
 * заданиями, на Shopify CDN за оригиналами и в наш S3 за результатом. Входящие порты не нужны.
 *
 * Запуск:
 *   node scripts/photo-clean-worker.mjs                # крутится постоянно
 *   node scripts/photo-clean-worker.mjs --once         # разобрать одну пачку и выйти
 *   node scripts/photo-clean-worker.mjs --limit 3      # сколько фото брать за раз
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import dotenv from 'dotenv'

dotenv.config()

const argv = process.argv.slice(2)
const hasFlag = (flag) => argv.includes(flag)
const argValue = (flag) => {
  const index = argv.indexOf(flag)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null
}

const ADMIN_URL = (process.env.PHOTO_CLEAN_ADMIN_URL || process.env.ADMIN_URL || 'http://localhost:3000').replace(/\/+$/, '')
const WORKER_TOKEN = process.env.PHOTO_CLEAN_WORKER_TOKEN || process.env.BATCH_AI_WORKER_TOKEN || ''
const WORKER_ID = process.env.PHOTO_CLEAN_WORKER_ID || `photo-clean-${process.env.COMPUTERNAME || 'local'}`
const PYTHON = process.env.PYTHON_PATH || join('.venv', 'Scripts', 'python.exe')
const MODEL = process.env.PHOTO_CLEAN_MODEL || join('tmp', 'david-watermark-pilot', 'models', 'big-lama.pt')
const TEMPLATES = process.env.PHOTO_CLEAN_TEMPLATES || join('data', 'david-studio', 'watermark')
const CLEANER = join('scripts', 'david-studio-watermark', 'clean_one.py')
const LIMIT = Math.max(1, Math.min(10, Number(argValue('--limit') || 3)))
const IDLE_MS = Number(process.env.PHOTO_CLEAN_IDLE_MS || 15000)

const bucketName = process.env.S3_BUCKET || ''
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
})

function log(...args) {
  console.log(`[photo-clean ${new Date().toISOString().slice(11, 19)}]`, ...args)
}

function s3PublicUrl(key) {
  const domain = (process.env.S3_PUBLIC_DOMAIN || '').replace(/\/+$/, '')
  if (domain) return `${domain}/${key}`
  const endpoint = process.env.S3_ENDPOINT || ''
  if (endpoint.includes('selcloud.ru') || endpoint.includes('beget.cloud')) {
    return `https://${bucketName}.${new URL(endpoint).hostname}/${key}`
  }
  return `${endpoint.replace(/\/+$/, '')}/${bucketName}/${key}`
}

async function api(body) {
  if (!WORKER_TOKEN) throw new Error('PHOTO_CLEAN_WORKER_TOKEN не задан')
  const response = await fetch(`${ADMIN_URL}/api/photo-clean/worker`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, worker_id: WORKER_ID }),
    signal: AbortSignal.timeout(60000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `AdminYeezy HTTP ${response.status}`)
  return payload
}

async function download(url, target) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`источник вернул HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('источник вернул пустой файл')
  writeFileSync(target, buffer)
  return buffer.length
}

function runPython(args, timeoutMs = Number(process.env.PHOTO_CLEAN_PYTHON_TIMEOUT_MS || 240000)) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [CLEANER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    // Без таймаута один тяжёлый кадр блокирует всю очередь: процесс висит, lease держится.
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`чистка не уложилась в ${Math.round(timeoutMs / 1000)} с`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `python ${code}`))
    })
  })
}

async function uploadFile(key, file, contentType) {
  const body = readFileSync(file)
  await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }))
  return s3PublicUrl(key)
}

async function processJob(job) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-clean-'))
  try {
    const extension = extname(new URL(job.source_url.split('?')[0]).pathname) || '.jpg'
    const input = join(dir, `source${extension}`)
    const cleaned = join(dir, 'clean.webp')
    const reportPath = join(dir, 'report.json')
    const cropBefore = join(dir, 'before.png')
    const cropAfter = join(dir, 'after.png')

    const bytes = await download(job.source_url, input)
    log(`скачано ${Math.round(bytes / 1024)} КБ, чищу ${job.source_product} #${job.source_position}`)
    await runPython([
      '--in', input, '--out', cleaned, '--report', reportPath,
      '--crop-before', cropBefore, '--crop-after', cropAfter,
      '--templates', TEMPLATES, '--model', MODEL,
    ])
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    log(`  ${report.status} score=${report.score} z_after=${report.z_after} mask=${report.mask_px} ${report.seconds}с`)

    const hash = createHash('sha256').update(readFileSync(cleaned)).digest('hex')
    const cleanUrl = await uploadFile(`products/media/${hash}.webp`, cleaned, 'image/webp')
    const beforeUrl = await uploadFile(`photo-clean/${hash}/before.png`, cropBefore, 'image/png')
    const afterUrl = await uploadFile(`photo-clean/${hash}/after.png`, cropAfter, 'image/png')

    await api({
      action: 'complete',
      job_id: job.id,
      lease_token: job.lease_token,
      clean_status: report.status,
      s3_clean_url: cleanUrl,
      s3_before_url: beforeUrl,
      s3_after_url: afterUrl,
      z_after: report.z_after,
      mask_px: report.mask_px,
      passes: report.passes,
      seconds: report.seconds,
      quality: report,
    })
    return report
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  if (!bucketName) throw new Error('S3_BUCKET не задан')
  if (!existsSync(PYTHON)) throw new Error(`нет интерпретатора: ${PYTHON}`)
  if (!existsSync(MODEL)) throw new Error(`нет модели LaMa: ${MODEL} (скачайте её скриптом чистки) — либо укажите PHOTO_CLEAN_MODEL`)
  log(`воркер ${WORKER_ID} → ${ADMIN_URL}, за раз беру ${LIMIT} фото`)

  let stopping = false
  process.on('SIGINT', () => { stopping = true; log('останавливаюсь после текущего фото…') })

  for (;;) {
    let jobs = []
    try {
      const claimed = await api({ action: 'claim', limit: LIMIT })
      jobs = claimed.jobs || []
    } catch (error) {
      log('не смог получить задания:', error.message)
    }

    if (!jobs.length) {
      if (hasFlag('--once')) {
        log('заданий нет, выхожу (--once)')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      if (stopping) return
      continue
    }

    for (const job of jobs) {
      try {
        await processJob(job)
      } catch (error) {
        log(`  ошибка на ${job.source_product} #${job.source_position}: ${error.message}`)
        await api({ action: 'fail', job_id: job.id, lease_token: job.lease_token, error: error.message }).catch(() => {})
      }
      if (stopping) return
    }
    if (hasFlag('--once')) return
  }
}

main().catch((error) => {
  console.error('ОШИБКА:', error.message)
  process.exit(1)
})

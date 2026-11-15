#!/usr/bin/env node
/**
 * Локальный воркер чистки фотографий от вотермарки (машина оператора).
 *
 * Почему локально: чистка идёт нейросетью LaMa (torch + модель ~200 МБ) и забирает все ядра,
 * в контейнере AdminYeezy это держать нельзя. Воркер сам ходит наружу — в AdminYeezy за
 * заданиями, на Shopify CDN за оригиналами и в наш S3 за результатом. Входящие порты не нужны.
 *
 * Скорость: модель LaMa грузится один раз в постоянном процессе Python (clean_one.py --serve),
 * а не на каждое фото; пока чистится кадр, следующий уже скачивается, а готовый — загружается в S3.
 *
 * Запуск:
 *   node scripts/photo-clean-worker.mjs                # крутится постоянно
 *   node scripts/photo-clean-worker.mjs --once         # разобрать одну пачку и выйти
 *   node scripts/photo-clean-worker.mjs --limit 3      # сколько фото брать за раз
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import s3CacheControl from './lib/s3-cache-control.js'
import dotenv from 'dotenv'

const { cacheControlForKey } = s3CacheControl

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
const PYTHON_TIMEOUT_MS = Number(process.env.PHOTO_CLEAN_PYTHON_TIMEOUT_MS || 240000)
const PYTHON_START_TIMEOUT_MS = Number(process.env.PHOTO_CLEAN_START_TIMEOUT_MS || 180000)

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

// Shopify CDN временами отвечает 403/429 на всё подряд (несколько минут), а потом
// снова отдаёт те же файлы. Такой ответ — не сбой кадра: повторяем с паузой, а если
// источник так и не ожил — возвращаем задание в очередь и ждём, не сжигая пачку.
const DOWNLOAD_RETRY_DELAYS_MS = [3000, 15000]
const SOURCE_PAUSE_MS = Number(process.env.PHOTO_CLEAN_SOURCE_PAUSE_MS || 120000)
// После стольких взятий в работу с блокировкой источника кадр помечается сбоем.
const MAX_SOURCE_ATTEMPTS = 5

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class SourceError extends Error {
  constructor(message, retryable) {
    super(message)
    this.retryable = retryable
  }
}

async function downloadOnce(url, target) {
  let response
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(120000) })
  } catch (error) {
    throw new SourceError(`источник недоступен: ${error.cause?.code || error.message}`, true)
  }
  if (!response.ok) {
    const retryable = response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500
    throw new SourceError(`источник вернул HTTP ${response.status}`, retryable)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new SourceError('источник вернул пустой файл', true)
  await writeFile(target, buffer)
  return buffer.length
}

async function download(url, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(url, target)
    } catch (error) {
      if (!error.retryable || attempt >= DOWNLOAD_RETRY_DELAYS_MS.length) throw error
      await sleep(DOWNLOAD_RETRY_DELAYS_MS[attempt])
    }
  }
}

/**
 * Постоянный процесс чистки: Python, torch и модель LaMa грузятся один раз
 * (это ~4–5 с), дальше по строке JSON на фото. Если процесс упал или кадр не
 * уложился в таймаут, процесс убивается и поднимается заново на следующем фото.
 */
class Cleaner {
  constructor() {
    this.child = null
    this.ready = null
    this.pending = null
  }

  start() {
    // detached: Ctrl+C в окне воркера не долетает до Python, текущее фото дочищается.
    // Если окно закрыли, stdin процесса закрывается и он выходит сам.
    const child = spawn(PYTHON, ['-W', 'ignore', CLEANER, '--serve', '--templates', TEMPLATES, '--model', MODEL], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    })
    this.child = child
    let buffer = ''
    let stderrTail = ''
    let markReady
    let failReady
    this.ready = new Promise((resolve, reject) => { markReady = resolve; failReady = reject })
    this.ready.catch(() => {})
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.ready) { markReady(); continue }
        const pending = this.pending
        this.pending = null
        if (!pending) continue
        if (message.ok) pending.resolve(message.report)
        else pending.reject(new Error(message.error || 'ошибка чистки'))
      }
    })
    child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000) })
    child.stdin.on('error', () => {})
    child.on('error', (error) => { stderrTail += `\n${error.message}` })
    child.on('close', (code) => {
      if (this.child === child) this.child = null
      const tail = stderrTail.trim().split('\n').slice(-5).join(' | ')
      const error = new Error(tail || `python завершился с кодом ${code}`)
      failReady(error)
      const pending = this.pending
      this.pending = null
      if (pending) pending.reject(error)
    })
  }

  stop() {
    const child = this.child
    this.child = null
    if (child) child.kill()
  }

  async ensureStarted() {
    if (this.child) return
    log('запускаю процесс чистки и загружаю модель LaMa…')
    const started = Date.now()
    this.start()
    let timer
    try {
      await Promise.race([
        this.ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('процесс чистки не запустился вовремя')), PYTHON_START_TIMEOUT_MS)
        }),
      ])
    } catch (error) {
      this.stop()
      throw error
    } finally {
      clearTimeout(timer)
    }
    log(`модель загружена за ${((Date.now() - started) / 1000).toFixed(1)} с`)
  }

  async clean(request) {
    await this.ensureStarted()
    const child = this.child
    if (!child) throw new Error('процесс чистки остановлен')
    return new Promise((resolve, reject) => {
      // Без таймаута один тяжёлый кадр блокирует всю очередь: процесс висит, lease держится.
      const timer = setTimeout(() => {
        this.pending = null
        this.stop()
        reject(new Error(`чистка не уложилась в ${Math.round(PYTHON_TIMEOUT_MS / 1000)} с`))
      }, PYTHON_TIMEOUT_MS)
      this.pending = {
        resolve: (report) => { clearTimeout(timer); resolve(report) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      child.stdin.write(`${JSON.stringify(request)}\n`)
    })
  }
}

// Ошибки доступа к S3 — это настройка машины, а не кадра: воркер останавливается,
// а не сжигает очередь.
const S3_ACCESS_ERRORS = new Set(['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied', 'NoSuchBucket'])

/** AWS SDK при нестандартном ответе S3 пишет в message «UnknownError» — достаём код и HTTP-статус. */
function s3ErrorMessage(error) {
  const code = error?.Code || error?.name || 'S3Error'
  const status = error?.$metadata?.httpStatusCode
  const detail = error?.message && error.message !== 'UnknownError' && error.message !== code ? `: ${error.message}` : ''
  return `S3 ${code}${status ? ` (HTTP ${status})` : ''}${detail}`
}

async function uploadFile(key, file, contentType) {
  const body = readFileSync(file)
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucketName, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControlForKey(key),
    }))
  } catch (error) {
    const wrapped = new Error(s3ErrorMessage(error))
    wrapped.s3Access = S3_ACCESS_ERRORS.has(error?.Code || error?.name)
    throw wrapped
  }
  return s3PublicUrl(key)
}

/** Проверка ключей S3 до первого фото: с неверным ключом каждый кадр чистился бы впустую. */
async function checkS3() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }))
  } catch (error) {
    throw new Error(`нет доступа к S3 (${s3ErrorMessage(error)}). Проверьте S3_ACCESS_KEY и S3_SECRET_KEY в .env — они должны совпадать с ключами админки в Coolify`)
  }
}

function jobLabel(job) {
  return `${job.source_product} #${job.source_position}`
}

async function failJob(job, error) {
  log(`  ошибка на ${jobLabel(job)}: ${error.message}`)
  await api({ action: 'fail', job_id: job.id, lease_token: job.lease_token, error: error.message }).catch(() => {})
}

/** Вернуть задание в очередь без пометки сбоем (источник временно недоступен). */
async function releaseJob(job, reason) {
  await api({ action: 'release', job_id: job.id, lease_token: job.lease_token, error: reason }).catch(() => {})
}

/** Скачивание оригинала. Не бросает: ошибка возвращается в объекте, чтобы предзагрузка не роняла процесс. */
async function prepareJob(job) {
  const dir = mkdtempSync(join(tmpdir(), 'photo-clean-'))
  try {
    const extension = extname(new URL(job.source_url.split('?')[0]).pathname) || '.jpg'
    const input = join(dir, `source${extension}`)
    const bytes = await download(job.source_url, input)
    return { job, dir, input, bytes }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    return { job, error }
  }
}

async function cleanJob(cleaner, prepared) {
  const { job, dir, input, bytes } = prepared
  // Рамку оператора передаём как есть: чистка пойдёт по ней без автоопределения.
  const manualBox = job.manual_box && typeof job.manual_box === 'object'
    ? [job.manual_box.x1, job.manual_box.y1, job.manual_box.x2, job.manual_box.y2].join(',')
    : ''
  log(`скачано ${Math.round(bytes / 1024)} КБ, чищу ${jobLabel(job)}${manualBox ? ' (рамка оператора)' : ''}`)
  const files = {
    cleaned: join(dir, 'clean.webp'),
    cropBefore: join(dir, 'before.png'),
    cropAfter: join(dir, 'after.png'),
  }
  const report = await cleaner.clean({
    in: input, out: files.cleaned, crop_before: files.cropBefore, crop_after: files.cropAfter, box: manualBox,
  })
  log(`  ${report.status} score=${report.score} z_after=${report.z_after} mask=${report.mask_px} ${report.seconds}с`)
  return { report, files }
}

/** Загрузка результата в S3 и отметка в очереди. */
async function finishJob(job, { report, files }) {
  const hash = createHash('sha256').update(readFileSync(files.cleaned)).digest('hex')
  const [cleanUrl, beforeUrl, afterUrl] = await Promise.all([
    uploadFile(`products/media/${hash}.webp`, files.cleaned, 'image/webp'),
    uploadFile(`photo-clean/${hash}/before.png`, files.cropBefore, 'image/png'),
    uploadFile(`photo-clean/${hash}/after.png`, files.cropAfter, 'image/png'),
  ])

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
}

/**
 * Пачка конвейером: пока LaMa чистит кадр, следующий уже скачивается, а готовый
 * загружается в S3. Сама чистка — строго по одному кадру (LaMa забирает все ядра).
 */
async function processBatch(cleaner, jobs, isStopping) {
  const finishing = []
  let sourceBlocked = false
  let s3Error = null
  let next = prepareJob(jobs[0])
  for (let index = 0; next; index++) {
    const prepared = await next
    next = index + 1 < jobs.length && !isStopping() ? prepareJob(jobs[index + 1]) : null
    const { job } = prepared
    if (prepared.error) {
      const reason = `не скачал оригинал: ${prepared.error.message}`
      if (prepared.error.retryable && Number(job.attempts || 0) < MAX_SOURCE_ATTEMPTS) {
        // Источник блокирует: остаток пачки не трогаем, всё возвращаем в очередь.
        sourceBlocked = true
        log(`  ${jobLabel(job)}: ${reason} — возвращаю в очередь`)
        await releaseJob(job, reason)
        if (next) {
          const skipped = await next
          if (skipped.dir) rmSync(skipped.dir, { recursive: true, force: true })
          next = null
        }
        for (const rest of jobs.slice(index + 1)) await releaseJob(rest, 'источник временно недоступен')
        break
      }
      await failJob(job, new Error(reason))
    } else {
      try {
        const result = await cleanJob(cleaner, prepared)
        finishing.push(finishJob(job, result)
          .catch(async (error) => {
            if (!error.s3Access) return failJob(job, error)
            s3Error = error
            log(`  ${jobLabel(job)}: ${error.message} — возвращаю в очередь`)
            await releaseJob(job, error.message)
          })
          .finally(() => rmSync(prepared.dir, { recursive: true, force: true })))
      } catch (error) {
        rmSync(prepared.dir, { recursive: true, force: true })
        await failJob(job, error)
      }
    }
    // Остановка: дочищенное догружаем, остальные задания вернутся в очередь по истечении lease.
    if (isStopping() || s3Error) break
  }
  if (next) {
    const skipped = await next
    if (skipped.dir) rmSync(skipped.dir, { recursive: true, force: true })
  }
  await Promise.all(finishing)
  if (s3Error) {
    // Незавершённые задания пачки — обратно в очередь; уже закрытые ответят lease_lost, это нормально.
    for (const rest of jobs) await releaseJob(rest, s3Error.message)
    throw new Error(`${s3Error.message}: воркер остановлен. Проверьте S3_ACCESS_KEY и S3_SECRET_KEY в .env`)
  }
  return { sourceBlocked }
}

async function main() {
  if (!bucketName) throw new Error('S3_BUCKET не задан')
  if (!existsSync(PYTHON)) throw new Error(`нет интерпретатора: ${PYTHON}`)
  if (!existsSync(MODEL)) throw new Error(`нет модели LaMa: ${MODEL} (скачайте её скриптом чистки) — либо укажите PHOTO_CLEAN_MODEL`)
  await checkS3()
  log(`воркер ${WORKER_ID} → ${ADMIN_URL}, за раз беру ${LIMIT} фото`)

  let stopping = false
  process.on('SIGINT', () => { stopping = true; log('останавливаюсь после текущего фото…') })
  const cleaner = new Cleaner()
  process.on('exit', () => cleaner.stop())

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

    const { sourceBlocked } = await processBatch(cleaner, jobs, () => stopping)
    if (stopping || hasFlag('--once')) return
    if (sourceBlocked) {
      log(`источник фото блокирует запросы — пауза ${Math.round(SOURCE_PAUSE_MS / 1000)} с, задания ждут в очереди`)
      await sleep(SOURCE_PAUSE_MS)
      if (stopping) return
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ОШИБКА:', error.message)
    process.exit(1)
  })

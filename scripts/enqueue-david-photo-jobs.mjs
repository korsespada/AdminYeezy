#!/usr/bin/env node
/**
 * Постановка фото David Studio в очередь на чистку от вотермарки.
 *
 * Запуск:
 *   node scripts/enqueue-david-photo-jobs.mjs --handle <handle> [--photos 12]
 *   node scripts/enqueue-david-photo-jobs.mjs --first 3 [--photos 12]
 *   node scripts/enqueue-david-photo-jobs.mjs --stats
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'

dotenv.config()

const SUPPLIER = 'David Studio'
const CATALOG = join('data', 'david-studio', 'catalog.json')

const argv = process.argv.slice(2)
const argValue = (flag) => {
  const index = argv.indexOf(flag)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null
}

const pool = new Pool({ connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL })

async function stats() {
  const rows = await pool.query(
    `SELECT status, clean_status, COUNT(*)::int AS count
       FROM photo_clean_jobs WHERE supplier = $1 GROUP BY status, clean_status ORDER BY status`,
    [SUPPLIER],
  )
  console.log('очередь', SUPPLIER)
  for (const row of rows.rows) {
    console.log(`  ${row.status}${row.clean_status ? `/${row.clean_status}` : ''}: ${row.count}`)
  }
  if (!rows.rowCount) console.log('  пусто')
}

async function main() {
  if (argv.includes('--stats')) {
    await stats()
    return
  }

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const handle = argValue('--handle')
  const first = Number(argValue('--first') || 0)
  const maxPhotos = Number(argValue('--photos') || 0)

  let products = catalog.products
  if (handle) products = products.filter((product) => product.handle === handle)
  else if (first > 0) products = products.slice(0, first)
  else throw new Error('укажите --handle <handle> или --first <N>')

  if (!products.length) throw new Error('товары не найдены')

  let created = 0
  let existing = 0
  for (const product of products) {
    const photos = maxPhotos > 0 ? product.images.slice(0, maxPhotos) : product.images
    for (const [index, image] of photos.entries()) {
      const result = await pool.query(
        `INSERT INTO photo_clean_jobs (id, source_key, source_url, supplier, source_product, source_position)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_key) DO NOTHING RETURNING id`,
        [randomUUID(), image.src.split('?')[0], image.src, SUPPLIER, product.handle, image.position ?? index + 1],
      )
      if (result.rowCount) created += 1
      else existing += 1
    }
    console.log(`${product.handle}: фото ${photos.length}`)
  }
  console.log(`\nтоваров ${products.length}, новых заданий ${created}, уже было ${existing}`)
  await stats()
}

main()
  .catch((error) => {
    console.error('ОШИБКА:', error.message)
    process.exitCode = 1
  })
  .finally(() => pool.end())

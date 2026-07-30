const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
})

function getArg(name, fallback = null) {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function parseCsv(text) {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = normalizedText.split('\n')[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i]
    const nextChar = normalizedText[i + 1]
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else if (char === '"' && currentField.trim().length === 0) {
      inQuotes = true
      currentField = ''
    } else if (char === delimiter) {
      currentRow.push(currentField.trim())
      currentField = ''
    } else if (char === '\n') {
      currentRow.push(currentField.trim())
      if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
      currentRow = []
      currentField = ''
    } else {
      currentField += char
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
  }

  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.toLowerCase().trim())
  return rows.slice(1).map((values) => {
    const row = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    return normalizeProduct(row)
  }).filter((product) => product.external_id || product.name)
}

function normalizePhotos(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (!value) return []
  const trimmed = String(value).trim().replace(/""/g, '"')
  if (!trimmed) return []
  try {
    return normalizePhotos(JSON.parse(trimmed))
  } catch {
    return trimmed
      .split(/[|,;]/)
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
}

function normalizeProduct(row) {
  return {
    external_id: row.external_id || row.productid || row.product_id || '',
    name: row.name || row.title || 'Без названия',
    description: row.description || row.desc || '',
    price: Number(String(row.price || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    brand: Array.isArray(row.brand) ? (row.brand[0] || '') : (row.brand || ''),
    category: row.category || '',
    subcategory: row.subcategory || '',
    gender: row.gender || '',
    photos: normalizePhotos(row.photos || row.images || row.image_urls),
    ai_processed: row.ai_processed === true || String(row.ai_processed || '').toLowerCase() === 'true',
  }
}

function taskRank(task) {
  const resultPath = task.result_path || ''
  if (resultPath.includes('task_ai_') || task.status === 'Обработано ИИ') return 3
  if (resultPath.includes('task_custom_') || task.status === 'Обработано скриптом') return 2
  if (task.status === 'Сырой CSV' || task.status === 'completed') return 1
  return 0
}

async function main() {
  const limit = Number(getArg('limit', '50'))
  const batchId = getArg('batch')
  const order = getArg('order', 'newest') === 'oldest' ? 'ASC' : 'DESC'
  const client = await pool.connect()

  try {
    const params = []
    let where = ''
    if (batchId) {
      params.push(batchId)
      where = 'WHERE b.id = $1'
    }

    const batchesRes = await client.query(`
      SELECT b.id, b.name, b.created_at
      FROM scraping_batches b
      LEFT JOIN products p ON p.batch_id = b.id
      ${where}
      GROUP BY b.id, b.name, b.created_at
      HAVING count(p.id) = 0
      ORDER BY b.created_at ${order}
      LIMIT ${Number.isFinite(limit) && limit > 0 ? limit : 50}
    `, params)

    let totalBatches = 0
    let totalRows = 0
    const skipped = []

    for (const batch of batchesRes.rows) {
      const tasksRes = await client.query(`
        SELECT id, status, result_path, created_at
        FROM scraping_tasks
        WHERE batch_id = $1
          AND result_path IS NOT NULL
          AND result_path <> ''
        ORDER BY created_at DESC
      `, [batch.id])

      const chosen = tasksRes.rows
        .filter((task) => task.result_path && fs.existsSync(task.result_path))
        .sort((a, b) => taskRank(b) - taskRank(a) || new Date(b.created_at) - new Date(a.created_at))[0]

      if (!chosen) {
        skipped.push({ batch_id: batch.id, name: batch.name, reason: 'no existing csv' })
        continue
      }

      const products = parseCsv(fs.readFileSync(chosen.result_path, 'utf8'))
      if (products.length === 0) {
        skipped.push({ batch_id: batch.id, name: batch.name, reason: 'empty csv parse', file: chosen.result_path })
        continue
      }

      await client.query('BEGIN')
      for (const product of products) {
        await client.query(`
          INSERT INTO products (external_id, name, description, price, status, brand, category, subcategory, gender, photos, ai_processed, batch_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW(),NOW())
          ON CONFLICT (batch_id, external_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            price = EXCLUDED.price,
            status = EXCLUDED.status,
            brand = EXCLUDED.brand,
            category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory,
            gender = EXCLUDED.gender,
            photos = EXCLUDED.photos,
            ai_processed = EXCLUDED.ai_processed,
            updated_at = NOW()
        `, [
          product.external_id || null,
          product.name,
          product.description,
          product.price,
          product.status,
          product.brand,
          product.category,
          product.subcategory || null,
          product.gender,
          JSON.stringify(product.photos),
          product.ai_processed,
          batch.id,
        ])
      }
      await client.query('UPDATE scraping_batches SET items_count=$1, updated_at=NOW() WHERE id=$2', [products.length, batch.id])
      await client.query('COMMIT')

      totalBatches++
      totalRows += products.length
      console.log(`${batch.id.slice(0, 8)} ${batch.name}: ${products.length} from ${path.basename(chosen.result_path)}`)
    }

    console.log(JSON.stringify({ totalBatches, totalRows, skipped }, null, 2))
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
require('dotenv').config({ quiet: true })

const connectionString = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL

if (!connectionString) {
  console.error('SCRAPING_DATABASE_URL or DATABASE_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

function getArg(name, fallback = null) {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function decodeCsvBuffer(buffer) {
  const encodings = ['utf-8', 'gbk', 'windows-1251']
  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer)
    } catch {}
  }
  return new TextDecoder('utf-8').decode(buffer)
}

function resolveExistingPath(resultPath, sourceDir) {
  const cleanPath = String(resultPath || '').replace(/"/g, '')
  if (cleanPath && fs.existsSync(cleanPath)) return cleanPath

  const fileName = cleanPath.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  if (!fileName || !sourceDir) return null

  const sourcePath = path.join(sourceDir, fileName)
  return fs.existsSync(sourcePath) ? sourcePath : null
}

async function main() {
  const sourceDir = getArg('source')
  const limitArg = Number(getArg('limit', '0'))
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : null
  const overwrite = getArg('overwrite', 'false') === 'true'
  const batchId = getArg('batch')

  const client = await pool.connect()
  try {
    const params = []
    let batchWhere = ''
    if (batchId) {
      params.push(batchId)
      batchWhere = `AND t.batch_id = $${params.length}`
    }

    const tasksRes = await client.query(`
      SELECT
        t.id,
        t.supplier_id,
        t.batch_id,
        t.status,
        t.result_path
      FROM scraping_tasks t
      LEFT JOIN scraping_files f ON f.task_id = t.id
      WHERE t.result_path IS NOT NULL
        AND t.result_path <> ''
        ${overwrite ? '' : 'AND f.id IS NULL'}
        ${batchWhere}
      ORDER BY t.id ASC
    `, params)

    let scanned = 0
    let imported = 0
    let missing = 0
    let skipped = 0
    const importedExamples = []
    const missingExamples = []

    for (const task of tasksRes.rows) {
      if (limit && scanned >= limit) break
      scanned++

      const filePath = resolveExistingPath(task.result_path, sourceDir)
      if (!filePath) {
        missing++
        if (missingExamples.length < 10) missingExamples.push({ task_id: task.id, result_path: task.result_path })
        continue
      }

      const fileName = path.basename(filePath)
      if (!fileName.toLowerCase().endsWith('.csv')) {
        skipped++
        continue
      }

      const content = decodeCsvBuffer(fs.readFileSync(filePath))
      const sizeBytes = Buffer.byteLength(content, 'utf8')

      await client.query(`
        INSERT INTO scraping_files (
          task_id,
          batch_id,
          supplier_id,
          status,
          file_name,
          result_path,
          mime_type,
          size_bytes,
          content,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        ON CONFLICT (task_id) DO UPDATE SET
          batch_id = EXCLUDED.batch_id,
          supplier_id = EXCLUDED.supplier_id,
          status = EXCLUDED.status,
          file_name = EXCLUDED.file_name,
          result_path = EXCLUDED.result_path,
          mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes,
          content = EXCLUDED.content,
          updated_at = NOW()
      `, [
        task.id,
        task.batch_id,
        task.supplier_id,
        task.status,
        fileName,
        task.result_path,
        'text/csv',
        sizeBytes,
        content,
      ])

      imported++
      if (importedExamples.length < 10) {
        importedExamples.push({ task_id: task.id, file: fileName, sizeBytes })
      }
    }

    console.log(JSON.stringify({
      sourceDir: sourceDir || null,
      overwrite,
      batchId: batchId || null,
      scanned,
      imported,
      missing,
      skipped,
      importedExamples,
      missingExamples,
    }, null, 2))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

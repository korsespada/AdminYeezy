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

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function normalizeTargetDir(value) {
  return String(value || '/app/tmp')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '') || '/app/tmp'
}

function basenameFromAnyPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
}

function shouldRewritePath(value, fromPrefix) {
  if (!value) return false
  if (!fromPrefix) return true

  const normalizedValue = String(value).replace(/\\/g, '/').toLowerCase()
  const normalizedPrefix = String(fromPrefix).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalizedValue.startsWith(normalizedPrefix)
}

async function main() {
  const targetDir = normalizeTargetDir(getArg('target', '/app/tmp'))
  const fromPrefix = getArg('from')
  const dryRun = hasFlag('dry-run')
  const checkExists = getArg('check', 'true') !== 'false'
  const limitArg = Number(getArg('limit', '0'))
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : null

  const client = await pool.connect()
  try {
    const tasksRes = await client.query(`
      SELECT id, batch_id, result_path
      FROM scraping_tasks
      WHERE result_path IS NOT NULL
        AND result_path <> ''
      ORDER BY id ASC
    `)

    let seen = 0
    let updated = 0
    let unchanged = 0
    let skipped = 0
    let missing = 0
    const examples = []
    const missingExamples = []

    for (const task of tasksRes.rows) {
      if (limit && seen >= limit) break
      seen++

      const fileName = basenameFromAnyPath(task.result_path)
      if (!fileName || !fileName.toLowerCase().endsWith('.csv') || !shouldRewritePath(task.result_path, fromPrefix)) {
        skipped++
        continue
      }

      const nextPath = path.posix.join(targetDir, fileName)
      if (task.result_path === nextPath) {
        unchanged++
        continue
      }

      if (checkExists && !fs.existsSync(nextPath)) {
        missing++
        if (missingExamples.length < 10) {
          missingExamples.push({ id: task.id, current: task.result_path, expected: nextPath })
        }
        continue
      }

      if (!dryRun) {
        await client.query(
          'UPDATE scraping_tasks SET result_path = $1, updated_at = NOW() WHERE id = $2',
          [nextPath, task.id],
        )
      }

      updated++
      if (examples.length < 10) {
        examples.push({ id: task.id, from: task.result_path, to: nextPath })
      }
    }

    console.log(JSON.stringify({
      dryRun,
      targetDir,
      fromPrefix: fromPrefix || null,
      checkExists,
      seen,
      updated,
      unchanged,
      skipped,
      missing,
      examples,
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

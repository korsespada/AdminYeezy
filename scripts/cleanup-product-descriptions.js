const DOUBLE_QUOTED_PHRASE = /""([^"\s](?:[^"\r\n]*[^"\s])?)""/g
const BLANK_LINE_GAP = /\r?\n[ \t]*\r?\n/g
const HAN_CHARACTER = /\p{Script=Han}/u
const HAN_CHARACTERS = /\p{Script=Han}+/gu
const CJK_PUNCTUATION_CHARACTER = /[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/u
const CJK_PUNCTUATION = /[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]+/gu

function decodeEscapedNewlines(value) {
  return value
    .split(String.raw`\\r\\n`).join('\n')
    .split(String.raw`\\n`).join('\n')
    .split(String.raw`\r\n`).join('\n')
    .split(String.raw`\n`).join('\n')
}

function removeChineseCharacters(value) {
  const original = String(value || '')
  if (!HAN_CHARACTER.test(original) && !CJK_PUNCTUATION_CHARACTER.test(original)) return original

  return original
    .replace(HAN_CHARACTERS, ' ')
    .replace(/[，。]/g, '')
    .replace(/～/g, '-')
    .replace(/／/g, '/')
    .replace(/＆/g, ' & ')
    .replace(CJK_PUNCTUATION, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?:\s*\1)+/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/(["'])\s*\1/g, '')
    .trim()
}

function stripUnmatchedEdgeQuotes(value) {
  let result = value
  const trimmed = result.trim()
  const quoteCount = (trimmed.match(/"/g) || []).length

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && quoteCount === 2) {
    return trimmed.slice(1, -1).trim()
  }

  if (quoteCount % 2 === 1 && trimmed.startsWith('"')) {
    result = trimmed.slice(1).trimStart()
  }

  const afterLeadingQuote = result.trim()
  const remainingQuoteCount = (afterLeadingQuote.match(/"/g) || []).length
  if (remainingQuoteCount % 2 === 1 && afterLeadingQuote.endsWith('"')) {
    result = afterLeadingQuote.slice(0, -1).trimEnd()
  }

  return result
}

function cleanDescription(value, options = {}) {
  const original = String(value || '')
  let description = original
    .replace(DOUBLE_QUOTED_PHRASE, '«$1»')
    .replace(/""[ \t]*/g, '')

  description = stripUnmatchedEdgeQuotes(description)

  const logicalDescription = decodeEscapedNewlines(description)
  const blankGapCount = (logicalDescription.match(BLANK_LINE_GAP) || []).length
  if (blankGapCount > 2) {
    description = logicalDescription.replace(BLANK_LINE_GAP, '\n')
  }

  if (options.removeChinese) {
    description = removeChineseCharacters(description)
  }

  return {
    description,
    changed: description !== original,
    hasChinese: HAN_CHARACTER.test(description),
    blankGapCount,
  }
}

async function run() {
  require('dotenv').config({ path: '.env.local', quiet: true })
  require('dotenv').config({ path: '.env', quiet: true })
  const { Pool } = require('pg')

  const apply = process.argv.includes('--apply')
  const listChinese = process.argv.includes('--list-chinese')
  const removeChinese = process.argv.includes('--remove-chinese')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  try {
    const { rows } = await pool.query(`
      SELECT id, external_id, description
      FROM products
      WHERE COALESCE(description, '') <> ''
      ORDER BY id
    `)

    const changes = []
    const chinese = []
    for (const row of rows) {
      const containedChinese = HAN_CHARACTER.test(String(row.description))
        || CJK_PUNCTUATION_CHARACTER.test(String(row.description))
      const result = cleanDescription(row.description, { removeChinese })
      if (result.changed) {
        changes.push({
          id: row.id,
          external_id: row.external_id,
          before: row.description,
          after: result.description,
        })
      }
      if (containedChinese) {
        chinese.push({ id: row.id, external_id: row.external_id })
      }
    }

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      removeChinese,
      scanned: rows.length,
      changed: changes.length,
      chinese: chinese.length,
      sampleChanges: changes.slice(0, 10),
      chineseProducts: listChinese ? chinese : undefined,
    }, null, 2))

    if (!apply || changes.length === 0) return

    const client = await pool.connect()
    const backupTable = removeChinese
      ? 'product_description_chinese_cleanup_backup_20260725'
      : 'product_description_cleanup_backup_20260725'
    try {
      await client.query('BEGIN')
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${backupTable} (
          product_id text PRIMARY KEY,
          external_id text,
          description text NOT NULL,
          backed_up_at timestamptz NOT NULL DEFAULT NOW()
        )
      `)

      for (const change of changes) {
        await client.query(`
          INSERT INTO ${backupTable}
            (product_id, external_id, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (product_id) DO NOTHING
        `, [change.id, change.external_id, change.before])

        await client.query(`
          UPDATE products
          SET description = $2, updated_at = NOW()
          WHERE id = $1
        `, [change.id, change.after])
      }

      await client.query('COMMIT')
      console.log(`Applied ${changes.length} product description updates.`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = {
  cleanDescription,
  decodeEscapedNewlines,
  removeChineseCharacters,
  stripUnmatchedEdgeQuotes,
}

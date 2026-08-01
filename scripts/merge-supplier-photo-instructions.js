require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env', override: false })

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL,
})

function mergeInstructions(mainInstructions, photoInstructions) {
  const main = String(mainInstructions || '').trim()
  const photo = String(photoInstructions || '').trim()
  if (!photo || main.includes(photo)) return main
  return [main, `Особенности фотографий:\n${photo}`].filter(Boolean).join('\n\n')
}

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const suppliers = await client.query(`
      SELECT id,ai_instructions,ai_photo_instructions
      FROM suppliers
      WHERE BTRIM(COALESCE(ai_photo_instructions,'')) <> ''
      FOR UPDATE
    `)

    for (const supplier of suppliers.rows) {
      await client.query(`
        UPDATE suppliers
        SET ai_instructions=$2,ai_photo_instructions='',updated_at=NOW()
        WHERE id=$1
      `, [
        supplier.id,
        mergeInstructions(supplier.ai_instructions, supplier.ai_photo_instructions),
      ])
    }

    await client.query('COMMIT')
    console.log(`Merged photo instructions for ${suppliers.rowCount} suppliers`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

const { Pool } = require('pg')

function railsApiUrl(pathname) {
  let base = String(process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '')
  if (!base.endsWith('/api/v1')) base += '/api/v1'
  return `${base}${pathname}`
}

async function railsToken() {
  if (process.env.RAILS_ADMIN_TOKEN) return process.env.RAILS_ADMIN_TOKEN
  const response = await fetch(railsApiUrl('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.RAILS_ADMIN_EMAIL,
      password: process.env.RAILS_ADMIN_PASSWORD,
    }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.token) throw new Error(payload.error || 'Rails login failed')
  return payload.token
}

async function registryValues() {
  const token = await railsToken()
  const response = await fetch(railsApiUrl('/admin/catalog_attribute_registry'), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Catalog registry request failed')
  return payload.values || []
}

function dictionaries(values) {
  const result = new Map()
  for (const item of values) {
    const code = String(item.attribute_code || '')
    const canonical = String(item.canonical_value || '').trim()
    if (!code || !canonical) continue
    const dictionary = result.get(code) || new Map()
    for (const candidate of [item.id, item.filter_value, item.canonical_value, ...(item.aliases || [])]) {
      const key = String(candidate || '').trim().toLowerCase()
      if (key) dictionary.set(key, canonical)
    }
    result.set(code, dictionary)
  }
  return result
}

function normalizeValue(code, value, dictionary) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/\s*,\s*/).filter(Boolean)
  const resolved = source.map((item) => dictionary.get(String(item).trim().toLowerCase()) || String(item).trim())
  if (['colors', 'materials'].includes(code) || Array.isArray(value) || resolved.length > 1) {
    return [...new Set(resolved.filter(Boolean))]
  }
  return resolved[0] || ''
}

async function main() {
  const maps = dictionaries(await registryValues())
  const pool = new Pool({ connectionString: process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL })
  const client = await pool.connect()
  let changed = 0
  try {
    const products = await client.query("SELECT id,attributes FROM products WHERE attributes IS NOT NULL AND attributes <> '{}'::jsonb")
    await client.query('BEGIN')
    for (const product of products.rows) {
      const attributes = { ...(product.attributes || {}) }
      let dirty = false
      for (const [code, value] of Object.entries(attributes)) {
        const dictionary = maps.get(code)
        if (!dictionary) continue
        const normalized = normalizeValue(code, value, dictionary)
        if (JSON.stringify(normalized) !== JSON.stringify(value)) {
          attributes[code] = normalized
          dirty = true
        }
      }
      if (!dirty) continue
      await client.query('UPDATE products SET attributes=$2::jsonb,updated_at=NOW() WHERE id=$1', [
        product.id,
        JSON.stringify(attributes),
      ])
      changed += 1
    }
    await client.query('COMMIT')
    console.log(`Normalized products: ${changed}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

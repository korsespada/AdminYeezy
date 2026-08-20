#!/usr/bin/env node

require('dotenv').config({ quiet: true })

const APPLY = process.argv.includes('--apply')
const PAGE_SIZE = 100
const STATUSES = ['active', 'hidden', 'draft', 'archived']

let apiUrl = String(process.env.RAILS_API_URL || '').replace(/\/+$/, '')
if (apiUrl && !apiUrl.endsWith('/api/v1')) apiUrl += '/api/v1'
let token = process.env.RAILS_ADMIN_TOKEN || process.env.ADMIN_RAILS_TOKEN || ''

function assertConfig() {
  if (!apiUrl) throw new Error('RAILS_API_URL is required')
  if (!token && (!process.env.RAILS_ADMIN_EMAIL || !process.env.RAILS_ADMIN_PASSWORD)) {
    throw new Error('RAILS_ADMIN_TOKEN or RAILS_ADMIN_EMAIL/RAILS_ADMIN_PASSWORD is required')
  }
}

function parseEncodedMeasurements(value) {
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value.trim())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if ((Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) || Array.isArray(parsed.tabs)) return parsed
  } catch {
    return null
  }

  return null
}

function productLabel(product) {
  return [product.id, product.seo_article || product.external_id || '', product.name || '']
    .filter(Boolean)
    .join(' | ')
}

async function login() {
  if (token) return token

  const response = await fetch(`${apiUrl}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.RAILS_ADMIN_EMAIL,
      password: process.env.RAILS_ADMIN_PASSWORD,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) {
    throw new Error(payload.message || payload.error || `Rails admin login failed with ${response.status}`)
  }
  token = payload.token
  return token
}

async function railsFetch(pathname, init = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await login()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || `Rails API failed with ${response.status}`)
  return payload
}

async function listCandidates() {
  const candidates = []
  const totals = {}

  for (const status of STATUSES) {
    let page = 1
    let pages = 1
    let total = 0

    while (page <= pages) {
      const payload = await railsFetch(`/admin/products?${new URLSearchParams({
        page: String(page),
        per_page: String(PAGE_SIZE),
        status,
      })}`)
      pages = Number(payload.meta?.pages || 1)
      for (const product of payload.products || []) {
        total++
        const attributes = product.catalog_attributes && typeof product.catalog_attributes === 'object'
          ? product.catalog_attributes
          : product.attributes && typeof product.attributes === 'object'
            ? product.attributes
            : {}
        const normalized = parseEncodedMeasurements(attributes.measurements)
        if (!normalized) continue
        candidates.push({ product, attributes, normalized, status })
      }
      page++
    }
    totals[status] = total
  }

  return { candidates, totals }
}

async function patchCandidate(candidate) {
  const catalogAttributes = { ...candidate.attributes, measurements: candidate.normalized }
  return railsFetch(`/admin/products/${candidate.product.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ product: { catalog_attributes: catalogAttributes } }),
  })
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = []
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { ok: true, value: await mapper(items[index], index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function main() {
  assertConfig()
  const before = await listCandidates()
  console.log(`Mode: ${APPLY ? 'apply' : 'dry-run'}`)
  console.log(`Products scanned: ${JSON.stringify(before.totals)}`)
  console.log(`Candidates: ${before.candidates.length}`)
  for (const candidate of before.candidates.slice(0, 25)) console.log(`candidate: ${productLabel(candidate.product)}`)
  if (before.candidates.length > 25) console.log(`...and ${before.candidates.length - 25} more`)

  if (!APPLY || before.candidates.length === 0) return

  const results = await mapWithConcurrency(before.candidates, 4, patchCandidate)
  const failed = results.flatMap((result, index) => result.ok ? [] : [{ candidate: before.candidates[index], error: result.error }])
  console.log(`Updated: ${before.candidates.length - failed.length}`)
  console.log(`Failed: ${failed.length}`)
  for (const item of failed.slice(0, 20)) console.log(`failed: ${productLabel(item.candidate.product)} -> ${item.error.message || item.error}`)
  if (failed.length > 0) process.exitCode = 1

  const after = await listCandidates()
  console.log(`Remaining encoded measurements: ${after.candidates.length}`)
  if (after.candidates.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})

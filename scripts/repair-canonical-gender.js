#!/usr/bin/env node

require('dotenv').config({ quiet: true })

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY
const PAGE_SIZE = Number(process.env.RAILS_IMPORT_CHUNK_SIZE || 200)
const STATUSES = ['active', 'hidden', 'draft']

const apiUrl = String(process.env.RAILS_API_URL || '').replace(/\/$/, '')
const email = process.env.RAILS_ADMIN_EMAIL
const password = process.env.RAILS_ADMIN_PASSWORD
let token = process.env.RAILS_ADMIN_TOKEN || ''

function usage() {
  console.log([
    'Usage:',
    '  node scripts/repair-canonical-gender.js          # dry-run',
    '  node scripts/repair-canonical-gender.js --apply  # patch Rails products',
    '',
    'Repairs products where product.gender or metadata.gender is stored as Russian/UI text',
    'or exists only in metadata, converting it to male/female/unisex.',
  ].join('\n'))
}

function assertConfig() {
  if (!apiUrl) throw new Error('RAILS_API_URL is required')
  if (!token && (!email || !password)) {
    throw new Error('RAILS_ADMIN_TOKEN or RAILS_ADMIN_EMAIL/RAILS_ADMIN_PASSWORD is required')
  }
}

function railsPath(pathname) {
  return `${apiUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

async function login() {
  if (token) return token
  const response = await fetch(railsPath('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.token) {
    throw new Error(payload.message || payload.error || `Rails admin login failed with ${response.status}`)
  }
  token = payload.token
  return token
}

async function railsFetch(pathname, init = {}) {
  const authToken = await login()
  const response = await fetch(railsPath(pathname), {
    ...init,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Rails API failed with ${response.status}`)
  }
  return payload
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toLowerCase()
  if (!gender) return ''
  if (['male', 'мужской', 'мужская', 'мужские', 'для мужчин', 'men', 'mens', "men's"].includes(gender)) return 'male'
  if (['female', 'женский', 'женская', 'женские', 'для женщин', 'women', 'womens', "women's"].includes(gender)) return 'female'
  if (['unisex', 'унисекс', 'для всех', '男女同款'].includes(gender)) return 'unisex'
  return ''
}

function shouldRepair(product) {
  const productGender = product.gender == null ? '' : String(product.gender)
  const metadataGender = product.metadata?.gender == null ? '' : String(product.metadata.gender)
  const normalized = normalizeGender(productGender) || normalizeGender(metadataGender)

  if (!normalized) return null
  const productNeedsRepair = productGender && productGender !== normalized
  const metadataNeedsRepair = metadataGender && metadataGender !== normalized
  const metadataOnlyNeedsRepair = !productGender && metadataGender

  if (productNeedsRepair || metadataNeedsRepair || metadataOnlyNeedsRepair) return normalized

  return null
}

function productLabel(product) {
  return [
    product.id,
    product.external_id || product.sku || '',
    product.name || '',
  ].filter(Boolean).join(' | ')
}

async function listProducts(status, page) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('per_page', String(PAGE_SIZE))
  params.set('status', status)
  return railsFetch(`/admin/products?${params}`)
}

async function patchGender(product, gender) {
  const metadata = product.metadata && typeof product.metadata === 'object'
    ? { ...product.metadata, gender }
    : { gender }
  return railsFetch(`/admin/products/${product.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ product: { gender, metadata } }),
  })
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage()
    return
  }

  assertConfig()

  const candidates = []
  const updated = []
  const skipped = []

  for (const status of STATUSES) {
    let page = 1
    let pages = 1

    while (page <= pages) {
      const payload = await listProducts(status, page)
      pages = Number(payload.meta?.pages || 1)

      for (const product of payload.products || []) {
        const canonicalGender = shouldRepair(product)
        if (!canonicalGender) continue

        candidates.push({ product, gender: canonicalGender })
        if (DRY_RUN) continue

        try {
          await patchGender(product, canonicalGender)
          updated.push(product.id)
        } catch (error) {
          skipped.push({ product, error: error.message || 'Unknown error' })
        }
      }

      page += 1
    }
  }

  console.log(`Mode: ${DRY_RUN ? 'dry-run' : 'apply'}`)
  console.log(`Candidates: ${candidates.length}`)
  console.log(`Updated: ${updated.length}`)
  console.log(`Failed: ${skipped.length}`)

  for (const { product, gender } of candidates.slice(0, 25)) {
    console.log(`${DRY_RUN ? 'would update' : 'candidate'}: ${productLabel(product)} -> ${gender}`)
  }
  if (candidates.length > 25) console.log(`...and ${candidates.length - 25} more`)

  for (const item of skipped.slice(0, 10)) {
    console.log(`failed: ${productLabel(item.product)} -> ${item.error}`)
  }

  if (DRY_RUN && candidates.length > 0) {
    console.log('Run with --apply to write product.gender.')
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * Синхронизация каталога поставщика David_Studio (www.david-studio.com).
 *
 * Магазин работает на Shopify, поэтому HTML парсить не нужно: товары, варианты,
 * цены и изображения отдают публичные JSON-эндпоинты.
 *
 * Использование:
 *   node scripts/sync-david-studio-catalog.mjs                 # забрать с сайта
 *   node scripts/sync-david-studio-catalog.mjs --from <file>   # из готового дампа (без сети)
 *   node scripts/sync-david-studio-catalog.mjs --out <path>    # свой путь вывода
 *
 * Результат: data/david-studio/catalog.json — его читает страница
 * /admin/chromoff/david-studio.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://www.david-studio.com'
const USER_AGENT = 'Mozilla/5.0 (compatible; AdminYeezy-catalog-sync/1.0)'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = path.join(ROOT, 'data', 'david-studio', 'catalog.json')

const argv = process.argv.slice(2)
const argValue = (flag) => {
  const index = argv.indexOf(flag)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null
}
const FROM_FILE = argValue('--from')
const OUT_FILE = path.resolve(argValue('--out') || DEFAULT_OUT)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWithRetry(url, { json = true, retries = 4 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: json ? 'application/json' : 'text/html' },
      })
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return json ? await response.json() : await response.text()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await sleep(400 * 2 ** (attempt - 1))
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : 'неизвестная ошибка'}`)
}

/** Все товары каталога: Shopify отдаёт максимум 250 на страницу. */
async function fetchProducts() {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    const data = await fetchWithRetry(`${BASE}/products.json?limit=250&page=${page}`)
    const batch = Array.isArray(data.products) ? data.products : []
    if (batch.length === 0) break
    all.push(...batch)
    process.stdout.write(`\r  товары: страница ${page}, всего ${all.length}   `)
    if (batch.length < 250) break
    await sleep(150)
  }
  process.stdout.write('\n')
  if (all.length === 0) throw new Error('Shopify вернул пустой каталог — проверьте доступность сайта')
  return all
}

/**
 * Коллекции дают категории. Карта коллекций требует обязательные ?from=&to=
 * из индекса sitemap: без них запрос отдаёт HTTP 400.
 */
async function fetchCollections() {
  const index = await fetchWithRetry(`${BASE}/sitemap.xml`, { json: false })
  const collectionsUrl =
    [...index.matchAll(/<loc>(.*?)<\/loc>/g)]
      .map((match) => match[1].replace(/&amp;/g, '&'))
      .find((url) => url.includes('sitemap_collections_1.xml')) || `${BASE}/sitemap_collections_1.xml`

  const xml = await fetchWithRetry(collectionsUrl, { json: false })
  const handles = [
    ...new Set(
      [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
        .map((match) => match[1].replace(/&amp;/g, '&').match(/\/collections\/([^/?#]+)/)?.[1])
        .filter(Boolean),
    ),
  ]

  const productToCollections = new Map()

  const loadCollection = async (handle) => {
    const data = await fetchWithRetry(`${BASE}/collections/${handle}/products.json?limit=250`, { retries: 5 })
    for (const product of data.products || []) {
      if (!productToCollections.has(product.id)) productToCollections.set(product.id, [])
      const list = productToCollections.get(product.id)
      if (!list.includes(handle)) list.push(handle)
    }
  }

  let failed = []
  let done = 0
  for (const handle of handles) {
    try {
      await loadCollection(handle)
    } catch {
      failed.push(handle)
    }
    done += 1
    process.stdout.write(`\r  коллекции: ${done}/${handles.length}   `)
    await sleep(120)
  }
  process.stdout.write('\n')

  // Упавшую коллекцию нельзя глотать: её товары уедут в «без категории».
  // Повторяем, а если не получилось — прекращаем работу, не перезаписывая файл.
  for (let round = 1; round <= 3 && failed.length > 0; round += 1) {
    const retry = failed
    failed = []
    console.log(`  повтор для ${retry.length} коллекций (попытка ${round} из 3)`)
    for (const handle of retry) {
      try {
        await loadCollection(handle)
      } catch {
        failed.push(handle)
      }
      await sleep(300)
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `не удалось загрузить коллекции (${failed.length}): ${failed.join(', ')}. ` +
      'Файл не перезаписан, прежняя выгрузка сохранена — повторите запуск.',
    )
  }

  return productToCollections
}

/** Тот же разбор HTML описания, что и в парсере: пункты списка — отдельные строки. */
function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(li|ul|ol|p|div|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const number = (value) => (value === null || value === undefined || value === '' ? null : Number(value))

function normalizeProducts(products, productToCollections) {
  return products.map((product) => {
    const collections = productToCollections.get(product.id) || []
    // Родитель («rings») короче листа («chrome-hearts-cross-rings»), поэтому
    // раздел и подраздел выбираем детерминированно по длине handle.
    const byLength = [...collections].sort((left, right) => left.length - right.length || left.localeCompare(right))
    return {
      product_id: product.id,
      handle: product.handle,
      url: `${BASE}/products/${product.handle}`,
      title: product.title,
      product_type: product.product_type || null,
      vendor: product.vendor || null,
      tags: product.tags || [],
      collections,
      category: byLength[0] ?? null,
      subcategory: byLength.length > 1 ? byLength[byLength.length - 1] : null,
      price_min: product.variants?.length ? Math.min(...product.variants.map((variant) => Number(variant.price))) : null,
      price_max: product.variants?.length ? Math.max(...product.variants.map((variant) => Number(variant.price))) : null,
      currency: 'USD',
      available: (product.variants || []).some((variant) => variant.available),
      published_at: product.published_at || null,
      updated_at: product.updated_at || null,
      images: (product.images || []).map((image) => ({ position: image.position, src: image.src })),
      variants: (product.variants || []).map((variant) => ({
        variant_id: variant.id,
        title: variant.title,
        size: variant.title === 'Default Title' ? null : variant.title,
        price: number(variant.price),
        compare_at_price: number(variant.compare_at_price),
        available: Boolean(variant.available),
      })),
      description_text: stripHtml(product.body_html),
    }
  })
}

async function syncFromSite() {
  console.log(`Источник: ${BASE}`)
  console.log('[1/2] товары')
  const products = await fetchProducts()
  console.log('[2/2] коллекции')
  const productToCollections = await fetchCollections()
  return { products, productToCollections, source: BASE }
}

/** Офлайн-режим: берём ранее сохранённый дамп парсера и пересобираем форму для админки. */
async function syncFromDump(file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'))
  const products = Array.isArray(raw) ? raw : raw.products
  if (!Array.isArray(products)) throw new Error(`В файле ${file} не найден массив товаров`)

  const alreadyNormalized = products.every((product) => Array.isArray(product.collections))
  if (alreadyNormalized) {
    return {
      products: products.map((product) => ({
        product_id: product.product_id,
        handle: product.handle,
        url: product.url || `${BASE}/products/${product.handle}`,
        title: product.title,
        product_type: product.product_type || null,
        vendor: product.vendor || null,
        tags: product.tags || [],
        collections: product.collections || [],
        category: product.category || null,
        subcategory: product.subcategory || null,
        price_min: number(product.price_min),
        price_max: number(product.price_max),
        currency: 'USD',
        available: Boolean(product.available),
        published_at: product.published_at || null,
        updated_at: product.updated_at || null,
        images: (product.images || []).map((image) => ({ position: image.position, src: image.src })),
        variants: (product.variants || []).map((variant) => ({
          variant_id: variant.variant_id,
          title: variant.title,
          size: variant.size ?? (variant.title === 'Default Title' ? null : variant.title),
          price: number(variant.price),
          compare_at_price: number(variant.compare_at_price),
          available: Boolean(variant.available),
        })),
        description_text: product.description_text || stripHtml(product.description_html),
      })),
      source: `dump:${file}`,
      currency: raw.currency || 'USD',
    }
  }

  const productToCollections = new Map()
  const rebuilt = products.map((product) => {
    const collections = []
    for (const image of product.images || []) void image
    return { ...product, collections }
  })
  return {
    products: normalizeProducts(rebuilt, productToCollections),
    source: `dump:${file}`,
  }
}

function buildSummary(products) {
  const byCategory = {}
  const byProductType = {}
  let variants = 0
  let images = 0
  for (const product of products) {
    const category = product.category || '(без категории)'
    byCategory[category] = (byCategory[category] || 0) + 1
    const productType = product.product_type || '(без типа)'
    byProductType[productType] = (byProductType[productType] || 0) + 1
    variants += product.variants.length
    images += product.images.length
  }
  return { products: products.length, variants, images, byCategory, byProductType }
}

async function main() {
  const startedAt = Date.now()
  const { products: sourceProducts, productToCollections, source } = FROM_FILE
    ? await syncFromDump(path.resolve(FROM_FILE))
    : await syncFromSite()

  const products = FROM_FILE && sourceProducts.some((product) => Array.isArray(product.collections))
    ? sourceProducts
    : normalizeProducts(sourceProducts, productToCollections)

  const catalog = {
    source,
    parsed_at: new Date().toISOString(),
    currency: 'USD',
    summary: buildSummary(products),
    products,
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 1))

  const sizeMb = (JSON.stringify(catalog).length / 1024 / 1024).toFixed(2)
  console.log(`\nГотово за ${Math.round((Date.now() - startedAt) / 1000)} с`)
  console.log(`  товаров:   ${catalog.summary.products}`)
  console.log(`  вариантов: ${catalog.summary.variants}`)
  console.log(`  изображений: ${catalog.summary.images}`)
  console.log(`  файл: ${OUT_FILE} (${sizeMb} МБ)`)
  console.log('  категории: ' + Object.entries(catalog.summary.byCategory).sort((left, right) => right[1] - left[1]).map(([name, count]) => `${name} ${count}`).join(', '))
}

main().catch((error) => {
  console.error(`\nОШИБКА: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})

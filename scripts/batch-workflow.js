const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { runSupplierJsonProcess } = require('./lib/supplier-json-process');

const SCRAPING_DB = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL;
const LEGACY_CATALOG_DB = process.env.LEGACY_CATALOG_DATABASE_URL || process.env.DATABASE_URL || process.env.SCRAPING_DATABASE_URL;

const scrapingPool = new Pool({ connectionString: SCRAPING_DB });
const legacyCatalogPool = new Pool({ connectionString: LEGACY_CATALOG_DB });
let cachedRailsAdminToken = null;

const PRODUCT_COLUMNS = [
  { name: 'external_id', key: 'external_id' },
  { name: 'name', key: 'name' },
  { name: 'description', key: 'description' },
  { name: 'h1', key: 'h1' },
  { name: 'seo_title', key: 'seo_title' },
  { name: 'seo_description', key: 'seo_description' },
  { name: 'price', key: 'price' },
  { name: 'status', key: 'status' },
  { name: 'brand', key: 'brand' },
  { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' },
  { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' },
  { name: 'ai_processed', key: 'ai_processed' },
];

const SUPPLIER_SCRIPT_BASE_COLUMNS = [
  { name: 'external_id', key: 'external_id' }, { name: 'name', key: 'name' },
  { name: 'description', key: 'description' }, { name: 'price', key: 'price' },
  { name: 'brand', key: 'brand' }, { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' }, { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' }, { name: 'status', key: 'status' },
  { name: 'h1', key: 'h1' }, { name: 'seo_title', key: 'seo_title' },
  { name: 'seo_description', key: 'seo_description' }, { name: 'ai_processed', key: 'ai_processed' },
  { name: 'variant_group_key', key: 'variant_group_key' },
];

const RAILS_IMPORT_COLUMNS = [
  { name: 'external_id', key: 'external_id' },
  { name: 'name', key: 'name' },
  { name: 'description', key: 'description' },
  { name: 'h1', key: 'h1' },
  { name: 'seo_title', key: 'seo_title' },
  { name: 'seo_description', key: 'seo_description' },
  { name: 'price', key: 'price' },
  { name: 'status', key: 'status' },
  { name: 'brand', key: 'brand' },
  { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' },
  { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' },
  { name: 'attributes', key: 'attributes' },
  { name: 'variant_group_key', key: 'variant_group_key' },
  { name: 'batch_id', key: 'batchId' },
];

const CORE_PRODUCT_FIELDS = new Set([
  'id', 'external_id', 'name', 'description', 'h1', 'seo_title', 'seo_description', 'price', 'price_source', 'status', 'brand',
  'category', 'subcategory', 'gender', 'photos', 'batch_id', 'batchid',
  'ai_processed', 'attributes', 'variant_group_key', 'ai_error', 'ai_confidence', 'source_position', 'created_at', 'updated_at',
]);

function ensureDir(dir) {
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
}

function cleanPath(value) {
  return value ? String(value).replace(/"/g, '') : '';
}

function normalizePhotos(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return normalizePhotos(JSON.parse(trimmed));
    } catch {
      return trimmed
        .split(/[|,;]/)
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeBrand(value) {
  if (Array.isArray(value)) return value.filter(Boolean)[0] ? String(value.filter(Boolean)[0]) : '';
  if (value === undefined || value === null) return '';
  return String(value);
}

function normalizeAttributes(value) {
  if (!value) return {};
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value.trim());
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([key, item]) => {
    if (!key.trim() || CORE_PRODUCT_FIELDS.has(key.toLowerCase())) return false;
    return item === null || typeof item === 'string' || typeof item === 'number' ||
      typeof item === 'boolean' || (Array.isArray(item) && item.every((entry) =>
        entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
      ));
  }));
}

function extractAttributes(row) {
  const attributes = normalizeAttributes(row.attributes);
  for (const [key, value] of Object.entries(row)) {
    if (!CORE_PRODUCT_FIELDS.has(key.trim().toLowerCase()) && value !== undefined && value !== null && value !== '') {
      attributes[key.trim()] = typeof value === 'string' ? value : value;
    }
  }
  return normalizeAttributes(attributes);
}

function normalizeProduct(row) {
  return {
    id: row.id,
    external_id: row.external_id || '',
    name: row.name || '',
    description: row.description || '',
    h1: row.h1 || '',
    seo_title: row.seo_title || '',
    seo_description: row.seo_description || '',
    price: Number(row.price || 0),
    price_source: row.price_source || 'legacy',
    status: row.status === 'inactive' ? 'inactive' : 'active',
    brand: normalizeBrand(row.brand),
    category: row.category || '',
    subcategory: row.subcategory || '',
    gender: row.gender || '',
    photos: normalizePhotos(row.photos),
    attributes: extractAttributes(row),
    batchId: row.batch_id || row.batchId,
    ai_processed: row.ai_processed === true || row.ai_processed === 'true' || row.ai_processed === 'True',
    variant_group_key: row.variant_group_key || null,
    ai_error: row.ai_error || null,
    ai_confidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
    source_position: row.source_position == null ? null : Number(row.source_position),
  };
}

function serializeProductsToCsv(products, columns = PRODUCT_COLUMNS, delimiter = ';') {
  const effectiveColumns = columns.some((column) => column.key === 'attributes') || !products.some((product) => Object.keys(normalizeAttributes(product.attributes)).length > 0)
    ? columns
    : [...columns, { name: 'attributes', key: 'attributes' }];
  const header = effectiveColumns.map((column) => column.name).join(delimiter);
  const rows = products.map((product) => effectiveColumns.map((column) => {
    let value = product[column.key];
    if ((value === undefined || value === null) && product.attributes && typeof product.attributes === 'object') value = product.attributes[column.key];
    if (value === undefined || value === null) value = '';
    if (Array.isArray(value)) value = JSON.stringify(value);
    if (column.key === 'attributes' && typeof value === 'object' && value !== null) value = JSON.stringify(normalizeAttributes(value));
    if (typeof value === 'boolean') value = value ? 'true' : 'false';
    if (typeof value === 'string') {
      value = value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
    }
    const str = String(value).replace(/"/g, '""');
    return str.includes(delimiter) || str.includes('"') ? `"${str}"` : str;
  }).join(delimiter));
  return [header, ...rows].join('\n');
}

function supplierScriptColumns(products) {
  const keys = new Set();
  for (const product of products) {
    for (const key of Object.keys(normalizeAttributes(product.attributes))) {
      if (!SUPPLIER_SCRIPT_BASE_COLUMNS.some((column) => column.key === key)) keys.add(key);
    }
  }
  return [
    ...SUPPLIER_SCRIPT_BASE_COLUMNS,
    ...[...keys].sort().map((key) => ({ name: key, key })),
    { name: 'attributes', key: 'attributes' },
  ];
}

function railsApiUrl(pathname) {
  const rawBase = process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL;
  if (!rawBase) throw new Error('RAILS_API_URL is required to publish batches to Rails');

  let base = rawBase.replace(/\/+$/, '');
  if (!base.endsWith('/api/v1')) base = `${base}/api/v1`;
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function jwtExpiresAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf-8'));
    return Number(payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

async function railsAdminToken() {
  const staticToken = process.env.RAILS_ADMIN_TOKEN || process.env.ADMIN_RAILS_TOKEN;
  if (staticToken) return staticToken;

  if (cachedRailsAdminToken && cachedRailsAdminToken.expiresAt > Date.now() + 60_000) {
    return cachedRailsAdminToken.token;
  }

  const email = process.env.RAILS_ADMIN_EMAIL;
  const password = process.env.RAILS_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('RAILS_ADMIN_EMAIL and RAILS_ADMIN_PASSWORD are required to publish batches to Rails');
  }

  const response = await fetch(railsApiUrl('/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) {
    throw new Error(payload.message || payload.error || `Rails admin login failed with ${response.status}`);
  }

  cachedRailsAdminToken = {
    token: payload.token,
    expiresAt: jwtExpiresAt(payload.token) || Date.now() + 60 * 60 * 1000,
  };
  return cachedRailsAdminToken.token;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchJsonWithRetry(url, init, label) {
  const { timeoutMs = 45_000, ...requestInit } = init || {};
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...requestInit, signal: AbortSignal.timeout(timeoutMs) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const error = new Error(payload.message || payload.error || `${label} failed with ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw lastError || new Error(`${label} failed`);
}

async function safeLookup(tableName) {
  try {
    const result = await legacyCatalogPool.query(`SELECT id::text, name FROM ${tableName}`);
    return new Map(result.rows.map((row) => [String(row.id), row.name]));
  } catch (error) {
    console.warn(`Lookup ${tableName} unavailable:`, error.message);
    return new Map();
  }
}

async function mappedCatalogLookups() {
  const result = await scrapingPool.query(`
    SELECT entity_type,legacy_id,canonical_id,name
    FROM catalog_id_mappings
    WHERE entity_type IN ('brand','category','subcategory')
  `);
  const lookups = { brands: new Map(), categories: new Map(), subcategories: new Map() };
  const mapByType = {
    brand: lookups.brands,
    category: lookups.categories,
    subcategory: lookups.subcategories,
  };
  for (const row of result.rows) {
    const target = mapByType[row.entity_type];
    const name = String(row.name || '').trim();
    if (!target || !name) continue;
    if (row.legacy_id) target.set(String(row.legacy_id), name);
    if (row.canonical_id) target.set(String(row.canonical_id), name);
  }
  return lookups;
}

async function railsCatalogLookups() {
  const [brandsPayload, categoriesPayload] = await Promise.all([
    fetchJsonWithRetry(railsApiUrl('/catalog/brands'), {}, 'Rails brands lookup'),
    fetchJsonWithRetry(railsApiUrl('/catalog/categories'), {}, 'Rails categories lookup'),
  ]);
  const lookups = { brands: new Map(), categories: new Map(), subcategories: new Map() };
  for (const brand of brandsPayload.brands || []) {
    if (brand?.id && brand?.name) lookups.brands.set(String(brand.id), String(brand.name));
  }
  const walk = (items, parentId = null) => {
    for (const item of items || []) {
      if (item?.id && item?.name) {
        (parentId ? lookups.subcategories : lookups.categories).set(String(item.id), String(item.name));
      }
      walk(item?.children || [], item?.id ? String(item.id) : parentId);
    }
  };
  walk(categoriesPayload.categories || []);
  return lookups;
}

async function loadLegacyLookupMaps() {
  const [brands, categories, subcategories, mappings, rails] = await Promise.all([
    safeLookup('brands'),
    safeLookup('categories'),
    safeLookup('subcategories'),
    mappedCatalogLookups(),
    railsCatalogLookups().catch((error) => {
      console.warn(`Rails catalog lookups unavailable: ${error.message}`);
      return { brands: new Map(), categories: new Map(), subcategories: new Map() };
    }),
  ]);
  for (const [key, value] of mappings.brands) brands.set(key, value);
  for (const [key, value] of mappings.categories) categories.set(key, value);
  for (const [key, value] of mappings.subcategories) subcategories.set(key, value);
  for (const [key, value] of rails.brands) brands.set(key, value);
  for (const [key, value] of rails.categories) categories.set(key, value);
  for (const [key, value] of rails.subcategories) subcategories.set(key, value);
  return { brands, categories, subcategories };
}

function looksLikeCatalogId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    || /^[a-z0-9_-]{15}$/i.test(value);
}

function lookupName(map, value, label = 'справочника') {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return lookupName(map, value.filter(Boolean)[0], label);
  const key = String(value).trim();
  if (!key) return '';
  const name = map.get(key);
  if (name) return name;
  if (looksLikeCatalogId(key)) {
    throw new Error(`Публикация остановлена: не найдено название ${label} для ID ${key}`);
  }
  return key;
}

function productToRailsCsvRow(product, lookups) {
  return {
    external_id: product.external_id || '',
    name: product.name || '',
    description: product.description || '',
    h1: product.h1 || '',
    seo_title: product.seo_title || '',
    seo_description: product.seo_description || '',
    price: product.price || 0,
    status: product.status === 'inactive' ? 'hidden' : 'active',
    brand: lookupName(lookups.brands, product.brand, 'бренда'),
    category: lookupName(lookups.categories, product.category, 'категории'),
    subcategory: lookupName(lookups.subcategories, product.subcategory, 'подкатегории'),
    gender: product.gender || '',
    photos: normalizePhotos(product.photos).join('|'),
    attributes: normalizeAttributes(product.attributes),
    variant_group_key: product.variant_group_key || '',
    batch_id: product.batchId || product.batch_id || '',
  };
}

function catalogLookupKey(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function catalogCandidates(value, type, mappings) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const direct = mappings.filter((mapping) => mapping.entity_type === type &&
    (String(mapping.legacy_id) === raw || String(mapping.canonical_id) === raw));
  if (direct.length) return direct;
  const name = catalogLookupKey(raw);
  return mappings.filter((mapping) => mapping.entity_type === type && catalogLookupKey(mapping.name) === name);
}

function resolveCatalogMapping(value, type, mappings, parentId) {
  const candidates = catalogCandidates(value, type, mappings);
  if (candidates.length === 1) return candidates[0];
  if (type === 'subcategory' && parentId) {
    const underParent = candidates.filter((mapping) => String(mapping.canonical_parent_id || '') === parentId);
    if (underParent.length === 1) return underParent[0];
  }
  return null;
}

function unresolvedCatalogValue(value) {
  const raw = String(value || '').trim();
  if (/^[a-z0-9]{15}$/i.test(raw)) return '';
  if (['unknown', 'unknown brand', 'неизвестно'].includes(catalogLookupKey(raw))) return '';
  return raw;
}

function normalizeCatalogGender(value) {
  const normalized = catalogLookupKey(value);
  if (!normalized) return '';
  if (['female', 'woman', 'women', 'женский', 'для женщин'].includes(normalized)) return 'female';
  if (['male', 'man', 'men', 'мужской', 'для мужчин'].includes(normalized)) return 'male';
  if (['unisex', 'унисекс'].includes(normalized)) return 'unisex';
  return String(value).trim();
}

function normalizeProductCatalogReferences(product, mappings) {
  const brand = resolveCatalogMapping(product.brand, 'brand', mappings);
  const category = resolveCatalogMapping(product.category, 'category', mappings);
  const canonicalCategory = category?.canonical_id || String(product.category || '');
  const subcategory = resolveCatalogMapping(product.subcategory, 'subcategory', mappings, canonicalCategory);
  return {
    ...product,
    brand: brand?.canonical_id || unresolvedCatalogValue(product.brand),
    category: subcategory?.canonical_parent_id || category?.canonical_id || unresolvedCatalogValue(product.category),
    subcategory: subcategory?.canonical_id || unresolvedCatalogValue(product.subcategory),
    gender: normalizeCatalogGender(product.gender),
  };
}

async function postRailsImportBatch({ name, products, supplierId, supplierName, supplierAvatar, publishedAt }) {
  return fetchJsonWithRetry(railsApiUrl('/admin/import_batches'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await railsAdminToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'csv',
      name,
      supplier_name: supplierName || null,
      supplier_avatar: supplierAvatar || null,
      source_supplier_id: supplierId || null,
      published_at: publishedAt || null,
      wait: true,
      csv_text: serializeProductsToCsv(products, RAILS_IMPORT_COLUMNS, ','),
    }),
    timeoutMs: 120_000,
  }, 'Rails import');
}

function parseCsvText(text) {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = normalizedText.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < normalizedText.length; i += 1) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else if (char === '"' && currentField.trim().length === 0) {
      inQuotes = true;
      currentField = '';
    } else if (char === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.toLowerCase().trim());
  return rows.slice(1).map((values) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return normalizeProduct(row);
  }).filter((product) => product.external_id || product.name);
}

function parseDelimitedLine(line, delimiter = ';') {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

async function getSupplier(supplierId) {
  const res = await scrapingPool.query('SELECT * FROM suppliers WHERE id=$1', [supplierId]);
  return res.rows[0] || null;
}

function parseCsvObjects(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = normalized.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.trim().length === 0) {
      quoted = true;
      field = '';
    } else if (char === delimiter) {
      row.push(field.trim()); field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.toLowerCase().trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

async function listFavoriteSuppliers() {
  try {
    const res = await scrapingPool.query(
      'SELECT id, name, avatar_url FROM suppliers WHERE COALESCE(is_favorite, FALSE) = TRUE ORDER BY name ASC',
    );
    return res.rows;
  } catch (error) {
    if (String(error.message || '').includes('is_favorite')) return [];
    throw error;
  }
}

async function listAllSuppliers() {
  const res = await scrapingPool.query('SELECT id, name, avatar_url FROM suppliers ORDER BY name ASC');
  return res.rows;
}

async function getBatch(batchId) {
  const res = await scrapingPool.query(`
    SELECT b.*, s.name AS supplier_name, s.avatar_url AS supplier_avatar
    FROM scraping_batches b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE b.id=$1
  `, [batchId]);
  return res.rows[0] || null;
}

async function getLatestBatches(limit = 10) {
  const res = await scrapingPool.query(`
    SELECT b.*, s.name AS supplier_name, s.avatar_url AS supplier_avatar
    FROM scraping_batches b
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE COALESCE(b.stage, '') <> 'ADMIN_DELETED'
    ORDER BY b.created_at DESC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

async function getBatchProducts(batchId, limit, offset = 0) {
  const params = [batchId];
  let paging = '';
  if (Number.isFinite(limit)) {
    params.push(limit, offset);
    paging = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  const res = await scrapingPool.query(`
    SELECT id, external_id, name, description, h1, seo_title, seo_description, price, price_source, status, brand, category, subcategory, gender, photos, attributes, batch_id, ai_processed, variant_group_key, ai_error, ai_confidence, source_position, created_at, updated_at
    FROM products
    WHERE batch_id=$1
    ORDER BY source_position ASC NULLS LAST, id ASC
    ${paging}
  `, params);

  return res.rows.map(normalizeProduct);
}

async function saveBatchProducts(batchId, products, options = {}) {
  const client = await scrapingPool.connect();
  try {
    await client.query('BEGIN');
    const mappingResult = await client.query(`
      SELECT entity_type, legacy_id, canonical_id, name, canonical_parent_id
      FROM catalog_id_mappings
    `);
    const normalizedProducts = products.map((product, position) => normalizeProductCatalogReferences({
      ...product,
      source_position: product.source_position ?? position,
    }, mappingResult.rows));
    const keptIds = [];

    for (const product of normalizedProducts) {
      const normalized = normalizeProduct({ ...product, batch_id: batchId });
      const numericId = normalized.id !== undefined && normalized.id !== null && String(normalized.id).match(/^\d+$/)
        ? Number(normalized.id)
        : null;

      if (numericId) {
        const updateRes = await client.query(`
          UPDATE products
          SET external_id=$1,name=$2,description=$3,h1=$4,seo_title=$5,seo_description=$6,
              price=$7,price_source=$8,status=$9,brand=$10,category=$11,subcategory=$12,gender=$13,
              photos=$14::jsonb,attributes=$15::jsonb,ai_processed=$16,batch_id=$17,
              variant_group_key=$18,ai_error=$19,ai_confidence=$20,source_position=$21,updated_at=NOW()
          WHERE id=$22 AND batch_id=$17
          RETURNING id
        `, [
          normalized.external_id,
          normalized.name,
          normalized.description,
          normalized.h1,
          normalized.seo_title,
          normalized.seo_description,
          normalized.price,
          normalized.price_source,
          normalized.status,
          normalized.brand,
          normalized.category,
          normalized.subcategory || null,
          normalized.gender,
          JSON.stringify(normalized.photos || []),
          JSON.stringify(normalized.attributes || {}),
          normalized.ai_processed,
          batchId,
          normalized.variant_group_key,
          normalized.ai_error,
          normalized.ai_confidence,
          normalized.source_position,
          numericId,
        ]);
        if (updateRes.rowCount > 0) {
          keptIds.push(Number(updateRes.rows[0].id));
          continue;
        }
      }

      const insertRes = await client.query(`
        INSERT INTO products(external_id,name,description,h1,seo_title,seo_description,price,price_source,status,brand,category,subcategory,gender,photos,attributes,ai_processed,batch_id,variant_group_key,ai_error,ai_confidence,source_position,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,NOW(),NOW())
        ON CONFLICT (batch_id, external_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          h1 = EXCLUDED.h1,
          seo_title = EXCLUDED.seo_title,
          seo_description = EXCLUDED.seo_description,
          price = EXCLUDED.price,
          price_source = EXCLUDED.price_source,
          status = EXCLUDED.status,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          subcategory = EXCLUDED.subcategory,
          gender = EXCLUDED.gender,
          photos = EXCLUDED.photos,
          attributes = EXCLUDED.attributes,
          ai_processed = EXCLUDED.ai_processed,
          variant_group_key = EXCLUDED.variant_group_key,
          ai_error = EXCLUDED.ai_error,
          ai_confidence = EXCLUDED.ai_confidence,
          source_position = EXCLUDED.source_position,
          updated_at = NOW()
        RETURNING id
      `, [
        normalized.external_id || null,
        normalized.name,
        normalized.description,
        normalized.h1,
        normalized.seo_title,
        normalized.seo_description,
        normalized.price,
        normalized.price_source,
        normalized.status,
        normalized.brand,
        normalized.category,
        normalized.subcategory || null,
        normalized.gender,
        JSON.stringify(normalized.photos || []),
        JSON.stringify(normalized.attributes || {}),
        normalized.ai_processed,
        batchId,
        normalized.variant_group_key,
        normalized.ai_error,
        normalized.ai_confidence,
        normalized.source_position,
      ]);
      if (insertRes.rows[0]?.id) keptIds.push(Number(insertRes.rows[0].id));
    }

    if (keptIds.length > 0) {
      await client.query('DELETE FROM products WHERE batch_id=$1 AND NOT (id = ANY($2::int[]))', [batchId, keptIds]);
    } else {
      await client.query('DELETE FROM products WHERE batch_id=$1', [batchId]);
    }

    let taskId = null;
    if (options.finalizeStage) {
      await client.query('UPDATE scraping_batches SET items_count=$1,stage=$3,updated_at=NOW() WHERE id=$2', [normalizedProducts.length, batchId, options.finalizeStage]);
      if (options.snapshotLabel) {
        await client.query(`
          INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
          SELECT $1,$2,$3,$4,payload,'{}'::jsonb
          FROM (
            SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb) AS payload
            FROM products p WHERE p.batch_id=$2
          ) current
          WHERE NOT EXISTS (
            SELECT 1 FROM batch_snapshots s
            WHERE s.batch_id=$2 AND s.stage=$3 AND s.label=$4 AND s.products=current.payload
          )
        `, [crypto.randomUUID(), batchId, options.finalizeStage, options.snapshotLabel]);
      }
      if (options.supplierId && options.taskStatus) {
        const task = await client.query(`
          INSERT INTO scraping_tasks(supplier_id,batch_id,status,result_path,items_count,updated_at)
          VALUES($1,$2,$3,$4,$5,NOW()) RETURNING id
        `, [options.supplierId, batchId, options.taskStatus, options.resultPath || null, normalizedProducts.length]);
        taskId = task.rows[0]?.id || null;
      }
    } else {
      await client.query('UPDATE scraping_batches SET items_count=$1,updated_at=NOW() WHERE id=$2', [normalizedProducts.length, batchId]);
    }
    await client.query('COMMIT');
    return { count: normalizedProducts.length, taskId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordBatchSnapshot(batchId, stage, label) {
  const products = await getBatchProducts(batchId);
  const serialized = JSON.stringify(products);
  const duplicate = await scrapingPool.query(`
    SELECT id FROM batch_snapshots WHERE batch_id=$1 AND stage=$2 AND label=$3 AND products=$4::jsonb
    ORDER BY created_at DESC LIMIT 1
  `, [batchId, stage, label, serialized]);
  if (duplicate.rows[0]) return duplicate.rows[0].id;
  const id = crypto.randomUUID();
  await scrapingPool.query(`
    INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
    VALUES($1,$2,$3,$4,$5::jsonb,'{}'::jsonb)
  `, [id, batchId, stage, label, serialized]);
  if (!['Сырой товар','Обработан скриптом'].includes(label)) {
    await scrapingPool.query(`DELETE FROM batch_snapshots s USING (
      SELECT id,row_number FROM (
        SELECT id,label,ROW_NUMBER() OVER (
          PARTITION BY CASE
            WHEN label LIKE 'До AI · %' THEN 'before_ai'
            WHEN label LIKE 'Обработано ИИ%' THEN 'ai_done'
            WHEN label LIKE 'Частично обработано ИИ%' OR label LIKE 'AI-тест%' THEN 'ai_partial'
            ELSE label
          END ORDER BY created_at DESC
        ) AS row_number
        FROM batch_snapshots WHERE batch_id=$1
          AND label NOT IN ('Сырой товар','Обработан скриптом')
      ) ranked WHERE row_number>10
    ) old WHERE s.id=old.id`, [batchId]);
  }
  return id;
}

async function importScrapedFileToBatch({ supplier, taskId, outputPath, itemsCount }) {
  const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
  const items = JSON.parse(fileContent);
  if (items.length === 0) return null;

  const batchId = crypto.randomUUID();
  const batchName = `${supplier.name} - ${new Date().toLocaleString('ru-RU')}`;
  const products = items.map((item, sourcePosition) => {
    const photos = normalizePhotos(item.photos);
    return normalizeProduct({
      ...item,
      external_id: item.external_id,
      name: item.name || 'Без названия',
      description: item.description || '',
      price: parseFloat(item.price) || supplier.default_price || 0,
      status: 'inactive',
      brand: item.brand || supplier.default_brand || '',
      category: item.category || supplier.default_category || '',
      subcategory: item.subcategory || supplier.default_subcategory || null,
      gender: item.gender || supplier.default_gender || '',
      photos,
      source_position: item.source_position ?? sourcePosition,
      batch_id: batchId,
    });
  });
  if (products.some((product) => !String(product.external_id || '').trim())) {
    throw new Error('Один или несколько товаров не имеют external_id');
  }
  const client = await scrapingPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO scraping_batches (id, name, supplier_id, items_count, stage) VALUES ($1, $2, $3, $4, $5)',
      [batchId, batchName, supplier.id, products.length || itemsCount, 'SCRAPED'],
    );
    for (let position = 0; position < products.length; position += 1) {
      const normalized = normalizeProduct({ ...products[position], batch_id: batchId, source_position: products[position].source_position ?? position });
      await client.query(`
        INSERT INTO products(external_id,name,description,h1,seo_title,seo_description,price,price_source,status,brand,category,subcategory,gender,photos,attributes,ai_processed,batch_id,variant_group_key,ai_error,ai_confidence,source_position,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,NOW(),NOW())
      `, [normalized.external_id,normalized.name,normalized.description,normalized.h1,normalized.seo_title,normalized.seo_description,
        normalized.price,normalized.price_source || 'default',normalized.status,normalized.brand,normalized.category,normalized.subcategory,
        normalized.gender,JSON.stringify(normalized.photos || []),JSON.stringify(normalized.attributes || {}),false,batchId,
        normalized.variant_group_key,normalized.ai_error,normalized.ai_confidence,normalized.source_position]);
    }
    await client.query(`
      INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
      SELECT $1,$2,'SCRAPED','Сырой товар',COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb),'{}'::jsonb
      FROM products p WHERE p.batch_id=$2
    `, [crypto.randomUUID(), batchId]);
    const linkedTask = await client.query(`UPDATE scraping_tasks SET batch_id=$1,status='Сырой товар',result_path=$2,error_message=NULL,items_count=$3,updated_at=NOW() WHERE id=$4`,
      [batchId, `db://batch/${batchId}/raw`, products.length, taskId]);
    if (linkedTask.rowCount !== 1) throw new Error('Задача выгрузки была удалена до завершения импорта');
    await client.query('COMMIT');
    return batchId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function startScraping(supplierId, endDate, overrideTag, overrideGroup, onComplete) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Поставщик не найден');
  const parserSupplier = supplier;

  await scrapingPool.query(`
    UPDATE scraping_tasks SET status='failed',error_message='Остановлено: нет обновлений более 12 часов',updated_at=NOW()
    WHERE supplier_id=$1 AND status='running' AND updated_at<NOW()-INTERVAL '12 hours'
  `, [supplierId]);
  const taskRes = await scrapingPool.query(
    `INSERT INTO scraping_tasks (supplier_id, status, end_date)
     VALUES ($1, 'running', $2)
     ON CONFLICT (supplier_id) WHERE status='running' DO NOTHING
     RETURNING id`,
    [supplierId, endDate || null],
  );
  if (!taskRes.rows[0]) throw new Error('Для этого поставщика выгрузка уже запущена');
  const taskId = taskRes.rows[0].id;

  const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `task_${taskId}.json`);
  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParser.py');
  const cookie = supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || '';
  const args = [
    scriptPath,
    '--album_id', supplier.album_id,
    '--cookie', cookie,
    '--output', outputPath,
    '--format', 'json',
  ];
  args.push('--parse_mode', supplier.szwego_parse_mode === 'all' ? 'all' : 'images');
  if (endDate) args.push('--end_date', endDate);

  const finalGroup = overrideGroup || supplier.group_id;
  const finalTag = overrideTag || supplier.tag_id;
  if (finalGroup) args.push('--group_id', finalGroup);
  if (finalTag) args.push('--tag_id', finalTag);
  if (parserSupplier.min_photos) args.push('--min_photos', String(parserSupplier.min_photos));
  if (parserSupplier.min_desc_len) args.push('--min_desc', String(parserSupplier.min_desc_len));
  if (parserSupplier.default_category) args.push('--category', parserSupplier.default_category);
  if (parserSupplier.default_subcategory) args.push('--subcategory', parserSupplier.default_subcategory);
  if (parserSupplier.default_brand) args.push('--brand', parserSupplier.default_brand);
  if (parserSupplier.default_gender) args.push('--gender', parserSupplier.default_gender);
  if (parserSupplier.default_price) args.push('--default_price', String(parserSupplier.default_price));
  if (parserSupplier.parse_tags_enabled) args.push('--parse_tags');

  const pythonProcess = spawn(/*turbopackIgnore: true*/ process.env.PYTHON_PATH || 'python', args);
  let stderr = '';
  let stdoutBuffer = '';
  let lastProgress = 0;

  pythonProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[Scraper ${taskId}] ${text}`);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const match = line.match(/^PROGRESS:(\d+)$/);
      if (!match) continue;
      const count = Number(match[1]);
      if (!Number.isFinite(count) || count < lastProgress) continue;
      lastProgress = count;
      scrapingPool.query(
        "UPDATE scraping_tasks SET items_count=$1,updated_at=NOW() WHERE id=$2 AND status='running'",
        [count, taskId],
      ).catch((error) => console.error(`[Scraper ${taskId}] Progress update failed`, error));
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    stderr += data.toString();
    console.error(`[Scraper ${taskId}] ${data}`);
  });

  pythonProcess.on('error', async (error) => {
    await scrapingPool.query(
      `UPDATE scraping_tasks SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
      [`Failed to start python: ${error.message}`, taskId],
    );
  });

  pythonProcess.on('close', async (code) => {
    let status = code === 0 ? 'Сырой товар' : 'failed';
    let errorMsg = code === 0 ? null : (stderr || `Exit code ${code}`);
    let itemsCount = 0;
    let batchId = null;

    try {
      if (code === 0 && !fs.existsSync(/*turbopackIgnore: true*/ outputPath)) throw new Error('Парсер не создал JSON-файл');
      if (code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
        const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
        const parsedProducts = JSON.parse(fileContent);
        itemsCount = Array.isArray(parsedProducts) ? parsedProducts.length : 0;
      }

      if (code !== 0) {
        await scrapingPool.query(
          `UPDATE scraping_tasks SET status='failed', result_path=NULL, error_message=$1, items_count=$2, updated_at=NOW() WHERE id=$3`,
          [errorMsg, itemsCount, taskId],
        );
      }

      if (code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
        batchId = await importScrapedFileToBatch({ supplier: parserSupplier, taskId, outputPath, itemsCount });
        if (batchId && supplier.post_process_enabled && supplier.post_process_script) {
          try {
            await runBatchPostProcessScript(batchId);
          } catch (postProcessError) {
            console.error(`[Scraper ${taskId}] Auto post-process failed:`, postProcessError);
          }
        }
      }
      if (batchId) {
        await scrapingPool.query(
          'UPDATE scraping_tasks SET result_path=$1 WHERE id=$2',
          [`db://batch/${batchId}/raw`, taskId],
        );
      }
      try {
        if (fs.existsSync(/*turbopackIgnore: true*/ outputPath)) fs.unlinkSync(/*turbopackIgnore: true*/ outputPath);
      } catch {}
    } catch (error) {
      status = 'failed';
      errorMsg = error.message;
      console.error(`[Scraper ${taskId}] import failed:`, error);
      await scrapingPool.query(
        `UPDATE scraping_tasks SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
        [error.message, taskId],
      );
    }

    if (onComplete) {
      onComplete({ code, status, taskId, batchId, supplier, outputPath, itemsCount, error: errorMsg }).catch(console.error);
    }
  });

  return { taskId, supplierName: supplier.name };
}

async function processBatchWithAi(batchId) {
  const operationOwnerId = crypto.randomUUID();
  const lock = await scrapingPool.query(`
    INSERT INTO batch_operation_locks(batch_id,operation,owner_id) VALUES($1,'ai',$2)
    ON CONFLICT(batch_id) DO NOTHING RETURNING owner_id
  `, [batchId, operationOwnerId]);
  if (!lock.rows[0]) throw new Error('Выгрузка уже обрабатывается другим процессом');
  try {
  const batch = await getBatch(batchId);
  if (!batch?.supplier_id) throw new Error('У партии не найден поставщик');

  let products = await getBatchProducts(batchId);
  if (products.length === 0) throw new Error('В партии нет товаров');

  const unprocessed = products.filter((product) => !product.ai_processed);
  if (unprocessed.length === 0) {
    await scrapingPool.query("UPDATE scraping_batches SET stage='AI_PROCESSED', updated_at=NOW() WHERE id=$1", [batchId]);
    return { processed: 0, total: products.length, path: null };
  }

  const scratchDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scratch');
  ensureDir(scratchDir);
  const tempIn = path.join(/*turbopackIgnore: true*/ scratchDir, `ai_in_${Date.now()}.json`);
  fs.writeFileSync(/*turbopackIgnore: true*/ tempIn, JSON.stringify(unprocessed), 'utf-8');

  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'universal_ai_process.py');
  const pythonCmd = process.env.PYTHON_PATH || 'python';

  const result = await new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ pythonCmd, [scriptPath, String(batch.supplier_id), tempIn], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `AI process exited with ${code}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Не удалось распарсить ответ ИИ'));
      }
    });
  }).finally(() => {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ tempIn);
    } catch {}
  });

  const byExternalId = new Map(products.map((product, index) => [String(product.external_id), index]));
  for (const updatedProduct of result) {
    const index = byExternalId.get(String(updatedProduct.external_id));
    if (index !== undefined) {
      products[index] = { ...products[index], ...updatedProduct, ai_processed: true };
    }
  }

  const outputPath = `db://batch/${batchId}/ai`;
  await saveBatchProducts(batchId, products, {
    finalizeStage: 'AI_PROCESSED',
    snapshotLabel: 'Обработано ИИ',
    supplierId: batch.supplier_id,
    taskStatus: 'Обработано ИИ',
    resultPath: outputPath,
  });

  return { processed: unprocessed.length, total: products.length, path: outputPath };
  } finally {
    await scrapingPool.query('DELETE FROM batch_operation_locks WHERE batch_id=$1 AND owner_id=$2', [batchId, operationOwnerId]).catch(() => undefined);
  }
}

async function runBatchPostProcessScript(batchId, sourceInputPath = null) {
  const operationOwnerId = crypto.randomUUID();
  const lock = await scrapingPool.query(`
    INSERT INTO batch_operation_locks(batch_id,operation,owner_id) VALUES($1,'script',$2)
    ON CONFLICT(batch_id) DO NOTHING RETURNING owner_id
  `, [batchId, operationOwnerId]);
  if (!lock.rows[0]) throw new Error('Выгрузка уже обрабатывается другим процессом');
  try {
  const batch = await getBatch(batchId);
  if (!batch?.supplier_id) throw new Error('У партии не найден поставщик');
  const supplier = await getSupplier(batch.supplier_id);
  if (!supplier?.post_process_script) throw new Error('Для поставщика не назначен скрипт постобработки');
  supplier.post_process_script = String(supplier.post_process_script).trim();

  const products = await getBatchProducts(batchId);
  if (products.length === 0) throw new Error('В партии нет товаров');
  const snapshotResult = await scrapingPool.query(`
    SELECT products
    FROM batch_snapshots
    WHERE batch_id=$1 AND stage='SCRAPED'
    ORDER BY created_at ASC
    LIMIT 1
  `, [batchId]);
  const sourceProducts = Array.isArray(snapshotResult.rows[0]?.products)
    ? snapshotResult.rows[0].products
    : products;
  const processedProducts = await runSupplierJsonProcess(supplier.post_process_script, sourceProducts);
  if (processedProducts.length === 0) throw new Error('Скрипт вернул пустой массив товаров');

  const originalByExternalId = new Map(sourceProducts.map((product, position) => [
    String(product.external_id),
    { ...product, source_position: product.source_position ?? position },
  ]));
  for (let position = 0; position < processedProducts.length; position++) {
    const processedProduct = processedProducts[position];
    const original = originalByExternalId.get(String(processedProduct.external_id));
    if (Object.keys(processedProduct.attributes || {}).length === 0) {
      if (original?.attributes) processedProduct.attributes = original.attributes;
    }
    processedProduct.source_position = original?.source_position ?? position;
    processedProduct.price_source = original && Number(processedProduct.price) !== Number(original.price)
      ? 'script'
      : (original?.price_source || 'default');
  }

  await saveBatchProducts(batchId, processedProducts, {
    finalizeStage: 'SCRIPT_PROCESSED',
    snapshotLabel: 'Обработан скриптом',
    supplierId: batch.supplier_id,
    taskStatus: 'Обработано скриптом',
    resultPath: `db://batch/${batchId}/script`,
  });

    return { processed: processedProducts.length, path: `db://batch/${batchId}/script` };
  } finally {
    await scrapingPool.query('DELETE FROM batch_operation_locks WHERE batch_id=$1 AND owner_id=$2', [batchId, operationOwnerId]).catch(() => undefined);
  }
}

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
});

function getS3PublicUrl(key) {
  const endpoint = process.env.S3_ENDPOINT || '';
  const bucketName = process.env.S3_BUCKET || '';
  const publicDomain = process.env.S3_PUBLIC_DOMAIN;
  if (publicDomain) return `${publicDomain.replace(/\/+$/, '')}/${key}`;
  if (endpoint.includes('selcloud.ru') || endpoint.includes('beget.cloud')) {
    const url = new URL(endpoint);
    return `https://${bucketName}.${url.hostname}/${key}`;
  }
  if (endpoint.includes('beget.app')) return `${endpoint.replace(/\/+$/, '')}/${key}`;
  return `${endpoint.replace(/\/+$/, '')}/${bucketName}/${key}`;
}

function ownedS3Hosts() {
  const hosts = new Set();
  for (const value of [process.env.S3_PUBLIC_DOMAIN, process.env.S3_ENDPOINT]) {
    try {
      if (value) hosts.add(new URL(value).hostname.toLowerCase());
    } catch {}
  }
  try {
    hosts.add(new URL(getS3PublicUrl('__host_check__')).hostname.toLowerCase());
  } catch {}
  return hosts;
}

function isAlreadyHosted(url) {
  try {
    const parsed = new URL(String(url || ''));
    return ['http:', 'https:'].includes(parsed.protocol) && ownedS3Hosts().has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function ownedS3Key(url) {
  if (!isAlreadyHosted(url)) return null;
  try {
    let key = decodeURIComponent(new URL(String(url)).pathname).replace(/^\/+/, '');
    const bucketPrefix = `${process.env.S3_BUCKET || ''}/`;
    if (bucketPrefix !== '/' && key.startsWith(bucketPrefix)) key = key.slice(bucketPrefix.length);
    return key || null;
  } catch {
    return null;
  }
}

async function uploadPhotoIfNeeded(url, key) {
  if (!url) throw new Error('пустая ссылка на фото');
  // Ссылка уже ведет на наш S3: не скачиваем ее и не делаем HEAD
  // при каждой повторной публикации.
  if (isAlreadyHosted(url)) return url;
  if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET не настроен');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await uploadPhotoAttempt(url, key);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`не удалось перенести фото в S3 после 3 попыток: ${lastError?.message || 'неизвестная ошибка'}`);
}

async function uploadPhotoAttempt(url, key) {
  if (isAlreadyHosted(url)) {
    const existingKey = ownedS3Key(url);
    if (!existingKey) throw new Error(`не удалось определить S3 key для ${url}`);
    const storedUrl = await findStoredS3Photo(existingKey);
    if (!storedUrl) throw new Error(`файл не найден в S3: ${existingKey}`);
    return storedUrl;
  }
  try {
    const storedUrl = await findStoredS3Photo(key);
    if (storedUrl) return storedUrl;

    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('разрешены только HTTP(S) ссылки');
    const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`источник вернул HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 30 * 1024 * 1024) throw new Error('файл больше 30 МБ');
    const source = Buffer.from(await response.arrayBuffer());
    if (!source.length) throw new Error('источник вернул пустой файл');
    if (source.length > 30 * 1024 * 1024) throw new Error('файл больше 30 МБ');
    const buffer = await sharp(source).rotate().jpeg({ quality: 90 }).toBuffer();
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));
    await s3Client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const hostedUrl = getS3PublicUrl(key);
    if (!isAlreadyHosted(hostedUrl)) throw new Error('полученная ссылка не относится к настроенному S3');
    return hostedUrl;
  } catch (error) {
    throw new Error(`не удалось перенести ${url} в S3: ${error.message}`);
  }
}

async function findStoredS3Photo(key) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const storedUrl = getS3PublicUrl(key);
    if (!isAlreadyHosted(storedUrl)) throw new Error('полученная ссылка не относится к настроенному S3');
    return storedUrl;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode || error?.statusCode;
    const code = error?.name || error?.Code || error?.code;
    if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') return null;
    throw error;
  }
}

async function cleanupUnusedBatchPhotos(batchId, products) {
  const prefix = `batches/${batchId}/`;
  const keep = new Set(products.flatMap((product) => normalizePhotos(product.photos).map(ownedS3Key).filter(Boolean)));
  let continuationToken;
  do {
    const listed = await s3Client.send(new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const stale = (listed.Contents || []).map((item) => item.Key).filter((key) => key && !keep.has(key));
    if (stale.length) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET,
        Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true },
      }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function existingRailsProducts(externalIds, options = {}) {
  const ids = [...new Set(externalIds.map((value) => String(value || '').trim()).filter(Boolean))];
  const existing = new Map();
  if (!ids.length) return existing;
  const token = await railsAdminToken();
  const batches = chunkArray(ids, 50);
  let cursor = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(4, batches.length) }, async () => {
    while (cursor < batches.length) {
      const externalIdBatch = batches[cursor++];
      try {
        const params = new URLSearchParams({
          page: '1',
          per_page: String(externalIdBatch.length),
          external_ids: externalIdBatch.join(','),
        });
        const payload = await fetchJsonWithRetry(railsApiUrl(`/admin/products?${params}`), {
          headers: { Authorization: `Bearer ${token}` },
        }, 'Rails external_id check');
        const requestedIds = new Set(externalIdBatch);
        for (let product of payload.products || []) {
          const externalId = String(product?.external_id || '').trim();
          if (!externalId || !requestedIds.has(externalId)) continue;
          if (product && options.includeDetails && product.id && existingRailsPhotoMap(product).size === 0) {
            const detail = await fetchJsonWithRetry(
              railsApiUrl(`/admin/products/${encodeURIComponent(product.id)}`),
              { headers: { Authorization: `Bearer ${token}` } },
              'Rails product media',
            );
            product = detail.product || detail || product;
          }
          if (product) existing.set(externalId, product);
        }
      } finally {
        completed += externalIdBatch.length;
        if (options.onProgress) await options.onProgress({ current: completed, total: ids.length });
      }
    }
  });
  await Promise.all(workers);
  return existing;
}

function existingRailsPhotoMap(product) {
  const urls = new Map();
  const media = [
    ...(Array.isArray(product?.media) ? product.media : []),
    ...(Array.isArray(product?.photos) ? product.photos : []),
    ...(Array.isArray(product?.images) ? product.images : []),
  ];
  for (const item of media) {
    if (typeof item === 'string') {
      if (item.trim()) urls.set(item.trim(), item.trim());
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const canonical = String(item.original_url || item.preview_url || item.thumb_url || item.og_image_url || '').trim();
    if (!canonical) continue;
    for (const candidate of [item.original_url, item.preview_url, item.thumb_url, item.og_image_url]) {
      const value = String(candidate || '').trim();
      if (value) urls.set(value, canonical);
    }
  }
  return urls;
}

async function existingRailsExternalIds(externalIds) {
  return new Set((await existingRailsProducts(externalIds)).keys());
}

function railsUpdatePayload(product) {
  const sizes = Array.isArray(product.attributes?.sizes) ? product.attributes.sizes : [];
  return {
    product: {
      external_id: product.external_id || '',
      name: product.name || '',
      description: product.description || '',
      h1: product.h1 || '',
      seo_title: product.seo_title || '',
      seo_description: product.seo_description || '',
      price_cents: Math.round(Number(product.price || 0) * 100),
      price_on_request: Number(product.price || 0) === 0,
      status: product.status === 'inactive' ? 'hidden' : 'active',
      primary_supplier_name: product.supplier_name || null,
      primary_supplier_avatar: product.supplier_avatar || null,
      published_at: product.source_published_at || null,
      metadata: {
        ...(product._railsMetadata && typeof product._railsMetadata === 'object' ? product._railsMetadata : {}),
        source_batch_id: product.batchId || product.batch_id || null,
        source_supplier_name: product.supplier_name || null,
        source_supplier_id: product.supplier_id || null,
        source_published_at: product.source_published_at || null,
      },
      brand_id: product.brand || null,
      category_id: product.subcategory || product.category || null,
      gender: normalizeCatalogGender(product.gender) || null,
      catalog_attributes: normalizeAttributes(product.attributes),
      media: normalizePhotos(product.photos).map((url, index) => ({
        original_url: url,
        thumb_url: url,
        preview_url: url,
        og_image_url: url,
        alt_text: product.name || '',
        sort_order: index,
        processing_status: 'processed',
      })),
      variants: sizes.map((size) => ({
        sku: `${product.external_id || 'product'}-size-${String(size).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        size: String(size),
        price_cents: Math.round(Number(product.price || 0) * 100),
        status: 'active',
        metadata: { generated_from: 'catalog_attributes.sizes' },
      })),
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableJson(value[key])]),
  );
}

function publicationPayloadHash(product) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableJson(railsUpdatePayload(product).product)))
    .digest('hex');
}

async function ensurePublicationPayloadHashes() {
  await scrapingPool.query(
    'ALTER TABLE batch_publications ADD COLUMN IF NOT EXISTS payload_hash TEXT',
  );
}

async function batchPublicationHashes(batchId, externalIds) {
  const ids = [...new Set(externalIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const result = await scrapingPool.query(`
    SELECT external_id,payload_hash
    FROM batch_publications
    WHERE batch_id=$1 AND external_id=ANY($2::text[])
  `, [batchId, ids]);
  return new Map(result.rows.map((row) => [String(row.external_id), row.payload_hash || null]));
}

async function updateRailsProduct(id, product) {
  await fetchJsonWithRetry(railsApiUrl(`/admin/products/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${await railsAdminToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(railsUpdatePayload(product)),
  }, 'Rails update');
}

async function recordBatchPublications(batchId, externalIds, payloadHashes = new Map()) {
  const ids = [...new Set(externalIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  const publishedProducts = await existingRailsProducts(ids);
  for (const externalId of ids) {
    const railsProduct = publishedProducts.get(externalId);
    if (!railsProduct) continue;
    await scrapingPool.query(`
      INSERT INTO batch_publications(batch_id,external_id,rails_product_id,payload_hash,published_at)
      VALUES($1,$2,$3,$4,NOW())
      ON CONFLICT(batch_id,external_id) DO UPDATE SET
        rails_product_id=EXCLUDED.rails_product_id,
        payload_hash=EXCLUDED.payload_hash,
        published_at=NOW()
    `, [batchId, externalId, railsProduct.id ? String(railsProduct.id) : null, payloadHashes.get(externalId) || null]);
  }
}

async function recordBatchPublication(batchId, externalId, railsProductId, payloadHash) {
  await scrapingPool.query(`
    INSERT INTO batch_publications(batch_id,external_id,rails_product_id,payload_hash,published_at)
    VALUES($1,$2,$3,$4,NOW())
    ON CONFLICT(batch_id,external_id) DO UPDATE SET
      rails_product_id=EXCLUDED.rails_product_id,
      payload_hash=EXCLUDED.payload_hash,
      published_at=NOW()
  `, [batchId, externalId, railsProductId ? String(railsProductId) : null, payloadHash || null]);
}

async function pushBatchToCatalog(batchId, options = {}, onProgress) {
  if (typeof options === 'function' && !onProgress) {
    onProgress = options;
    options = {};
  }
  const operationOwnerId = crypto.randomUUID();
  const operation = await scrapingPool.query(`
    INSERT INTO batch_operation_locks(batch_id,operation,owner_id) VALUES($1,'publish',$2)
    ON CONFLICT(batch_id) DO UPDATE SET
      operation='publish',owner_id=EXCLUDED.owner_id,created_at=NOW(),updated_at=NOW()
    WHERE batch_operation_locks.updated_at < NOW() - INTERVAL '5 minutes'
    RETURNING owner_id
  `, [batchId, operationOwnerId]);
  if (!operation.rows[0]) throw new Error('Выгрузка уже обрабатывается другим процессом');
  try {
  const products = await getBatchProducts(batchId);
  if (products.length === 0) throw new Error('В партии нет товаров для пуша');
  const batch = await getBatch(batchId);
  if (!['SCRIPT_PROCESSED', 'AI_PROCESSED', 'PUSHED'].includes(String(batch?.stage || ''))) {
    throw new Error('Публикация доступна только после полной AI-обработки партии');
  }
  const unfinished = products.filter((product) => !product.ai_processed);
  if (unfinished.length > 0) {
    throw new Error(`Публикация остановлена: ${unfinished.length} товаров ещё не обработаны ИИ`);
  }
  const withPublicationContext = (product, railsProduct = null) => ({
    ...product,
    supplier_name: batch.supplier_name || null,
    supplier_avatar: batch.supplier_avatar || null,
    _railsMetadata: railsProduct?.metadata && typeof railsProduct.metadata === 'object'
      ? railsProduct.metadata
      : undefined,
  });

  const seenExternalIds = new Set();
  const validationErrors = [];
  products.forEach((product, index) => {
    const externalId = String(product.external_id || '').trim();
    if (!externalId) validationErrors.push(`Строка ${index + 1}: отсутствует external_id`);
    if (externalId && seenExternalIds.has(externalId)) {
      validationErrors.push(`Строка ${index + 1}: дубликат external_id ${externalId}`);
    }
    if (externalId) seenExternalIds.add(externalId);
    for (const key of Object.keys(product.attributes || {})) {
      if (!/^[a-zA-Zа-яА-Я0-9][a-zA-Zа-яА-Я0-9_.-]{0,63}$/.test(key)) {
        validationErrors.push(`Строка ${index + 1}: некорректный ключ атрибута ${key}`);
      }
    }
  });
  if (validationErrors.length > 0) {
    throw new Error(`Партия не прошла проверку:\n${validationErrors.slice(0, 20).join('\n')}`);
  }
  const publicationTimestamp = new Date().toISOString();

  const lookups = await loadLegacyLookupMaps();
  const mode = options.mode === 'upsert' ? 'upsert' : 'add';
  await ensurePublicationPayloadHashes();
  if (onProgress) await onProgress({ phase: 'lookup', current: 0, total: products.length, success: 0, failed: 0 });
  const existingProducts = await existingRailsProducts(
    products.map((product) => product.external_id),
    {
      includeDetails: mode === 'upsert',
      onProgress: onProgress
        ? ({ current, total }) => onProgress({ phase: 'lookup', current, total, success: 0, failed: 0 })
        : undefined,
    },
  );
  const existingExternalIds = new Set(existingProducts.keys());
  const previousPayloadHashes = mode === 'upsert'
    ? await batchPublicationHashes(batchId, products.map((product) => product.external_id))
    : new Map();
  const changedExistingExternalIds = new Set(products.flatMap((product) => {
    const externalId = String(product.external_id || '').trim();
    if (!existingExternalIds.has(externalId)) return [];
    return previousPayloadHashes.get(externalId) === publicationPayloadHash(withPublicationContext(product, existingProducts.get(externalId))) ? [] : [externalId];
  }));
  const candidates = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const externalId = String(product.external_id || '').trim();
      return !existingExternalIds.has(externalId) || (mode === 'upsert' && changedExistingExternalIds.has(externalId));
    });
  const updatedProducts = products.map((product) => ({ ...product }));
  const errors = [];
  let prepared = 0;
  let imported = 0;
  let updated = 0;
  const skippedUnchanged = mode === 'upsert' ? existingExternalIds.size - changedExistingExternalIds.size : 0;
  let batchProductsChanged = false;

  if (onProgress) await onProgress({ phase: 'media', current: 0, total: candidates.length, success: 0, failed: 0 });

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const { product: sourceProduct, index: productIndex } = candidates[candidateIndex];
    const product = { ...sourceProduct, batchId };
    const photos = [];
    let productFailed = false;
    const existingPhotoUrls = existingRailsPhotoMap(
      existingProducts.get(String(product.external_id || '').trim()),
    );
    const requestedPhotos = normalizePhotos(product.photos);
    const existingCanonicalPhotos = [...new Set(existingPhotoUrls.values())];
    const preserveExistingRailsPhotos = mode === 'upsert'
      && existingCanonicalPhotos.length > 0
      && requestedPhotos.some((url) => !existingPhotoUrls.has(String(url || '').trim()));
    // Старая партия может хранить Szwego URL, хотя Rails уже имеет S3-галерею.
    // При upsert берем готовые фото Rails и обновляем только остальные поля.
    const publicationPhotos = preserveExistingRailsPhotos ? existingCanonicalPhotos : requestedPhotos;
    for (let photoIndex = 0; photoIndex < publicationPhotos.length; photoIndex += 1) {
      const sourceUrl = publicationPhotos[photoIndex];
      const existingRailsUrl = existingPhotoUrls.get(String(sourceUrl || '').trim());
      if (existingRailsUrl) {
        photos.push(existingRailsUrl);
        continue;
      }
      const safeExternalId = String(product.external_id || product.id || `row-${productIndex + 1}`).replace(/[^a-zA-Z0-9_.-]+/g, '_');
      const key = `batches/${batchId}/${safeExternalId}_${photoIndex}.jpg`;
      try {
        photos.push(await uploadPhotoIfNeeded(sourceUrl, key));
      } catch (error) {
        productFailed = true;
        photos.push(sourceUrl);
        errors.push(`${product.external_id || product.name}, фото ${photoIndex + 1}: ${error.message}`);
      }
    }
    product.photos = photos.filter(Boolean);
    if (JSON.stringify(product.photos) !== JSON.stringify(normalizePhotos(sourceProduct.photos))) {
      batchProductsChanged = true;
    }
    updatedProducts[productIndex] = product;
    if ((candidateIndex + 1) % 10 === 0 || candidateIndex + 1 === candidates.length) {
      await scrapingPool.query(
        'UPDATE batch_operation_locks SET updated_at=NOW() WHERE batch_id=$1 AND owner_id=$2',
        [batchId, operationOwnerId],
      );
    }
    if (!productFailed) prepared += 1;

    if (onProgress) await onProgress({ phase: 'media', current: candidateIndex + 1, total: candidates.length, success: prepared, failed: errors.length });
  }

  if (batchProductsChanged) await saveBatchProducts(batchId, updatedProducts);
  if (errors.length > 0) {
    throw new Error(`Пуш остановлен: не все фотографии перенесены в ваш S3.\n${errors.slice(0, 20).join('\n')}`);
  }

  const payloadHashes = new Map(updatedProducts.map((product) => [
    String(product.external_id || '').trim(),
    publicationPayloadHash(withPublicationContext(product)),
  ]));

  if (mode === 'upsert') {
    const existingEntries = [...existingProducts.entries()]
      .filter(([externalId]) => changedExistingExternalIds.has(externalId));
    const productsByExternalId = new Map(updatedProducts.map((product) => [String(product.external_id || '').trim(), product]));
    let updateCursor = 0;
    let updateCompleted = 0;
    if (onProgress) await onProgress({ phase: 'publish', current: 0, total: existingEntries.length, success: 0, failed: 0 });
    const updateWorkers = Array.from({ length: Math.min(8, existingEntries.length) }, async () => {
      while (updateCursor < existingEntries.length) {
        const [externalId, railsProduct] = existingEntries[updateCursor++];
        const product = productsByExternalId.get(externalId);
        try {
          if (product) {
            await updateRailsProduct(railsProduct.id, withPublicationContext({ ...product, source_published_at: publicationTimestamp }, railsProduct));
            updated += 1;
            await recordBatchPublication(batchId, externalId, railsProduct.id, payloadHashes.get(externalId));
          }
        } catch (error) {
          errors.push(`${externalId}: ${error.message}`);
        } finally {
          updateCompleted += 1;
          if (onProgress) await onProgress({
            phase: 'publish',
            current: updateCompleted,
            total: existingEntries.length,
            success: updated,
            failed: errors.length,
          });
        }
      }
    });
    await Promise.all(updateWorkers);
    if (errors.length > 0) throw new Error(`Обновление остановлено:\n${errors.slice(0, 20).join('\n')}`);
  }

  const railsRows = candidates
    .map(({ index }) => updatedProducts[index])
    .filter((product) => !existingExternalIds.has(String(product.external_id || '').trim()))
    .filter((product) => product.external_id || product.name)
    .map((product) => productToRailsCsvRow(withPublicationContext(product), lookups));
  const importBatches = [];
  const newRowsTotal = railsRows.length;
  let importedProcessed = 0;
  if (newRowsTotal > 0 && onProgress) {
    await onProgress({ phase: 'publish', current: 0, total: newRowsTotal, success: 0, failed: 0 });
  }
  for (const [index, chunk] of chunkArray(railsRows, Number(process.env.RAILS_IMPORT_CHUNK_SIZE || 50)).entries()) {
    const payload = await postRailsImportBatch({
      name: `${batch?.name || `AdminYeezy batch ${batchId}`} (${index + 1})`,
      products: chunk,
      supplierId: batch?.supplier_id,
      supplierName: batch?.supplier_name,
      supplierAvatar: batch?.supplier_avatar,
      publishedAt: publicationTimestamp,
    });
    importBatches.push(payload.import_batch?.id);
    imported += Number(payload.result?.products_imported || 0);
    // Коммитим владение сразу после каждого успешно принятого Rails-чанка.
    // Если следующий чанк упадет, повторный запуск не потеряет уже опубликованное.
    await recordBatchPublications(batchId, chunk.map((row) => row.external_id), payloadHashes);
    if (payload.result?.products_failed) {
      for (const error of payload.result.errors || []) errors.push(`Rails line ${error.line}: ${error.error}`);
    }
    importedProcessed += chunk.length;
    if (onProgress) await onProgress({
      phase: 'publish',
      current: importedProcessed,
      total: newRowsTotal,
      success: imported,
      failed: errors.length,
    });
  }

  if (errors.length > 0) {
    throw new Error(`Публикация завершилась с ошибками:\n${errors.slice(0, 20).join('\n')}`);
  }

  try {
    await cleanupUnusedBatchPhotos(batchId, updatedProducts);
  } catch (error) {
    console.warn(`Could not clean stale S3 photos for batch ${batchId}:`, error.message);
  }
  await scrapingPool.query("UPDATE scraping_batches SET stage='PUSHED', updated_at=NOW() WHERE id=$1", [batchId]);

  return {
    success: imported,
    updated,
    failed: errors.length,
    errors,
    total: products.length,
    skippedExisting: mode === 'add' ? existingExternalIds.size : 0,
    skippedUnchanged,
    railsImportBatchIds: importBatches.filter(Boolean),
  };
  } finally {
    await scrapingPool.query('DELETE FROM batch_operation_locks WHERE batch_id=$1 AND owner_id=$2', [batchId, operationOwnerId]).catch(() => undefined);
  }
}

async function closePools() {
  await Promise.allSettled([scrapingPool.end(), legacyCatalogPool.end()]);
}

module.exports = {
  PRODUCT_COLUMNS,
  closePools,
  existingRailsExternalIds,
  existingRailsProducts,
  existingRailsPhotoMap,
  getBatch,
  getBatchProducts,
  getLatestBatches,
  getSupplier,
  isAlreadyHosted,
  lookupName,
  parseCsvObjects,
  publicationPayloadHash,
  railsUpdatePayload,
  listAllSuppliers,
  listFavoriteSuppliers,
  normalizeProductCatalogReferences,
  processBatchWithAi,
  pushBatchToCatalog,
  runBatchPostProcessScript,
  saveBatchProducts,
  serializeProductsToCsv,
  supplierScriptColumns,
  startScraping,
  uploadPhotoIfNeeded,
};

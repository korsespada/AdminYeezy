const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const SCRAPING_DB = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL;
const LEGACY_CATALOG_DB = process.env.LEGACY_CATALOG_DATABASE_URL || process.env.DATABASE_URL || process.env.SCRAPING_DATABASE_URL;

const scrapingPool = new Pool({ connectionString: SCRAPING_DB });
const legacyCatalogPool = new Pool({ connectionString: LEGACY_CATALOG_DB });
let cachedRailsAdminToken = null;

const PRODUCT_COLUMNS = [
  { name: 'external_id', key: 'external_id' },
  { name: 'name', key: 'name' },
  { name: 'description', key: 'description' },
  { name: 'price', key: 'price' },
  { name: 'status', key: 'status' },
  { name: 'brand', key: 'brand' },
  { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' },
  { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' },
  { name: 'ai_processed', key: 'ai_processed' },
];

const RAILS_IMPORT_COLUMNS = [
  { name: 'external_id', key: 'external_id' },
  { name: 'name', key: 'name' },
  { name: 'description', key: 'description' },
  { name: 'price', key: 'price' },
  { name: 'status', key: 'status' },
  { name: 'brand', key: 'brand' },
  { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' },
  { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' },
  { name: 'attributes', key: 'attributes' },
];

const CORE_PRODUCT_FIELDS = new Set([
  'id', 'external_id', 'name', 'description', 'price', 'status', 'brand',
  'category', 'subcategory', 'gender', 'photos', 'batch_id', 'batchid',
  'ai_processed', 'attributes', 'created_at', 'updated_at',
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
    price: Number(row.price || 0),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    brand: normalizeBrand(row.brand),
    category: row.category || '',
    subcategory: row.subcategory || '',
    gender: row.gender || '',
    photos: normalizePhotos(row.photos),
    attributes: extractAttributes(row),
    batchId: row.batch_id || row.batchId,
    ai_processed: row.ai_processed === true || row.ai_processed === 'true' || row.ai_processed === 'True',
  };
}

function serializeProductsToCsv(products, columns = PRODUCT_COLUMNS, delimiter = ';') {
  const effectiveColumns = columns.some((column) => column.key === 'attributes') || !products.some((product) => Object.keys(normalizeAttributes(product.attributes)).length > 0)
    ? columns
    : [...columns, { name: 'attributes', key: 'attributes' }];
  const header = effectiveColumns.map((column) => column.name).join(delimiter);
  const rows = products.map((product) => effectiveColumns.map((column) => {
    let value = product[column.key];
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

async function safeLookup(tableName) {
  try {
    const result = await legacyCatalogPool.query(`SELECT id::text, name FROM ${tableName}`);
    return new Map(result.rows.map((row) => [String(row.id), row.name]));
  } catch (error) {
    console.warn(`Lookup ${tableName} unavailable:`, error.message);
    return new Map();
  }
}

async function loadLegacyLookupMaps() {
  const [brands, categories, subcategories] = await Promise.all([
    safeLookup('brands'),
    safeLookup('categories'),
    safeLookup('subcategories'),
  ]);
  return { brands, categories, subcategories };
}

function lookupName(map, value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return lookupName(map, value.filter(Boolean)[0]);
  const key = String(value).trim();
  if (!key) return '';
  return map.get(key) || key;
}

function productToRailsCsvRow(product, lookups) {
  return {
    external_id: product.external_id || '',
    name: product.name || '',
    description: product.description || '',
    price: product.price || 0,
    status: product.status === 'inactive' ? 'hidden' : 'active',
    brand: lookupName(lookups.brands, product.brand),
    category: lookupName(lookups.categories, product.category),
    subcategory: lookupName(lookups.subcategories, product.subcategory),
    gender: product.gender || '',
    photos: normalizePhotos(product.photos).join('|'),
    attributes: normalizeAttributes(product.attributes),
  };
}

async function postRailsImportBatch({ name, products }) {
  const response = await fetch(railsApiUrl('/admin/import_batches'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await railsAdminToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'csv',
      name,
      csv_text: serializeProductsToCsv(products, RAILS_IMPORT_COLUMNS, ','),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Rails import failed with ${response.status}`);
  }
  return payload;
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

async function resolveLegacySupplierDefaults(supplier) {
  const values = [
    supplier.default_brand,
    supplier.default_category,
    supplier.default_subcategory,
  ].filter(Boolean).map(String);
  if (values.length === 0) return supplier;

  try {
    const result = await scrapingPool.query(
      `SELECT entity_type, legacy_id, canonical_id
       FROM catalog_id_mappings
       WHERE canonical_id = ANY($1::text[]) OR legacy_id = ANY($1::text[])`,
      [values],
    );
    const legacyByValue = new Map();
    for (const row of result.rows) {
      legacyByValue.set(String(row.canonical_id), String(row.legacy_id));
      legacyByValue.set(String(row.legacy_id), String(row.legacy_id));
    }
    return {
      ...supplier,
      default_brand: legacyByValue.get(String(supplier.default_brand || '')) || supplier.default_brand,
      default_category: legacyByValue.get(String(supplier.default_category || '')) || supplier.default_category,
      default_subcategory: legacyByValue.get(String(supplier.default_subcategory || '')) || supplier.default_subcategory,
    };
  } catch (error) {
    console.warn('Catalog ID compatibility mapping unavailable:', error.message);
    return supplier;
  }
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
    SELECT id, external_id, name, description, price, status, brand, category, subcategory, gender, photos, attributes, batch_id, ai_processed, created_at, updated_at
    FROM products
    WHERE batch_id=$1
    ORDER BY id ASC
    ${paging}
  `, params);

  return res.rows.map(normalizeProduct);
}

async function saveBatchProducts(batchId, products) {
  const client = await scrapingPool.connect();
  try {
    await client.query('BEGIN');
    const keptIds = [];

    for (const product of products) {
      const normalized = normalizeProduct({ ...product, batch_id: batchId });
      const numericId = normalized.id !== undefined && normalized.id !== null && String(normalized.id).match(/^\d+$/)
        ? Number(normalized.id)
        : null;

      if (numericId) {
        const updateRes = await client.query(`
          UPDATE products
          SET external_id=$1, name=$2, description=$3, price=$4, status=$5, brand=$6, category=$7, subcategory=$8, gender=$9, photos=$10::jsonb, attributes=$11::jsonb, ai_processed=$12, batch_id=$13, updated_at=NOW()
          WHERE id=$14
          RETURNING id
        `, [
          normalized.external_id,
          normalized.name,
          normalized.description,
          normalized.price,
          normalized.status,
          normalized.brand,
          normalized.category,
          normalized.subcategory || null,
          normalized.gender,
          JSON.stringify(normalized.photos || []),
          JSON.stringify(normalized.attributes || {}),
          normalized.ai_processed,
          batchId,
          numericId,
        ]);
        if (updateRes.rowCount > 0) {
          keptIds.push(Number(updateRes.rows[0].id));
          continue;
        }
      }

      const insertRes = await client.query(`
        INSERT INTO products (external_id, name, description, price, status, brand, category, subcategory, gender, photos, attributes, ai_processed, batch_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, NOW(), NOW())
        ON CONFLICT (external_id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          status = EXCLUDED.status,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          subcategory = EXCLUDED.subcategory,
          gender = EXCLUDED.gender,
          photos = EXCLUDED.photos,
          attributes = EXCLUDED.attributes,
          ai_processed = EXCLUDED.ai_processed,
          batch_id = EXCLUDED.batch_id,
          updated_at = NOW()
        RETURNING id
      `, [
        normalized.external_id || null,
        normalized.name,
        normalized.description,
        normalized.price,
        normalized.status,
        normalized.brand,
        normalized.category,
        normalized.subcategory || null,
        normalized.gender,
        JSON.stringify(normalized.photos || []),
        JSON.stringify(normalized.attributes || {}),
        normalized.ai_processed,
        batchId,
      ]);
      if (insertRes.rows[0]?.id) keptIds.push(Number(insertRes.rows[0].id));
    }

    if (keptIds.length > 0) {
      await client.query('DELETE FROM products WHERE batch_id=$1 AND NOT (id = ANY($2::int[]))', [batchId, keptIds]);
    } else {
      await client.query('DELETE FROM products WHERE batch_id=$1', [batchId]);
    }

    await client.query('UPDATE scraping_batches SET items_count=$1, updated_at=NOW() WHERE id=$2', [products.length, batchId]);
    await client.query('COMMIT');
    return { count: products.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function importScrapedFileToBatch({ supplier, taskId, outputPath, itemsCount }) {
  const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
  const lines = fileContent.split('\n').filter((line) => line.trim());
  if (lines.length <= 1) return null;

  const batchId = crypto.randomUUID();
  const batchName = `${supplier.name} - ${new Date().toLocaleString('ru-RU')}`;
  await scrapingPool.query(
    'INSERT INTO scraping_batches (id, name, supplier_id, items_count, stage) VALUES ($1, $2, $3, $4, $5)',
    [batchId, batchName, supplier.id, itemsCount, 'SCRAPED'],
  );
  await scrapingPool.query('UPDATE scraping_tasks SET batch_id=$1 WHERE id=$2', [batchId, taskId]);

  const headers = parseDelimitedLine(lines[0], ';');
  const products = lines.slice(1).map((line) => {
    const row = parseDelimitedLine(line, ';');
    const item = {};
    headers.forEach((header, index) => {
      item[header.trim()] = row[index] || '';
    });
    let photos = [];
    try {
      photos = item.photos ? JSON.parse(item.photos) : [];
    } catch {
      photos = normalizePhotos(item.photos);
    }
    return normalizeProduct({
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
      batch_id: batchId,
    });
  }).filter((product) => product.external_id || product.name);

  await saveBatchProducts(batchId, products);
  return batchId;
}

async function startScraping(supplierId, endDate, overrideTag, overrideGroup, onComplete) {
  const supplier = await getSupplier(supplierId);
  if (!supplier) throw new Error('Поставщик не найден');
  const parserSupplier = await resolveLegacySupplierDefaults(supplier);

  const taskRes = await scrapingPool.query(
    `INSERT INTO scraping_tasks (supplier_id, status, end_date)
     VALUES ($1, 'running', $2) RETURNING id`,
    [supplierId, endDate || null],
  );
  const taskId = taskRes.rows[0].id;

  const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `task_${taskId}.csv`);
  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', 'SzwegoParser.py');
  const cookie = supplier.cookie || process.env.DEFAULT_SZWEGO_COOKIE || '';
  const args = [
    scriptPath,
    '--album_id', supplier.album_id,
    '--cookie', cookie,
    '--output', outputPath,
  ];
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
    const status = code === 0 ? 'Сырой CSV' : 'failed';
    const errorMsg = code === 0 ? null : (stderr || `Exit code ${code}`);
    let itemsCount = 0;
    let batchId = null;

    try {
      if (code === 0 && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
        const fileContent = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
        const lines = fileContent.split('\n').filter((line) => line.trim());
        itemsCount = Math.max(0, lines.length - 1);
      }

      await scrapingPool.query(
        `UPDATE scraping_tasks SET status=$1, result_path=$2, error_message=$3, items_count=$4, updated_at=NOW() WHERE id=$5`,
        [status, code === 0 ? outputPath : null, errorMsg, itemsCount, taskId],
      );

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
    } catch (error) {
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

  await saveBatchProducts(batchId, products);

  const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `task_ai_${Math.floor(Math.random() * 1000000)}.csv`);
  fs.writeFileSync(/*turbopackIgnore: true*/ outputPath, serializeProductsToCsv(products), 'utf-8');

  await scrapingPool.query(`
    INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
    VALUES ($1, $2, 'Обработано ИИ', $3, $4, NOW())
  `, [batch.supplier_id, batchId, outputPath, products.length]);
  await scrapingPool.query("UPDATE scraping_batches SET stage='AI_PROCESSED', updated_at=NOW() WHERE id=$1", [batchId]);

  return { processed: unprocessed.length, total: products.length, path: outputPath };
}

async function runBatchPostProcessScript(batchId) {
  const batch = await getBatch(batchId);
  if (!batch?.supplier_id) throw new Error('У партии не найден поставщик');
  const supplier = await getSupplier(batch.supplier_id);
  if (!supplier?.post_process_script) throw new Error('Для поставщика не назначен скрипт постобработки');

  const products = await getBatchProducts(batchId);
  if (products.length === 0) throw new Error('В партии нет товаров');

  const tmpDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const taskId = Math.floor(Math.random() * 1000000);
  const inputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `batch_${batchId}_custom_input_${taskId}.csv`);
  const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `task_custom_${taskId}.csv`);
  fs.writeFileSync(/*turbopackIgnore: true*/ inputPath, serializeProductsToCsv(products), 'utf-8');

  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'parser', supplier.post_process_script);
  await new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON_PATH || 'python', [scriptPath, inputPath, outputPath]);
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `Post-process exited with ${code}`));
      resolve();
    });
  });

  const processedProducts = fs.existsSync(/*turbopackIgnore: true*/ outputPath)
    ? parseCsvText(fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8'))
    : [];
  if (processedProducts.length === 0) throw new Error('Скрипт вернул пустой файл');

  const originalByExternalId = new Map(products.map((product) => [String(product.external_id), product]));
  for (const processedProduct of processedProducts) {
    if (Object.keys(processedProduct.attributes || {}).length === 0) {
      const original = originalByExternalId.get(String(processedProduct.external_id));
      if (original?.attributes) processedProduct.attributes = original.attributes;
    }
  }

  await saveBatchProducts(batchId, processedProducts);
  await scrapingPool.query(`
    INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
    VALUES ($1, $2, 'Обработано скриптом', $3, $4, NOW())
  `, [batch.supplier_id, batchId, outputPath, processedProducts.length]);

  return { processed: processedProducts.length, path: outputPath };
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

function isAlreadyHosted(url) {
  return /beget\.app|selcloud\.ru|beget\.cloud|yeezyunique\.ru/i.test(url);
}

async function uploadPhotoIfNeeded(url, key) {
  if (!url || isAlreadyHosted(url) || !process.env.S3_BUCKET) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const buffer = Buffer.from(await response.arrayBuffer());
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));
    return getS3PublicUrl(key);
  } catch (error) {
    console.warn(`S3 upload failed for ${url}:`, error.message);
    return url;
  }
}

async function pushBatchToCatalog(batchId, onProgress) {
  const products = await getBatchProducts(batchId);
  if (products.length === 0) throw new Error('В партии нет товаров для пуша');

  const seenExternalIds = new Set();
  const validationErrors = [];
  products.forEach((product, index) => {
    const externalId = String(product.external_id || '').trim();
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

  const batch = await getBatch(batchId);
  const lookups = await loadLegacyLookupMaps();
  const updatedProducts = [];
  const errors = [];
  let prepared = 0;
  let imported = 0;

  for (let i = 0; i < products.length; i += 1) {
    const product = { ...products[i], batchId };
    try {
      const photos = [];
      for (let photoIndex = 0; photoIndex < product.photos.length; photoIndex += 1) {
        const key = `batches/${batchId}/${product.external_id}_${photoIndex}.jpg`;
        photos.push(await uploadPhotoIfNeeded(product.photos[photoIndex], key));
      }
      product.photos = photos.filter(Boolean);
      updatedProducts.push(product);
      prepared += 1;
    } catch (error) {
      errors.push(`${product.external_id || product.name}: ${error.message}`);
      updatedProducts.push(product);
    }

    if (onProgress) await onProgress({ current: i + 1, total: products.length, success: prepared, failed: errors.length });
  }

  await saveBatchProducts(batchId, updatedProducts);

  const railsRows = updatedProducts
    .filter((product) => product.external_id || product.name)
    .map((product) => productToRailsCsvRow(product, lookups));
  const importBatches = [];
  for (const [index, chunk] of chunkArray(railsRows, Number(process.env.RAILS_IMPORT_CHUNK_SIZE || 200)).entries()) {
    const payload = await postRailsImportBatch({
      name: `${batch?.name || `AdminYeezy batch ${batchId}`} (${index + 1})`,
      products: chunk,
    });
    importBatches.push(payload.import_batch?.id);
    imported += Number(payload.result?.products_imported || 0);
    if (payload.result?.products_failed) {
      for (const error of payload.result.errors || []) errors.push(`Rails line ${error.line}: ${error.error}`);
    }
  }

  if (importBatches.length > 0) {
    await scrapingPool.query("UPDATE scraping_batches SET stage='PUSHED', updated_at=NOW() WHERE id=$1", [batchId]);
  }

  return {
    success: imported,
    failed: errors.length,
    errors,
    total: products.length,
    railsImportBatchIds: importBatches.filter(Boolean),
  };
}

async function closePools() {
  await Promise.allSettled([scrapingPool.end(), mainPool.end()]);
}

module.exports = {
  PRODUCT_COLUMNS,
  closePools,
  getBatch,
  getBatchProducts,
  getLatestBatches,
  getSupplier,
  listAllSuppliers,
  listFavoriteSuppliers,
  processBatchWithAi,
  pushBatchToCatalog,
  runBatchPostProcessScript,
  startScraping,
};

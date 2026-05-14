const { Pool } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const SCRAPING_DB = process.env.SCRAPING_DATABASE_URL || process.env.DATABASE_URL;
const MAIN_DB = process.env.DATABASE_URL || process.env.SCRAPING_DATABASE_URL;

const scrapingPool = new Pool({ connectionString: SCRAPING_DB });
const mainPool = new Pool({ connectionString: MAIN_DB });

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
    batchId: row.batch_id || row.batchId,
    ai_processed: row.ai_processed === true || row.ai_processed === 'true' || row.ai_processed === 'True',
  };
}

function serializeProductsToCsv(products, columns = PRODUCT_COLUMNS, delimiter = ';') {
  const header = columns.map((column) => column.name).join(delimiter);
  const rows = products.map((product) => columns.map((column) => {
    let value = product[column.key];
    if (value === undefined || value === null) value = '';
    if (Array.isArray(value)) value = JSON.stringify(value);
    if (typeof value === 'boolean') value = value ? 'true' : 'false';
    if (typeof value === 'string') {
      value = value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
    }
    const str = String(value).replace(/"/g, '""');
    return str.includes(delimiter) || str.includes('"') ? `"${str}"` : str;
  }).join(delimiter));
  return [header, ...rows].join('\n');
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
    SELECT id, external_id, name, description, price, status, brand, category, subcategory, gender, photos, batch_id, ai_processed, created_at, updated_at
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
          SET external_id=$1, name=$2, description=$3, price=$4, status=$5, brand=$6, category=$7, subcategory=$8, gender=$9, photos=$10::jsonb, ai_processed=$11, batch_id=$12, updated_at=NOW()
          WHERE id=$13
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
        INSERT INTO products (external_id, name, description, price, status, brand, category, subcategory, gender, photos, ai_processed, batch_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, NOW(), NOW())
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
  const fileContent = fs.readFileSync(outputPath, 'utf-8');
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

  const taskRes = await scrapingPool.query(
    `INSERT INTO scraping_tasks (supplier_id, status, end_date)
     VALUES ($1, 'running', $2) RETURNING id`,
    [supplierId, endDate || null],
  );
  const taskId = taskRes.rows[0].id;

  const tmpDir = path.join(process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const outputPath = path.join(tmpDir, `task_${taskId}.csv`);
  const scriptPath = path.join(process.cwd(), 'scripts', 'parser', 'SzwegoParser.py');
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
  if (supplier.min_photos) args.push('--min_photos', String(supplier.min_photos));
  if (supplier.min_desc_len) args.push('--min_desc', String(supplier.min_desc_len));
  if (supplier.default_category) args.push('--category', supplier.default_category);
  if (supplier.default_subcategory) args.push('--subcategory', supplier.default_subcategory);
  if (supplier.default_brand) args.push('--brand', supplier.default_brand);
  if (supplier.default_gender) args.push('--gender', supplier.default_gender);
  if (supplier.default_price) args.push('--default_price', String(supplier.default_price));
  if (supplier.parse_tags_enabled) args.push('--parse_tags');

  const pythonProcess = spawn(process.env.PYTHON_PATH || 'python', args);
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
      if (code === 0 && fs.existsSync(outputPath)) {
        const fileContent = fs.readFileSync(outputPath, 'utf-8');
        const lines = fileContent.split('\n').filter((line) => line.trim());
        itemsCount = Math.max(0, lines.length - 1);
      }

      await scrapingPool.query(
        `UPDATE scraping_tasks SET status=$1, result_path=$2, error_message=$3, items_count=$4, updated_at=NOW() WHERE id=$5`,
        [status, code === 0 ? outputPath : null, errorMsg, itemsCount, taskId],
      );

      if (code === 0 && fs.existsSync(outputPath)) {
        batchId = await importScrapedFileToBatch({ supplier, taskId, outputPath, itemsCount });
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

  const scratchDir = path.join(process.cwd(), 'scratch');
  ensureDir(scratchDir);
  const tempIn = path.join(scratchDir, `ai_in_${Date.now()}.json`);
  fs.writeFileSync(tempIn, JSON.stringify(unprocessed), 'utf-8');

  const scriptPath = path.join(process.cwd(), 'universal_ai_process.py');
  const pythonCmd = process.env.PYTHON_PATH || 'python';

  const result = await new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, String(batch.supplier_id), tempIn], {
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
      fs.unlinkSync(tempIn);
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

  const tmpDir = path.join(process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const outputPath = path.join(tmpDir, `task_ai_${Math.floor(Math.random() * 1000000)}.csv`);
  fs.writeFileSync(outputPath, serializeProductsToCsv(products), 'utf-8');

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

  const tmpDir = path.join(process.cwd(), 'tmp');
  ensureDir(tmpDir);
  const taskId = Math.floor(Math.random() * 1000000);
  const inputPath = path.join(tmpDir, `batch_${batchId}_custom_input_${taskId}.csv`);
  const outputPath = path.join(tmpDir, `task_custom_${taskId}.csv`);
  fs.writeFileSync(inputPath, serializeProductsToCsv(products), 'utf-8');

  const scriptPath = path.join(process.cwd(), 'scripts', 'parser', supplier.post_process_script);
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_PATH || 'python', [scriptPath, inputPath, outputPath]);
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `Post-process exited with ${code}`));
      resolve();
    });
  });

  const processedProducts = fs.existsSync(outputPath)
    ? parseCsvText(fs.readFileSync(outputPath, 'utf-8'))
    : [];
  if (processedProducts.length === 0) throw new Error('Скрипт вернул пустой файл');

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

  const updatedProducts = [];
  const errors = [];
  let success = 0;

  for (let i = 0; i < products.length; i += 1) {
    const product = { ...products[i], batchId };
    try {
      const photos = [];
      for (let photoIndex = 0; photoIndex < product.photos.length; photoIndex += 1) {
        const key = `batches/${batchId}/${product.external_id}_${photoIndex}.jpg`;
        photos.push(await uploadPhotoIfNeeded(product.photos[photoIndex], key));
      }
      product.photos = photos.filter(Boolean);

      const id = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 9);
      const brandArray = Array.isArray(product.brand) ? product.brand : (product.brand ? [product.brand] : []);
      await mainPool.query(`
        INSERT INTO products (id, external_id, name, description, price, status, brand, category, subcategory, gender, photos, batch_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
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
          batch_id = COALESCE(EXCLUDED.batch_id, products.batch_id),
          created_at = COALESCE(products.created_at, NOW()),
          updated_at = NOW()
      `, [
        id,
        product.external_id,
        product.name,
        product.description || '',
        product.price || 0,
        product.status || 'active',
        brandArray,
        product.category,
        product.subcategory || null,
        product.gender || '',
        JSON.stringify(product.photos || []),
        batchId,
      ]);
      updatedProducts.push(product);
      success += 1;
    } catch (error) {
      errors.push(`${product.external_id || product.name}: ${error.message}`);
      updatedProducts.push(product);
    }

    if (onProgress) await onProgress({ current: i + 1, total: products.length, success, failed: errors.length });
  }

  await saveBatchProducts(batchId, updatedProducts);
  if (success > 0) {
    await scrapingPool.query("UPDATE scraping_batches SET stage='PUSHED', updated_at=NOW() WHERE id=$1", [batchId]);
  }

  return { success, failed: errors.length, errors, total: products.length };
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

const fs = require('fs');
const { Pool } = require('pg');

function loadEnv() {
  const values = {};
  for (const file of ['.env', '.env.local']) {
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(require('dotenv').parse(fs.readFileSync(file)))) values[key] = value;
  }
  return values;
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function chunk(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) result.push(array.slice(index, index + size));
  return result;
}

async function fetchWithRetry(url, init, label) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }

    if (response.ok || (![429, 500, 502, 503, 504].includes(response.status)) || attempt === 5) {
      return response;
    }

    const retryAfter = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 60_000)
      : Math.min(attempt * 5_000, 60_000);
    console.log(`${label}: ${response.status}, повтор через ${Math.ceil(delayMs / 1000)} сек. (попытка ${attempt + 1}/5)`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function jsonProducts(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.products)) return value.products;
  return [];
}

async function main() {
  const env = loadEnv();
  const folderName = argValue('--folder', 'Март');
  const apply = hasFlag('--apply');
  const scrapingPool = new Pool({ connectionString: env.SCRAPING_DATABASE_URL || env.DATABASE_URL });
  const railsBase = `${String(env.RAILS_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;

  try {
    const folder = await scrapingPool.query(
      'SELECT id,name FROM export_folders WHERE name=$1 LIMIT 1',
      [folderName],
    );
    if (!folder.rows[0]) throw new Error(`Папка «${folderName}» не найдена`);

    const batches = await scrapingPool.query(`
      SELECT b.id,b.name,b.supplier_id,s.name AS supplier_name,s.avatar_url,b.stage
      FROM scraping_batches b
      JOIN suppliers s ON s.id=b.supplier_id
      WHERE b.folder_id=$1
      ORDER BY b.created_at ASC
    `, [folder.rows[0].id]);

    const byExternalId = new Map();
    const conflicts = [];
    for (const batch of batches.rows) {
      let products = await scrapingPool.query(
        'SELECT external_id FROM products WHERE batch_id=$1 AND external_id IS NOT NULL',
        [batch.id],
      );
      let rows = products.rows;
      if (rows.length === 0) {
        const snapshot = await scrapingPool.query(`
          SELECT products
          FROM batch_snapshots
          WHERE batch_id=$1
          ORDER BY CASE WHEN label='Сырой товар' THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        `, [batch.id]);
        rows = jsonProducts(snapshot.rows[0]?.products)
          .map((product) => ({ external_id: product?.external_id }))
          .filter((product) => product.external_id);
      }

      for (const row of rows) {
        const externalId = String(row.external_id || '').trim();
        if (!externalId) continue;
        const candidate = {
          externalId,
          batchId: batch.id,
          batchName: batch.name,
          supplierId: batch.supplier_id,
          supplierName: batch.supplier_name,
          supplierAvatar: batch.avatar_url,
        };
        const previous = byExternalId.get(externalId);
        if (previous && previous.supplierName !== candidate.supplierName) {
          conflicts.push({ externalId, first: previous.supplierName, second: candidate.supplierName });
          continue;
        }
        byExternalId.set(externalId, candidate);
      }
    }

    console.log(`Папка: ${folderName}`);
    console.log(`Batch: ${batches.rows.length}`);
    console.log(`Уникальных external_id: ${byExternalId.size}`);
    console.log(`Конфликтов: ${conflicts.length}`);
    if (conflicts.length) console.log(JSON.stringify(conflicts.slice(0, 20), null, 2));
    if (!apply) {
      console.log('Режим dry-run. Для записи используйте --apply после публикации обновлённого Rails API.');
      return;
    }

    const adminEmail = env.RAILS_ADMIN_EMAIL || env.LOCAL_ADMIN_EMAIL;
    const adminPassword = env.RAILS_ADMIN_PASSWORD || env.LOCAL_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      throw new Error('Для --apply нужны RAILS_ADMIN_EMAIL/RAILS_ADMIN_PASSWORD или LOCAL_ADMIN_EMAIL/LOCAL_ADMIN_PASSWORD');
    }
    const login = await fetchWithRetry(`${railsBase}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    const loginPayload = await login.json().catch(() => ({}));
    if (!login.ok || !loginPayload.token) throw new Error(`Rails login failed: ${login.status}`);
    const headers = { Authorization: `Bearer ${loginPayload.token}`, 'Content-Type': 'application/json' };
    const railsProducts = new Map();
    for (const ids of chunk([...byExternalId.keys()], 50)) {
      const params = new URLSearchParams({ page: '1', per_page: String(ids.length), external_ids: ids.join(',') });
      const response = await fetchWithRetry(`${railsBase}/admin/products?${params}`, { headers }, 'Rails lookup');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Rails lookup failed: ${response.status}`);
      for (const product of payload.products || []) railsProducts.set(String(product.external_id), product);
    }

    let updated = 0;
    let skipped = 0;
    let missing = 0;
    const publishedAt = new Date().toISOString();
    for (const [externalId, target] of byExternalId) {
      const product = railsProducts.get(externalId);
      if (!product?.id) {
        missing += 1;
        continue;
      }
      const metadata = product.metadata && typeof product.metadata === 'object' ? product.metadata : {};
      if (
        (product.supplier?.name === target.supplierName || metadata.source_supplier_name === target.supplierName) &&
        metadata.source_batch_id === target.batchId &&
        metadata.source_published_at
      ) {
        skipped += 1;
        continue;
      }
      const response = await fetchWithRetry(`${railsBase}/admin/products/${encodeURIComponent(product.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          product: {
            primary_supplier_name: target.supplierName,
            primary_supplier_avatar: target.supplierAvatar || null,
            published_at: publishedAt,
            metadata: {
              ...metadata,
              source_batch_id: target.batchId,
              source_supplier_name: target.supplierName,
              source_supplier_id: target.supplierId,
              source_published_at: publishedAt,
            },
          },
        }),
      }, `PATCH ${externalId}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(`${externalId}: ${response.status} ${payload.message || payload.error || ''}`.trim());
      }
      updated += 1;
      if (updated % 50 === 0) console.log(`Обновлено: ${updated}`);
    }
    console.log(JSON.stringify({ updated, skipped, missing }, null, 2));
  } finally {
    await scrapingPool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

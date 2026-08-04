'use server'

import crypto from 'node:crypto'
import { query, scrapingQuery, getScrapingClient, redis, elastic } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { uploadToS3 } from '@/lib/s3'
import { getScrapingFileArtifact } from '@/lib/scraping-files'
import { requireAdmin } from '@/lib/admin-session'
import { resolveSafeRuntimePath } from '@/lib/runtime-paths'
import {
  extractProductAttributes,
  hasProductAttributes,
  normalizeProductAttributes,
  type ProductAttributes,
} from '@/lib/product-attributes'
import { activeBatchOperation, claimBatchOperation, releaseBatchOperation } from '@/lib/batch-operation-lock'
import { getRailsCatalogLookups } from '@/lib/rails-admin'
import { normalizeProductsCatalogReferences, type CatalogIdMapping } from '@/lib/catalog-reference-normalizer'

export interface CsvProduct {
    id?: string | number
    external_id: string
    name: string
    description: string
    h1?: string
    seo_title?: string
    seo_description?: string
    slug?: string
    photo_alts?: string[]
    photo_slugs?: string[]
    price: number
    status: 'active' | 'inactive'
    brand: string
    category: string
    subcategory: string
    photos: string[]
    gender?: string
    attributes?: ProductAttributes
    batchId?: string
    ai_processed?: boolean | string
    ai_sampled?: boolean
    price_source?: string
    variant_group_key?: string | null
    ai_error?: string | null
    ai_confidence?: number | null
    source_position?: number | null
}

export interface Lookups {
    brands: any[]
    categories: any[]
    subcategories: any[]
}

const BATCH_PRODUCT_COLUMNS = [
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
  { name: 'variant_group_key', key: 'variant_group_key' },
]

const SUPPLIER_SCRIPT_BASE_COLUMNS = [
  { name: 'external_id', key: 'external_id' }, { name: 'name', key: 'name' },
  { name: 'description', key: 'description' }, { name: 'price', key: 'price' },
  { name: 'brand', key: 'brand' }, { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' }, { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' }, { name: 'status', key: 'status' },
  { name: 'h1', key: 'h1' }, { name: 'seo_title', key: 'seo_title' },
  { name: 'seo_description', key: 'seo_description' }, { name: 'ai_processed', key: 'ai_processed' },
  { name: 'variant_group_key', key: 'variant_group_key' },
]

function normalizePhotos(value: any): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return normalizePhotos(parsed)
    } catch {
      return trimmed
        .split(/[|,;]/)
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
  }
  return []
}

function normalizeBrand(value: any): string {
  if (Array.isArray(value)) return value.filter(Boolean)[0] ? String(value.filter(Boolean)[0]) : ''
  if (value === undefined || value === null) return ''
  return String(value)
}

function normalizeBatchProduct(row: any): CsvProduct {
  return {
    id: row.id,
    external_id: row.external_id || '',
    name: row.name || '',
    description: row.description || '',
    h1: row.h1 || '',
    seo_title: row.seo_title || '',
    seo_description: row.seo_description || '',
    slug: row.slug || '',
    photo_alts: Array.isArray(row.photo_alts) ? row.photo_alts.map(String) : [],
    photo_slugs: Array.isArray(row.photo_slugs) ? row.photo_slugs.map(String) : [],
    price: Number(row.price || 0),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    brand: normalizeBrand(row.brand),
    category: row.category || '',
    subcategory: row.subcategory || '',
    gender: row.gender || '',
    photos: normalizePhotos(row.photos),
    batchId: row.batch_id || row.batchId,
    // Batch rows already contain the canonical JSONB payload. Re-parsing the
    // description here could turn a bag model size (for example 25) into a
    // clothing/shoe variant size every time the page is opened.
    attributes: normalizeProductAttributes(row.attributes),
    ai_processed: row.ai_processed === true || row.ai_processed === 'true',
    ai_sampled: row.ai_sampled === true || row.ai_sampled === 'true',
    price_source: row.price_source || 'legacy',
    variant_group_key: row.variant_group_key || null,
    ai_error: row.ai_error || null,
    ai_confidence: row.ai_confidence === null || row.ai_confidence === undefined ? null : Number(row.ai_confidence),
    source_position: row.source_position === null || row.source_position === undefined ? null : Number(row.source_position),
  }
}

function serializeProductsToCsv(products: any[], columns = BATCH_PRODUCT_COLUMNS, delimiter = ';') {
  const effectiveColumns = columns.some((column) => column.key === 'attributes') || !products.some((product) => hasProductAttributes(product.attributes))
    ? columns
    : [...columns, { name: 'attributes', key: 'attributes' }]
  const header = effectiveColumns.map((c) => c.name).join(delimiter)
  const rows = products.map((p) => effectiveColumns.map((col) => {
    let val = p[col.key]
    if ((val === undefined || val === null) && p.attributes && typeof p.attributes === 'object') val = p.attributes[col.key]
    if (val === undefined || val === null) val = ''
    if (Array.isArray(val)) val = JSON.stringify(val)
    if (col.key === 'attributes' && typeof val === 'object' && val !== null) val = JSON.stringify(normalizeProductAttributes(val))
    if (typeof val === 'boolean') val = val ? 'true' : 'false'
    if (typeof val === 'string') val = val.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n')
    const str = String(val).replace(/"/g, '""')
    return str.includes(delimiter) || str.includes('"') ? `"${str}"` : str
  }).join(delimiter))
  return [header, ...rows].join('\n')
}

function supplierScriptColumns(products: any[]) {
  const keys = new Set<string>()
  for (const product of products) {
    for (const key of Object.keys(normalizeProductAttributes(product.attributes))) {
      if (!SUPPLIER_SCRIPT_BASE_COLUMNS.some((column) => column.key === key)) keys.add(key)
    }
  }
  return [
    ...SUPPLIER_SCRIPT_BASE_COLUMNS,
    ...[...keys].sort().map((key) => ({ name: key, key })),
    { name: 'attributes', key: 'attributes' },
  ]
}

function getWritableTmpDir() {
  const path = require('path')
  const os = require('os')

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return os.tmpdir()
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp')
}

function parseServerCsv(text: string): CsvProduct[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = normalizedText.split('\n')[0] || ''
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i]
    const nextChar = normalizedText[i + 1]
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else if (char === '"' && currentField.trim().length === 0) {
      inQuotes = true
      currentField = ''
    } else if (char === delimiter) {
      currentRow.push(currentField.trim())
      currentField = ''
    } else if (char === '\n') {
      currentRow.push(currentField.trim())
      if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
      currentRow = []
      currentField = ''
    } else {
      currentField += char
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some((value) => value.trim() !== '')) rows.push(currentRow)
  }

  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.toLowerCase().trim())
  return rows.slice(1).map((values) => {
    const row: any = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    return normalizeBatchProduct(row)
  }).filter((product) => product.external_id || product.name)
}

/**
 * Загрузка справочников для импорта
 */
export async function fetchLookupsAction(referenceIds?: {
  brands?: string[]
  categories?: string[]
  subcategories?: string[]
}) {
  await requireAdmin()
  const lookups = await getRailsCatalogLookups().catch(() => ({ brands: [], categories: [], subcategories: [] }))
  const references = {
    brand: [...new Set((referenceIds?.brands || []).map(String).filter(Boolean))],
    category: [...new Set((referenceIds?.categories || []).map(String).filter(Boolean))],
    subcategory: [...new Set((referenceIds?.subcategories || []).map(String).filter(Boolean))],
  }
  const requested = [...new Set([...references.brand, ...references.category, ...references.subcategory])]
  if (!requested.length) return lookups

  const mappings = await scrapingQuery(`
    SELECT entity_type,legacy_id,canonical_id,name,legacy_parent_id,canonical_parent_id
    FROM catalog_id_mappings
    WHERE legacy_id=ANY($1::text[]) OR canonical_id=ANY($1::text[])
  `, [requested])
  const merge = (items: any[], type: 'brand' | 'category' | 'subcategory', ids: string[]) => {
    const byId = new Map(items.map((item) => [String(item.id), item]))
    for (const id of ids) {
      if (byId.has(id)) continue
      const mapping = mappings.rows.find((row) => row.entity_type === type && [row.legacy_id, row.canonical_id].map(String).includes(id))
      if (!mapping) continue
      byId.set(id, {
        id,
        name: String(mapping.name || id),
        ...(type === 'subcategory' ? {
          category: id === String(mapping.legacy_id)
            ? String(mapping.legacy_parent_id || mapping.canonical_parent_id || '')
            : String(mapping.canonical_parent_id || ''),
        } : {}),
      })
    }
    return [...byId.values()]
  }

  return {
    brands: merge(lookups.brands, 'brand', references.brand),
    categories: merge(lookups.categories, 'category', references.category),
    subcategories: merge(lookups.subcategories, 'subcategory', references.subcategory),
  }
}

/**
 * Массовая загрузка товаров из CSV в Postgres
 */
export async function pushCsvProductsAction(products: CsvProduct[]) {
    try {
        await requireAdmin()

        const results = { success: 0, failed: 0, errors: [] as string[] }

        const processPromises = products.map(async (p) => {
            try {
                // Загружаем и заменяем фото на s3 параллельно
                const photoPromises = (p.photos || []).map(async (url, i) => {
                    if (!url) return null;
                    
                    if (url.includes('beget.app') || url.includes('selcloud.ru') || url.includes('beget.cloud') || url.includes('yeezyunique.ru')) {
                        return url;
                    }

                    try {
                        const res = await fetch(url);
                        if (res.ok) {
                            const arrayBuffer = await res.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer);
                            const key = `batches/${p.batchId || 'no_batch'}/${p.external_id}_${i}.jpg`;
                            return await uploadToS3(key, buffer);
                        } else {
                            return url;
                        }
                    } catch (err) {
                        console.error(`S3 Upload Error for ${url}:`, err);
                        return url;
                    }
                });
                
                const resolvedPhotos = await Promise.all(photoPromises);
                p.photos = resolvedPhotos.filter(Boolean) as string[];

                // Генерация ID в стиле Pocketbase (15 символов), если это новый товар
                const id = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 9);

                // SQL запрос "Вставь, если нет, иначе обнови" (UPSERT) по полю external_id
                const sql = `
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
                `
                
                // Обрабатываем бренд (в CSV он может быть строкой или массивом)
                const brandArray = Array.isArray(p.brand) ? p.brand : (p.brand ? [p.brand] : [])

                await query(sql, [
                    id, p.external_id, p.name, p.description || '', p.price || 0,
                    p.status || 'active', brandArray, p.category, 
                    p.subcategory || null, p.gender || '', JSON.stringify(p.photos || []),
                    p.batchId || null
                ])

                return { success: true, product: p };
            } catch (err: any) {
                return { success: false, error: `${p.external_id}: ${err.message}`, product: p };
            }
        });

        const chunkResults = await Promise.all(processPromises);

        const updatedProducts: CsvProduct[] = [];
        for (const res of chunkResults) {
            if (res.success) {
                results.success++;
                updatedProducts.push(res.product!);
            } else {
                results.failed++;
                results.errors.push(res.error!);
                updatedProducts.push(res.product!);
            }
        }

        // Чистим кеш после импорта
        try {
            await redis.del('catalog:all')
        } catch (redisErr: any) {
            console.warn('Redis clear cache error:', redisErr.message)
        }
        revalidatePath('/admin')
        
        return { 
            success: true, 
            data: { 
                ...results, 
                updatedProducts: updatedProducts
            } 
        }
    } catch (error: any) {
        console.error('CSV import error:', error)
        return { success: false, error: 'Ошибка при импорте' }
    }
}

// Функции для работы с локальными файлами
export async function readLocalCsvAction(filePath: string) {
  await requireAdmin()

  const fs = require('fs/promises');
  try {
    const cleanPath = filePath.replace(/"/g, '');
    const dbFile = await getScrapingFileArtifact(cleanPath);
    if (dbFile?.content) {
      return { success: true, content: dbFile.content, source: 'db' };
    }

    const buffer = await fs.readFile(/*turbopackIgnore: true*/ resolveSafeRuntimePath(cleanPath));
    
    // Пробуем разные кодировки
    const encodings = ['utf-8', 'gbk', 'windows-1251'];
    let content = '';
    let success = false;

    for (const enc of encodings) {
        try {
            const decoder = new TextDecoder(enc, { fatal: true });
            content = decoder.decode(buffer);
            success = true;
            console.log(`[CSV Read] Successfully decoded with ${enc}`);
            break;
        } catch (e) {
            continue;
        }
    }

    if (!success) {
        // Если ничего не подошло, читаем как utf-8 с заменой битых символов (лучше чем ничего)
        content = new TextDecoder('utf-8').decode(buffer);
    }

    return { success: true, content };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveLocalCsvAction(filePath: string, products: any[], columns: { name: string, key: string }[], delimiter: string = ',') {
  await requireAdmin()

  const fs = require('fs/promises');
  try {
    const safePath = resolveSafeRuntimePath(filePath);

    // Формируем CSV строку
    // 1. Заголовки (используем оригинальные имена из файла)
    const effectiveColumns = columns.some((column) => column.key === 'attributes') || !products.some((product) => {
      const attributes = normalizeProductAttributes(product.attributes)
      return Object.keys(attributes).some((key) => !columns.some((column) => column.key === key))
    })
      ? columns
      : [...columns, { name: 'attributes', key: 'attributes' }]

    const header = effectiveColumns.map(c => c.name).join(delimiter);
    
    // 2. Строки данных
    const rows = products.map(p => {
      return effectiveColumns.map(col => {
        let val = p[col.key]; // Используем внутренний ключ для получения значения
        if (val === undefined || val === null) val = '';
        
        // Если это массив (например, фото), превращаем в JSON-строку
        if (Array.isArray(val)) val = JSON.stringify(val);
        if (col.key === 'attributes' && typeof val === 'object' && val !== null) {
          val = JSON.stringify(normalizeProductAttributes(val))
        }
        
        // Специфичное правило пользователя: заменять реальные переносы строк на текст \n
        if (typeof val === 'string') {
          val = val.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
        }
        
        // Экранируем кавычки
        const str = String(val).replace(/"/g, '""');
        // Оборачиваем в кавычки, если значение содержит разделитель или кавычки
        if (str.includes(delimiter) || str.includes('"')) {
          return `"${str}"`;
        }
        return str;
      }).join(delimiter);
    });

    const csvContent = [header, ...rows].join('\n');
    
    // Попытки записи (важно для Windows, если файл временно занят другим процессом)
    let attempts = 3;
    while (attempts > 0) {
      try {
        await fs.writeFile(/*turbopackIgnore: true*/ safePath, csvContent, 'utf-8');
        return { success: true };
      } catch (writeErr: any) {
        attempts--;
        if (writeErr.code === 'EBUSY' || writeErr.code === 'EPERM') {
          console.warn(`[CSV Save] File busy, retrying in 500ms... (${attempts} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
          if (attempts === 0) throw writeErr;
        } else {
          throw writeErr;
        }
      }
    }
    
    return { success: false, error: 'Не удалось сохранить файл после нескольких попыток' };
  } catch (err: any) {
    console.error('Save CSV error details:', {
      code: err.code,
      path: err.path,
      message: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function getBatchProductsAction(batchId: string, snapshotId?: string | null) {
  try {
    await requireAdmin()

    if (snapshotId) {
      const snapshot = await scrapingQuery(`
        SELECT stage,label,products
        FROM batch_snapshots
        WHERE id=$1 AND batch_id=$2
        LIMIT 1
      `, [snapshotId, batchId])
      if (!snapshot.rows[0]) throw new Error('Снимок этапа не найден')
      const products = Array.isArray(snapshot.rows[0].products) ? snapshot.rows[0].products : []
      return {
        success: true,
        data: {
          products: products.map(normalizeBatchProduct),
          columns: BATCH_PRODUCT_COLUMNS,
          delimiter: ';',
          stage: snapshot.rows[0].stage || 'SCRAPED',
          snapshot: true,
          label: snapshot.rows[0].label || 'Снимок этапа',
        },
      }
    }

    let res = await scrapingQuery(`
      SELECT p.id, p.external_id, p.name, p.description, p.h1, p.seo_title, p.seo_description, p.slug, p.photo_alts, p.photo_slugs,
        p.price, p.price_source, p.status, p.brand, p.category, p.subcategory, p.gender,
        p.photos, p.attributes, p.batch_id, p.ai_processed, p.variant_group_key, p.ai_error,
        p.ai_confidence, p.source_position, p.created_at, p.updated_at,
        EXISTS (
          SELECT 1 FROM batch_ai_items i
          JOIN batch_ai_runs r ON r.id=i.run_id
          WHERE i.product_id=p.id AND r.batch_id=p.batch_id AND r.mode='sample'
        ) AS ai_sampled
      FROM products p
      WHERE p.batch_id = $1
      ORDER BY p.source_position ASC NULLS LAST, p.id ASC
    `, [batchId])

    const batch = await scrapingQuery('SELECT stage FROM scraping_batches WHERE id=$1', [batchId])
    return {
      success: true,
      data: {
        products: res.rows.map(normalizeBatchProduct),
        columns: BATCH_PRODUCT_COLUMNS,
        delimiter: ';',
        stage: batch.rows[0]?.stage || 'SCRAPED',
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

async function upsertBatchProduct(client: any, batchId: string, product: any, position: number) {
  const normalized = normalizeBatchProduct({
    ...product,
    batch_id: batchId,
    source_position: product.source_position ?? position,
  })
  const numericId = normalized.id !== undefined && normalized.id !== null && String(normalized.id).match(/^\d+$/)
    ? Number(normalized.id)
    : null

  if (numericId) {
    const updateRes = await client.query(`
      UPDATE products
      SET external_id=$1, name=$2, description=$3, h1=$4, seo_title=$5, seo_description=$6,
          price=$7, price_source=$8, status=$9, brand=$10, category=$11, subcategory=$12, gender=$13,
          photos=$14::jsonb, slug=$15, photo_alts=$16::jsonb, photo_slugs=$17::jsonb, attributes=$18::jsonb, ai_processed=$19, batch_id=$20,
          variant_group_key=$21, ai_error=$22, ai_confidence=$23, source_position=$24, updated_at=NOW()
      WHERE id=$25 AND batch_id=$20
      RETURNING id
    `, [
      normalized.external_id,
      normalized.name,
      normalized.description,
      normalized.h1 || null,
      normalized.seo_title || null,
      normalized.seo_description || null,
      normalized.price,
      normalized.price_source || 'legacy',
      normalized.status,
      normalized.brand,
      normalized.category,
      normalized.subcategory || null,
      normalized.gender,
      JSON.stringify(normalized.photos || []),
      normalized.slug || null,
      JSON.stringify(normalized.photo_alts || []),
      JSON.stringify(normalized.photo_slugs || []),
      JSON.stringify(normalized.attributes || {}),
      normalized.ai_processed === true || normalized.ai_processed === 'true',
      batchId,
      normalized.variant_group_key || null,
      normalized.ai_error || null,
      normalized.ai_confidence ?? null,
      normalized.source_position,
      numericId,
    ])
    if (updateRes.rowCount > 0) return updateRes.rows[0].id
  }

  const insertRes = await client.query(`
    INSERT INTO products (external_id, name, description, h1, seo_title, seo_description, price, price_source, status, brand, category, subcategory, gender, photos, slug, photo_alts, photo_slugs, attributes, ai_processed, batch_id, variant_group_key, ai_error, ai_confidence, source_position, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,NOW(),NOW())
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
      slug = EXCLUDED.slug,
      photo_alts = EXCLUDED.photo_alts,
      photo_slugs = EXCLUDED.photo_slugs,
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
    normalized.h1 || null,
    normalized.seo_title || null,
    normalized.seo_description || null,
    normalized.price,
    normalized.price_source || 'legacy',
    normalized.status,
    normalized.brand,
    normalized.category,
    normalized.subcategory || null,
    normalized.gender,
    JSON.stringify(normalized.photos || []),
    normalized.slug || null,
    JSON.stringify(normalized.photo_alts || []),
    JSON.stringify(normalized.photo_slugs || []),
    JSON.stringify(normalized.attributes || {}),
    normalized.ai_processed === true || normalized.ai_processed === 'true',
    batchId,
    normalized.variant_group_key || null,
    normalized.ai_error || null,
    normalized.ai_confidence ?? null,
    normalized.source_position,
  ])

  return insertRes.rows[0]?.id
}

export async function saveBatchProductsAction(
  batchId: string,
  products: any[],
  operationOwnerId?: string | null,
  finalizeScript?: { supplierId: number },
) {
  await requireAdmin()
  const activeRun = await scrapingQuery("SELECT 1 FROM batch_ai_runs WHERE batch_id=$1 AND status IN ('queued','running') LIMIT 1", [batchId])
  if (activeRun.rows[0]) return { success: false, error: 'Нельзя сохранять партию во время AI-обработки' }
  const operation = await scrapingQuery('SELECT operation,owner_id FROM batch_operation_locks WHERE batch_id=$1', [batchId])
  if (operation.rows[0] && operation.rows[0].owner_id !== operationOwnerId) {
    return { success: false, error: `Выгрузка занята операцией: ${operation.rows[0].operation}` }
  }

  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const mappingResult = await client.query(`
      SELECT entity_type, legacy_id, canonical_id, name, canonical_parent_id
      FROM catalog_id_mappings
    `)
    const normalizedProducts = normalizeProductsCatalogReferences(
      products,
      mappingResult.rows as CatalogIdMapping[],
    )
    const keptIds: number[] = []

    for (let position = 0; position < normalizedProducts.length; position++) {
      const product = normalizedProducts[position]
      const savedId = await upsertBatchProduct(client, batchId, product, position)
      if (savedId) keptIds.push(Number(savedId))
    }

    if (keptIds.length > 0) {
      await client.query('DELETE FROM products WHERE batch_id=$1 AND NOT (id = ANY($2::int[]))', [batchId, keptIds])
    } else {
      await client.query('DELETE FROM products WHERE batch_id=$1', [batchId])
    }

    let taskId: number | undefined
    if (finalizeScript) {
      await client.query("UPDATE scraping_batches SET items_count=$1,stage='SCRIPT_PROCESSED',updated_at=NOW() WHERE id=$2", [normalizedProducts.length, batchId])
      await client.query(`
        INSERT INTO batch_snapshots(id,batch_id,stage,label,products,settings_snapshot)
        SELECT $1,$2,'SCRIPT_PROCESSED','Обработан скриптом',payload,'{}'::jsonb
        FROM (
          SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.source_position NULLS LAST,p.id),'[]'::jsonb) AS payload
          FROM products p WHERE p.batch_id=$2
        ) current
        WHERE NOT EXISTS (
          SELECT 1 FROM batch_snapshots s
          WHERE s.batch_id=$2 AND s.stage='SCRIPT_PROCESSED' AND s.label='Обработан скриптом' AND s.products=current.payload
        )
      `, [crypto.randomUUID(), batchId])
      const task = await client.query(`
        INSERT INTO scraping_tasks(supplier_id,batch_id,status,result_path,items_count,updated_at)
        VALUES($1,$2,'Обработано скриптом',$3,$4,NOW()) RETURNING id
      `, [finalizeScript.supplierId, batchId, `db://batch/${batchId}/script`, normalizedProducts.length])
      taskId = Number(task.rows[0]?.id)
    } else {
      await client.query('UPDATE scraping_batches SET items_count=$1,updated_at=NOW() WHERE id=$2', [normalizedProducts.length, batchId])
    }
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    revalidatePath('/admin/scraping')
    return { success: true, data: { count: normalizedProducts.length, taskId } }
  } catch (err: any) {
    await client.query('ROLLBACK')
    return { success: false, error: err.message }
  } finally {
    client.release()
  }
}

export async function updateBatchProductAction(identifier: string | number, patch: Partial<CsvProduct>, batchId?: string | null) {
  try {
    await requireAdmin()
    if (!batchId) return { success: false, error: 'Для изменения товара требуется batchId' }
    if (await activeBatchOperation(batchId)) return { success: false, error: 'Нельзя менять товар во время обработки выгрузки' }

    const keys = Object.keys(patch).filter((key) => [
      'external_id',
      'name',
      'description',
      'h1',
      'seo_title',
      'seo_description',
      'price',
      'status',
      'brand',
      'category',
      'subcategory',
      'gender',
      'photos',
      'attributes',
      'ai_processed',
      'variant_group_key',
      'ai_error',
      'ai_confidence',
    ].includes(key))

    if (keys.length === 0) return { success: true }

    const values: any[] = []
    const setClauses = keys.map((key, index) => {
      let value = (patch as any)[key]
      if (key === 'photos') value = JSON.stringify(normalizePhotos(value))
      if (key === 'attributes') value = JSON.stringify(normalizeProductAttributes(value))
      if (key === 'brand') value = normalizeBrand(value)
      if (key === 'ai_processed') value = value === true || value === 'true'
      values.push(value)
      return key === 'photos' || key === 'attributes'
        ? `${key}=$${index + 1}::jsonb`
        : `${key}=$${index + 1}`
    })
    if (keys.includes('price')) setClauses.push("price_source='manual'")

    const isNumericId = String(identifier).match(/^\d+$/)
    values.push(identifier)
    let where = isNumericId ? `id=$${values.length}` : `external_id=$${values.length}`
    if (batchId) {
      values.push(batchId)
      where += ` AND batch_id=$${values.length}`
    }

    await scrapingQuery(`
      UPDATE products
      SET ${setClauses.join(', ')}, updated_at=NOW()
      WHERE ${where}
    `, values)

    revalidatePath('/admin/batches')
    revalidatePath('/admin/scraping')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function deleteBatchProductAction(identifier: string | number, batchId?: string | null) {
  try {
    await requireAdmin()
    if (!batchId) return { success: false, error: 'Для удаления товара требуется batchId' }
    if (await activeBatchOperation(batchId)) return { success: false, error: 'Нельзя удалять товар во время обработки выгрузки' }

    const isNumericId = String(identifier).match(/^\d+$/)
    const values: any[] = [identifier]
    let where = isNumericId ? 'id=$1' : 'external_id=$1'
    if (batchId) {
      values.push(batchId)
      where += ' AND batch_id=$2'
    }

    await scrapingQuery(`DELETE FROM products WHERE ${where}`, values)
    if (batchId) {
      await scrapingQuery('UPDATE scraping_batches SET items_count=(SELECT COUNT(*) FROM products WHERE batch_id=$1), updated_at=NOW() WHERE id=$1', [batchId])
    }
    revalidatePath('/admin/batches')
    revalidatePath('/admin/scraping')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function exportBatchProductsCsvAction(batchId: string): Promise<any> {
  try {
    await requireAdmin()

    const res = await getBatchProductsAction(batchId)
    if (!res.success || !res.data) return res
    return {
      success: true,
      data: {
        fileName: `batch_${batchId}.csv`,
        content: serializeProductsToCsv(res.data.products, BATCH_PRODUCT_COLUMNS, ';'),
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Записывает результат работы ИИ в новую задачу (History) и обновляет статус партии
 */
export async function recordAiTaskAction({
  supplierId,
  batchId,
  products,
  columns,
  delimiter
}: {
  supplierId: number | null,
  batchId: string | null,
  products: any[],
  columns: any[],
  delimiter: string
}) {
  try {
    await requireAdmin()

    if (!supplierId) throw new Error("Missing supplierId");
    if (!batchId) throw new Error("AI-этап можно записать только в связанную партию");
    if (await activeBatchOperation(batchId)) throw new Error('Выгрузка занята другой операцией')

    const client = await getScrapingClient()
    try {
      await client.query('BEGIN')
      const state = await client.query(`
        SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE COALESCE(ai_processed,false)=false)::int AS remaining
        FROM products WHERE batch_id=$1
      `, [batchId])
      if (!Number(state.rows[0]?.total) || Number(state.rows[0]?.remaining)) {
        throw new Error('Нельзя записать AI-этап: часть товаров не обработана')
      }

      const resultPath = `db://batch/${batchId}/ai`;
      const taskRes = await client.query(`
        INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id
      `, [supplierId, batchId, 'Обработано ИИ', resultPath, Number(state.rows[0].total)]);
      await client.query("UPDATE scraping_batches SET stage='AI_PROCESSED',updated_at=NOW() WHERE id=$1", [batchId]);
      await client.query('COMMIT')

      revalidatePath('/admin/scraping');
      revalidatePath('/admin/batches');

      return { success: true, path: resultPath, taskId: taskRes.rows[0].id };
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (err: any) {
    console.error('Record AI task error:', err);
    return { success: false, error: err.message };
  }
}

export async function getSupplierDataAction(supplierId: number) {
    await requireAdmin()

    try {
        const res = await scrapingQuery('SELECT album_id, post_process_script, post_process_enabled, ai_parallel_enabled, ai_parallel_count FROM suppliers WHERE id=$1', [supplierId]);
        if (res.rows.length > 0) return res.rows[0];
        return null;
    } catch (err) {
        return null;
    }
}

export async function runCustomSupplierScriptAction(inputPath: string | null, supplierId: number, batchId?: string | null): Promise<any> {
  let operationOwnerId: string | null = null
  try {
    await requireAdmin()

    const supplierRes = await scrapingQuery('SELECT album_id, post_process_script FROM suppliers WHERE id=$1', [supplierId]);
    if (!supplierRes.rows.length) throw new Error("Поставщик не найден");
    const supplierData = supplierRes.rows[0];
    supplierData.post_process_script = String(supplierData.post_process_script || '').trim();

    if (!supplierData.post_process_script) {
        throw new Error("Скрипт не назначен для этого поставщика");
    }
    if (!batchId) throw new Error("Для JSON-обработки требуется batchId");
    operationOwnerId = await claimBatchOperation(batchId, 'script')
    if (!operationOwnerId) throw new Error('Выгрузка уже обрабатывается другим процессом')

    const currentRes = await getBatchProductsAction(batchId);
    if (!currentRes.success || !currentRes.data) {
      throw new Error(currentRes.error || "Не удалось загрузить товары партии");
    }

    const rawSnapshot = await scrapingQuery(`
      SELECT products
      FROM batch_snapshots
      WHERE batch_id=$1 AND stage='SCRAPED'
      ORDER BY created_at ASC
      LIMIT 1
    `, [batchId]);
    const currentProducts = currentRes.data.products || [];
    const sourceProducts = Array.isArray(rawSnapshot.rows[0]?.products)
      ? rawSnapshot.rows[0].products
      : currentProducts;
    if (sourceProducts.length === 0) throw new Error("В партии нет товаров");

    const { runSupplierJsonProcess } = require('../scripts/lib/supplier-json-process');
    const processedProducts = await runSupplierJsonProcess(
      supplierData.post_process_script,
      sourceProducts,
    );
    if (!Array.isArray(processedProducts) || processedProducts.length === 0) {
      throw new Error("Скрипт вернул пустой массив товаров");
    }

    const originalByExternalId = new Map(
      sourceProducts.map((product: any, position: number) => [
        String(product.external_id),
        { ...product, source_position: product.source_position ?? position },
      ]),
    );
    for (let position = 0; position < processedProducts.length; position++) {
      const processedProduct = processedProducts[position];
      const original: any = originalByExternalId.get(String(processedProduct.external_id));
      if (Object.keys(processedProduct.attributes || {}).length === 0 && original?.attributes) {
        processedProduct.attributes = original.attributes;
      }
      processedProduct.source_position = original?.source_position ?? position;
      processedProduct.price_source = original && Number(processedProduct.price) !== Number(original.price)
        ? 'script'
        : (original?.price_source || 'default');
    }

    const saveRes = await saveBatchProductsAction(batchId, processedProducts, operationOwnerId, { supplierId });
    if (!saveRes.success) throw new Error(saveRes.error);

    revalidatePath('/admin/scraping');
    revalidatePath('/admin/batches');
    return {
      success: true,
      path: `db://batch/${batchId}/script`,
      taskId: saveRes.data?.taskId,
      count: processedProducts.length,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    if (batchId && operationOwnerId) await releaseBatchOperation(batchId, operationOwnerId).catch(() => undefined)
  }
}

export async function assignBatchVariantFamilyAction(
  batchId: string,
  productIds: number[],
  targetProductId?: number | null,
) {
  await requireAdmin()
  if (await activeBatchOperation(batchId)) return { success: false, error: 'Нельзя менять варианты во время обработки выгрузки' }
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))]
  if (!ids.length) return { success: false, error: 'Выберите товары' }
  if (!targetProductId && ids.length < 2) return { success: false, error: 'Для новой семьи выберите минимум два товара' }

  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      'SELECT id FROM products WHERE batch_id=$1 AND id=ANY($2::int[]) FOR UPDATE',
      [batchId, ids],
    )
    if (selected.rowCount !== ids.length) throw new Error('Часть выбранных товаров не найдена в этой выгрузке')

    let groupKey = ''
    if (targetProductId) {
      const target = await client.query(
        'SELECT variant_group_key FROM products WHERE batch_id=$1 AND id=$2 FOR UPDATE',
        [batchId, Number(targetProductId)],
      )
      groupKey = String(target.rows[0]?.variant_group_key || '').trim()
      if (!/^[0-9a-f]{32}$/i.test(groupKey)) throw new Error('У выбранного товара нет подтверждённой цветовой семьи')
    } else {
      groupKey = crypto.randomBytes(16).toString('hex')
    }

    await client.query(
      'UPDATE products SET variant_group_key=$1,updated_at=NOW() WHERE batch_id=$2 AND id=ANY($3::int[])',
      [groupKey, batchId, ids],
    )
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    return { success: true, data: { groupKey } }
  } catch (error: any) {
    await client.query('ROLLBACK')
    return { success: false, error: error.message }
  } finally {
    client.release()
  }
}

export async function detachBatchVariantProductAction(batchId: string, productId: number) {
  try {
    await requireAdmin()
    if (await activeBatchOperation(batchId)) return { success: false, error: 'Нельзя менять варианты во время обработки выгрузки' }
    await scrapingQuery(
      'UPDATE products SET variant_group_key=NULL,updated_at=NOW() WHERE batch_id=$1 AND id=$2',
      [batchId, Number(productId)],
    )
    revalidatePath('/admin/batches')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

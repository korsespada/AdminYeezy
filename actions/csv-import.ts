'use server'

import { query, scrapingQuery, getScrapingClient, redis, elastic } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { uploadToS3 } from '@/lib/s3'
import { getScrapingFileArtifact, saveScrapingFileArtifact } from '@/lib/scraping-files'
import { requireAdmin } from '@/lib/admin-session'
import { resolveSafeRuntimePath } from '@/lib/runtime-paths'

export interface CsvProduct {
    id?: string | number
    external_id: string
    name: string
    description: string
    price: number
    status: 'active' | 'inactive'
    brand: string
    category: string
    subcategory: string
    photos: string[]
    gender?: string
    batchId?: string
    ai_processed?: boolean | string
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
  { name: 'price', key: 'price' },
  { name: 'status', key: 'status' },
  { name: 'brand', key: 'brand' },
  { name: 'category', key: 'category' },
  { name: 'subcategory', key: 'subcategory' },
  { name: 'gender', key: 'gender' },
  { name: 'photos', key: 'photos' },
  { name: 'ai_processed', key: 'ai_processed' },
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
    price: Number(row.price || 0),
    status: row.status === 'inactive' ? 'inactive' : 'active',
    brand: normalizeBrand(row.brand),
    category: row.category || '',
    subcategory: row.subcategory || '',
    gender: row.gender || '',
    photos: normalizePhotos(row.photos),
    batchId: row.batch_id || row.batchId,
    ai_processed: row.ai_processed === true || row.ai_processed === 'true',
  }
}

function serializeProductsToCsv(products: any[], columns = BATCH_PRODUCT_COLUMNS, delimiter = ';') {
  const header = columns.map((c) => c.name).join(delimiter)
  const rows = products.map((p) => columns.map((col) => {
    let val = p[col.key]
    if (val === undefined || val === null) val = ''
    if (Array.isArray(val)) val = JSON.stringify(val)
    if (typeof val === 'boolean') val = val ? 'true' : 'false'
    if (typeof val === 'string') val = val.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n')
    const str = String(val).replace(/"/g, '""')
    return str.includes(delimiter) || str.includes('"') ? `"${str}"` : str
  }).join(delimiter))
  return [header, ...rows].join('\n')
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
export async function fetchLookupsAction() {
    await requireAdmin()

    const [brands, categories, subcategories] = await Promise.all([
        query('SELECT * FROM brands ORDER BY name ASC'),
        query('SELECT * FROM categories ORDER BY name ASC'),
        query('SELECT * FROM subcategories ORDER BY name ASC'),
    ])
    return { 
        brands: brands.rows, 
        categories: categories.rows, 
        subcategories: subcategories.rows 
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
    const header = columns.map(c => c.name).join(delimiter);
    
    // 2. Строки данных
    const rows = products.map(p => {
      return columns.map(col => {
        let val = p[col.key]; // Используем внутренний ключ для получения значения
        if (val === undefined || val === null) val = '';
        
        // Если это массив (например, фото), превращаем в JSON-строку
        if (Array.isArray(val)) val = JSON.stringify(val);
        
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

export async function getBatchProductsAction(batchId: string) {
  try {
    await requireAdmin()

    const res = await scrapingQuery(`
      SELECT id, external_id, name, description, price, status, brand, category, subcategory, gender, photos, batch_id, ai_processed, created_at, updated_at
      FROM products
      WHERE batch_id = $1
      ORDER BY id ASC
    `, [batchId])

    return {
      success: true,
      data: {
        products: res.rows.map(normalizeBatchProduct),
        columns: BATCH_PRODUCT_COLUMNS,
        delimiter: ';',
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

async function upsertBatchProduct(client: any, batchId: string, product: any) {
  const normalized = normalizeBatchProduct({ ...product, batch_id: batchId })
  const numericId = normalized.id !== undefined && normalized.id !== null && String(normalized.id).match(/^\d+$/)
    ? Number(normalized.id)
    : null

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
      normalized.ai_processed === true || normalized.ai_processed === 'true',
      batchId,
      numericId,
    ])
    if (updateRes.rowCount > 0) return updateRes.rows[0].id
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
    normalized.ai_processed === true || normalized.ai_processed === 'true',
    batchId,
  ])

  return insertRes.rows[0]?.id
}

export async function saveBatchProductsAction(batchId: string, products: any[]) {
  await requireAdmin()

  const client = await getScrapingClient()
  try {
    await client.query('BEGIN')
    const keptIds: number[] = []

    for (const product of products) {
      const savedId = await upsertBatchProduct(client, batchId, product)
      if (savedId) keptIds.push(Number(savedId))
    }

    if (keptIds.length > 0) {
      await client.query('DELETE FROM products WHERE batch_id=$1 AND NOT (id = ANY($2::int[]))', [batchId, keptIds])
    } else {
      await client.query('DELETE FROM products WHERE batch_id=$1', [batchId])
    }

    await client.query('UPDATE scraping_batches SET items_count=$1, updated_at=NOW() WHERE id=$2', [products.length, batchId])
    await client.query('COMMIT')
    revalidatePath('/admin/batches')
    revalidatePath('/admin/scraping')
    return { success: true, data: { count: products.length } }
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

    const keys = Object.keys(patch).filter((key) => [
      'external_id',
      'name',
      'description',
      'price',
      'status',
      'brand',
      'category',
      'subcategory',
      'gender',
      'photos',
      'ai_processed',
    ].includes(key))

    if (keys.length === 0) return { success: true }

    const values: any[] = []
    const setClauses = keys.map((key, index) => {
      let value = (patch as any)[key]
      if (key === 'photos') value = JSON.stringify(normalizePhotos(value))
      if (key === 'brand') value = normalizeBrand(value)
      if (key === 'ai_processed') value = value === true || value === 'true'
      values.push(value)
      return key === 'photos'
        ? `${key}=$${index + 1}::jsonb`
        : `${key}=$${index + 1}`
    })

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

    // 1. Генерируем путь для нового AI-файла
    const taskId = Math.floor(Math.random() * 1000000); // Генерим ID для имени файла
    const fs = require('fs/promises');
    const path = require('path');
    const tmpDir = getWritableTmpDir();
    const outputFileName = `task_ai_${taskId}.csv`;
    const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, outputFileName);
    const csvContent = serializeProductsToCsv(products, columns, delimiter);

    // 2. Сохраняем файл во временную writable-директорию.
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ outputPath, csvContent, 'utf-8');

    // 3. Создаем запись в технической БД (scraping_tasks)
    const taskRes = await scrapingQuery(`
      INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `, [supplierId, batchId || null, 'Обработано ИИ', outputPath, products.length]);

    await saveScrapingFileArtifact({
      taskId: taskRes.rows[0].id,
      supplierId,
      batchId,
      status: 'Обработано ИИ',
      filePath: outputPath,
      content: csvContent,
    });

    // 4. Обновляем стадию партии (если она есть)
    if (batchId) {
      await scrapingQuery(`
        UPDATE scraping_batches SET stage = 'AI_PROCESSED' WHERE id = $1
      `, [batchId]);
    }

    revalidatePath('/admin/scraping');
    revalidatePath('/admin/batches');

    return { success: true, path: outputPath };
  } catch (err: any) {
    console.error('Record AI task error:', err);
    return { success: false, error: err.message };
  }
}

export async function getSupplierDataAction(supplierId: number) {
    await requireAdmin()

    try {
        const res = await scrapingQuery('SELECT album_id, post_process_script, ai_parallel_enabled, ai_parallel_count FROM suppliers WHERE id=$1', [supplierId]);
        if (res.rows.length > 0) return res.rows[0];
        return null;
    } catch (err) {
        return null;
    }
}

export async function runCustomSupplierScriptAction(inputPath: string | null, supplierId: number, batchId?: string | null): Promise<any> {
  try {
    await requireAdmin()

    const supplierRes = await scrapingQuery('SELECT album_id, post_process_script FROM suppliers WHERE id=$1', [supplierId]);
    if (!supplierRes.rows.length) throw new Error("Поставщик не найден");
    const supplierData = supplierRes.rows[0];

    if (!supplierData.post_process_script) {
        throw new Error("Скрипт не назначен для этого поставщика");
    }

    const { spawn } = require('child_process');
    const path = require('path');
    const fs = require('fs');
    
    const tmpDir = getWritableTmpDir();
    if (!fs.existsSync(/*turbopackIgnore: true*/ tmpDir)) {
        fs.mkdirSync(/*turbopackIgnore: true*/ tmpDir, { recursive: true });
    }
    const taskId = Math.floor(Math.random() * 1000000);
    let effectiveInputPath = inputPath ? resolveSafeRuntimePath(inputPath) : inputPath;
    const outputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `task_custom_${taskId}.csv`);

    if (batchId) {
        const batchRes = await getBatchProductsAction(batchId);
        if (!batchRes.success || !batchRes.data) {
            throw new Error(batchRes.error || "Не удалось загрузить товары партии");
        }
        effectiveInputPath = path.join(/*turbopackIgnore: true*/ tmpDir, `batch_${batchId}_custom_input_${taskId}.csv`);
        fs.writeFileSync(
            /*turbopackIgnore: true*/ effectiveInputPath,
            serializeProductsToCsv(batchRes.data.products, BATCH_PRODUCT_COLUMNS, ';'),
            'utf-8'
        );
    }

    if (!effectiveInputPath) throw new Error("Не указан CSV-файл или batchId");

    const parserDir = path.resolve(process.cwd(), 'scripts', 'parser');
    const pythonScript = path.resolve(parserDir, supplierData.post_process_script);
    if (!pythonScript.startsWith(`${parserDir}${path.sep}`)) {
      throw new Error("Недопустимый post-process скрипт");
    }
    
    return new Promise((resolve) => {
        const pythonProcess = spawn('python', [pythonScript, effectiveInputPath!, outputPath]);
        let stderr = '';
        
        pythonProcess.stderr.on('data', (data: any) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', async (code: number) => {
            if (code !== 0) {
                resolve({ success: false, error: stderr || `Exit code ${code}` });
            } else {
                // Подсчитываем товары в новом файле
                let itemsCount = 0;
                try {
                    if (fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
                        const content = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
                        const lines = content.split('\n').filter((l: string) => l.trim());
                        if (lines.length > 1) itemsCount = lines.length - 1;
                    }
                } catch (e) {
                    console.error("Error counting lines in custom script output:", e);
                }

                // Создаем запись в истории
                try {
                    const taskRes = await scrapingQuery(`
                        INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                        RETURNING id
                    `, [supplierId, batchId || null, 'Обработано скриптом', outputPath, itemsCount]);

                    await saveScrapingFileArtifact({
                        taskId: taskRes.rows[0].id,
                        supplierId,
                        batchId,
                        status: 'Обработано скриптом',
                        filePath: outputPath,
                    });

                    if (batchId && fs.existsSync(/*turbopackIgnore: true*/ outputPath)) {
                        const processedText = fs.readFileSync(/*turbopackIgnore: true*/ outputPath, 'utf-8');
                        const processedProducts = parseServerCsv(processedText);
                        const saveRes = await saveBatchProductsAction(batchId, processedProducts);
                        if (!saveRes.success) throw new Error(saveRes.error);
                        itemsCount = processedProducts.length;
                        await scrapingQuery(
                            'UPDATE scraping_tasks SET items_count=$1 WHERE result_path=$2',
                            [itemsCount, outputPath]
                        );
                    }
                    
                    revalidatePath('/admin/scraping');
                    revalidatePath('/admin/batches');
                } catch (dbErr) {
                    console.error("Error recording custom script task:", dbErr);
                    resolve({ success: false, error: dbErr instanceof Error ? dbErr.message : "Ошибка сохранения результата скрипта" });
                    return;
                }

                resolve({ success: true, path: outputPath });
            }
        });
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

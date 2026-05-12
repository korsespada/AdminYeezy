'use server'

import { query, scrapingQuery, redis, elastic } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { uploadToS3 } from '@/lib/s3'

export interface CsvProduct {
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
}

export interface Lookups {
    brands: any[]
    categories: any[]
    subcategories: any[]
}

/**
 * Загрузка справочников для импорта
 */
export async function fetchLookupsAction() {
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
  const fs = require('fs/promises');
  try {
    const buffer = await fs.readFile(filePath.replace(/"/g, ''));
    
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
  const fs = require('fs/promises');
  try {
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
        await fs.writeFile(filePath.replace(/"/g, ''), csvContent, 'utf-8');
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
    if (!supplierId) throw new Error("Missing supplierId");

    // 1. Генерируем путь для нового AI-файла
    const taskId = Math.floor(Math.random() * 1000000); // Генерим ID для имени файла
    const tmpDir = require('path').join(process.cwd(), 'tmp');
    const outputFileName = `task_ai_${taskId}.csv`;
    const outputPath = require('path').join(tmpDir, outputFileName);

    // 2. Сохраняем файл через уже готовую функцию
    const saveRes = await saveLocalCsvAction(outputPath, products, columns, delimiter);
    if (!saveRes.success) throw new Error(saveRes.error);

    // 3. Создаем запись в технической БД (scraping_tasks)
    await scrapingQuery(`
      INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [supplierId, batchId || null, 'Обработано ИИ', outputPath, products.length]);

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
    try {
        const res = await scrapingQuery('SELECT album_id, post_process_script, ai_parallel_enabled, ai_parallel_count FROM suppliers WHERE id=$1', [supplierId]);
        if (res.rows.length > 0) return res.rows[0];
        return null;
    } catch (err) {
        return null;
    }
}

export async function runCustomSupplierScriptAction(inputPath: string, supplierId: number, batchId?: string | null): Promise<any> {
  try {
    const supplierRes = await scrapingQuery('SELECT album_id, post_process_script FROM suppliers WHERE id=$1', [supplierId]);
    if (!supplierRes.rows.length) throw new Error("Поставщик не найден");
    const supplierData = supplierRes.rows[0];

    if (!supplierData.post_process_script) {
        throw new Error("Скрипт не назначен для этого поставщика");
    }

    const { spawn } = require('child_process');
    const path = require('path');
    const fs = require('fs');
    
    const tmpDir = path.join(process.cwd(), 'tmp');
    const taskId = Math.floor(Math.random() * 1000000);
    const outputPath = path.join(tmpDir, `task_custom_${taskId}.csv`);

    const pythonScript = path.join(process.cwd(), 'scripts', 'parser', supplierData.post_process_script);
    
    return new Promise((resolve) => {
        const pythonProcess = spawn('python', [pythonScript, inputPath, outputPath]);
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
                    if (fs.existsSync(outputPath)) {
                        const content = fs.readFileSync(outputPath, 'utf-8');
                        const lines = content.split('\n').filter((l: string) => l.trim());
                        if (lines.length > 1) itemsCount = lines.length - 1;
                    }
                } catch (e) {
                    console.error("Error counting lines in custom script output:", e);
                }

                // Создаем запись в истории
                try {
                    await scrapingQuery(`
                        INSERT INTO scraping_tasks (supplier_id, batch_id, status, result_path, items_count, updated_at)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                    `, [supplierId, batchId || null, 'Обработано скриптом', outputPath, itemsCount]);
                    
                    revalidatePath('/admin/scraping');
                    revalidatePath('/admin/batches');
                } catch (dbErr) {
                    console.error("Error recording custom script task:", dbErr);
                }

                resolve({ success: true, path: outputPath });
            }
        });
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

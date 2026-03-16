'use server'

import { query, redis, elastic } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export interface CsvProduct {
    productId: string
    name: string
    description: string
    price: number
    status: 'active' | 'inactive'
    brand: string
    category: string
    subcategory: string
    photos: string[]
    gender?: string
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

        for (const p of products) {
            try {
                // SQL запрос "Вставь, если нет, иначе обнови" (UPSERT)
                const sql = `
                    INSERT INTO products (id, name, description, price, status, brand, category, subcategory, gender, photos, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        price = EXCLUDED.price,
                        status = EXCLUDED.status,
                        brand = EXCLUDED.brand,
                        category = EXCLUDED.category,
                        subcategory = EXCLUDED.subcategory,
                        gender = EXCLUDED.gender,
                        photos = EXCLUDED.photos,
                        updated_at = NOW()
                `
                
                // Обрабатываем бренд (в CSV он может быть строкой или массивом)
                const brandArray = Array.isArray(p.brand) ? p.brand : (p.brand ? [p.brand] : [])

                await query(sql, [
                    p.productId, p.name, p.description || '', p.price || 0,
                    p.status || 'active', brandArray, p.category, 
                    p.subcategory || null, p.gender || '', JSON.stringify(p.photos || [])
                ])

                results.success++
            } catch (err: any) {
                results.failed++
                results.errors.push(`${p.productId}: ${err.message}`)
            }
        }

        // Чистим кеш после импорта
        await redis.del('catalog:all')
        revalidatePath('/admin')
        
        return { success: true, data: results }
    } catch (error: any) {
        console.error('CSV import error:', error)
        return { success: false, error: 'Ошибка при импорте' }
    }
}

// Функции для работы с локальными файлами оставляем без изменений, так как они работают с диском, а не с БД.
export async function readLocalCsvAction(filePath: string) {
  const fs = require('fs/promises');
  try {
    const content = await fs.readFile(filePath.replace(/"/g, ''), 'utf-8');
    return { success: true, content };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveLocalCsvAction(filePath: string, products: any[], columns: string[]) {
  const fs = require('fs/promises');
  try {
    // Формируем CSV строку
    // 1. Заголовки
    const header = columns.join(',');
    
    // 2. Строки данных
    const rows = products.map(p => {
      return columns.map(col => {
        let val = p[col];
        if (val === undefined || val === null) val = '';
        
        // Если это массив (например, фото), превращаем в строку
        if (Array.isArray(val)) val = JSON.stringify(val);
        
        // Экранируем кавычки и запятые
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });

    const csvContent = [header, ...rows].join('\n');
    
    await fs.writeFile(filePath.replace(/"/g, ''), csvContent, 'utf-8');
    return { success: true };
  } catch (err: any) {
    console.error('Save CSV error:', err);
    return { success: false, error: err.message };
  }
}

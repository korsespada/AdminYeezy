'use server'

import { createClient } from '@/lib/pocketbase'
import { Collections, type Brand, type Category, type Subcategory } from '@/lib/types'
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
    [key: string]: any
}

export interface Lookups {
    brands: Brand[]
    categories: Category[]
    subcategories: Subcategory[]
}

/**
 * Загружает справочники из PocketBase для резолвинга ID в имена
 */
export async function fetchLookupsAction(): Promise<Lookups> {
    const pb = createClient()
    const [brands, categories, subcategories] = await Promise.all([
        pb.collection(Collections.Brand).getFullList<Brand>({ sort: 'name', requestKey: null }).catch(() => [] as Brand[]),
        pb.collection(Collections.Category).getFullList<Category>({ sort: 'name', requestKey: null }).catch(() => [] as Category[]),
        pb.collection(Collections.Subcategory).getFullList<Subcategory>({ sort: 'name', requestKey: null }).catch(() => [] as Subcategory[]),
    ])
    return { brands, categories, subcategories }
}

export async function pushCsvProductsAction(products: CsvProduct[]) {
    try {
        const pb = createClient()

        const results: { success: number; failed: number; errors: string[] } = {
            success: 0,
            failed: 0,
            errors: [],
        }

        for (const product of products) {
            try {
                const data: any = {
                    productId: product.productId,
                    name: product.name,
                    description: product.description || '',
                    price: product.price || 0,
                    status: product.status || 'active',
                    brand: product.brand || '',
                    category: product.category || '',
                    subcategory: product.subcategory || '',
                    photos: product.photos || [],
                    photos_processed: false,
                    gender: product.gender || '',
                }

                // Проверяем, существует ли уже товар с таким productId
                const existing = await pb.collection(Collections.Products)
                    .getFirstListItem(`productId="${product.productId}"`)
                    .catch(() => null)

                if (existing) {
                    await pb.collection(Collections.Products).update(existing.id, data)
                } else {
                    await pb.collection(Collections.Products).create(data)
                }

                results.success++
            } catch (err: any) {
                results.failed++
                console.error(`Error pushing product ${product.productId}:`, err)

                let msg = ''
                if (err?.data?.data) {
                    msg = Object.entries(err.data.data)
                        .map(([f, e]: [string, any]) => `${f}: ${e.message || JSON.stringify(e)}`)
                        .join(', ')
                } else if (err?.data?.message) {
                    msg = err.data.message
                } else {
                    msg = err?.message || 'Unknown error'
                }

                results.errors.push(`${product.productId || product.name}: ${msg}`)
            }
        }

        revalidatePath('/admin')
        return { success: true, data: results }

    } catch (error: any) {
        console.error('CSV import error:', error)
        return { success: false, error: 'Failed to import products' }
    }
}

// ─── Работа с локальными файлами (Server-side) ─────────────────────────────

import fs from 'fs/promises'
import path from 'path'

export async function readLocalCsvAction(filePath: string) {
    try {
        const cleanPath = filePath.replace(/"/g, '') // Убираем кавычки, если скопировали путь как "C:\..."

        // Проверка: если мы не на Windows, а путь похож на Windows-путь (C:\...)
        if (process.platform !== 'win32' && /^[a-zA-Z]:[\\/]/.test(cleanPath)) {
            return {
                success: false,
                error: 'Доступ к путям Windows (C:\\...) невозможен из облака (Vercel). Используйте "Локальный файл" только при запуске на localhost. Для облака используйте "Загрузку файла".'
            }
        }

        const targetPath = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(cleanPath)
        const content = await fs.readFile(targetPath, 'utf-8')
        return { success: true, content }
    } catch (error: any) {
        console.error('Read local CSV error:', error)
        return { success: false, error: error.message }
    }
}

export async function saveLocalCsvAction(filePath: string, products: CsvProduct[], columns?: { name: string, key: string }[]) {
    try {
        const cleanPath = filePath.replace(/"/g, '')

        // Проверка: если мы не на Windows, а путь похож на Windows-путь (C:\...)
        if (process.platform !== 'win32' && /^[a-zA-Z]:[\\/]/.test(cleanPath)) {
            return {
                success: false,
                error: 'Сохранение в локальные пути Windows невозможно из облака. Используйте localhost.'
            }
        }

        const csvContent = productsToCsv(products, columns)
        const targetPath = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(cleanPath)
        await fs.writeFile(targetPath, csvContent, 'utf-8')
        return { success: true }
    } catch (error: any) {
        console.error('Save local CSV error:', error)
        return { success: false, error: error.message }
    }
}

function productsToCsv(products: CsvProduct[], columns?: { name: string, key: string }[]): string {
    // Если колонок нет, используем дефолтные
    const cols = columns || [
        { name: 'productId', key: 'productId' },
        { name: 'name', key: 'name' },
        { name: 'price', key: 'price' },
        { name: 'brand', key: 'brand' },
        { name: 'category', key: 'category' },
        { name: 'subcategory', key: 'subcategory' },
        { name: 'status', key: 'status' },
        { name: 'description', key: 'description' },
        { name: 'gender', key: 'gender' },
        { name: 'photos', key: 'photos' }
    ]

    const headers = cols.map(c => c.name)
    const lines = [headers.join(';')]

    // Фильтруем пустые товары перед сохранением
    const validProducts = products.filter(p => (p.productId && String(p.productId).trim()) || (p.name && String(p.name).trim()))

    for (const p of validProducts) {
        const row = cols.map(col => {
            let val = p[col.key]
            if (col.key === 'photos') {
                // Всегда приводим к JSON-массиву для сохранения
                if (Array.isArray(val)) {
                    // Добавляем пробел после запятой для красоты и соответствия вашему формату
                    return JSON.stringify(val).replace(/,/g, ', ')
                }
                if (typeof val === 'string' && val.trim()) {
                    const str = val.trim()
                    if (str.startsWith('[') && str.endsWith(']')) {
                        return str.replace(/,/g, ', ')
                    }
                    // Если это список через | или запятую - превращаем в JSON с пробелами
                    const list = str.split(/[||,;]/).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
                    return JSON.stringify(list).replace(/,/g, ', ')
                }
                return '[]'
            }
            return val
        })

        // Экранирование значений
        // Экранирование значений
        const escapedRow = row.map((val, i) => {
            const str = String(val !== undefined && val !== null ? val : '').trim()
            const key = cols[i].key

            // 1. Для поля photos (JSON) всегда используем стандартное экранирование.
            // Это даст результат типа "[""url""]", что является корректным CSV и 
            // гарантирует, что PocketBase воспримет это как JSON-массив.
            if (key === 'photos') {
                return `"${str.replace(/"/g, '""')}"`
            }

            // 2. Для остальных полей используем "минималистичное" экранирование:
            // Оборачиваем в кавычки ТОЛЬКО если есть разделитель (;) или переносы строк.
            const hasDelimiter = str.includes(';')
            const hasNewline = str.includes('\n') || str.includes('\r')

            if (hasDelimiter || hasNewline) {
                return `"${str.replace(/"/g, '""')}"`
            }

            // В остальных случаях (как Rolex "Pepsi") возвращаем как есть.
            return str
        })

        lines.push(escapedRow.join(';'))
    }

    // Сохраняем в Windows-формате (CRLF) и гарантируем пустую строку в конце
    const csvResult = lines.join('\r\n')
    return csvResult.endsWith('\r\n') ? csvResult : csvResult + '\r\n'
}

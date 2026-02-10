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
                }

                await pb.collection(Collections.Products).create(data)
                results.success++
            } catch (err: any) {
                results.failed++
                const msg = err?.data?.data
                    ? Object.entries(err.data.data)
                        .map(([f, e]: [string, any]) => `${f}: ${e.message}`)
                        .join(', ')
                    : err?.message || 'Unknown error'
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
        const content = await fs.readFile(path.resolve(cleanPath), 'utf-8')
        return { success: true, content }
    } catch (error: any) {
        console.error('Read local CSV error:', error)
        return { success: false, error: error.message }
    }
}

export async function saveLocalCsvAction(filePath: string, products: CsvProduct[]) {
    try {
        const cleanPath = filePath.replace(/"/g, '')
        const csvContent = productsToCsv(products)
        await fs.writeFile(path.resolve(cleanPath), csvContent, 'utf-8')
        return { success: true }
    } catch (error: any) {
        console.error('Save local CSV error:', error)
        return { success: false, error: error.message }
    }
}

function productsToCsv(products: CsvProduct[]): string {
    const headers = ['productId', 'name', 'price', 'brand', 'category', 'subcategory', 'status', 'description', 'photos']
    const lines = [headers.join(';')]

    for (const p of products) {
        const row = [
            p.productId,
            p.name,
            p.price.toString(),
            p.brand,
            p.category,
            p.subcategory,
            p.status,
            p.description,
            JSON.stringify(p.photos) // Фотографии сохраняем как JSON массив
        ]

        // Экранирование значений
        const escapedRow = row.map(val => {
            const str = String(val || '')
            if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`
            }
            return str
        })

        lines.push(escapedRow.join(';'))
    }

    return lines.join('\n')
}

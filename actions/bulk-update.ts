'use server'

import { query, redis, elastic } from '@/lib/db'
import { revalidatePath } from 'next/cache'

/**
 * Массовое обновление (категория, пол и т.д.)
 */
export async function bulkUpdateProductsAction(ids: string[], updates: { category?: string, subcategory?: string, gender?: string }) {
    try {
        const fields: string[] = []
        const params: any[] = []
        let pIdx = 1

        if (updates.category !== undefined) {
            fields.push(`category = $${pIdx++}`)
            params.push(updates.category)
        }
        if (updates.subcategory !== undefined) {
            fields.push(`subcategory = $${pIdx++}`)
            params.push(updates.subcategory === "__none__" ? null : updates.subcategory)
        }
        if (updates.gender !== undefined) {
            fields.push(`gender = $${pIdx++}`)
            params.push(updates.gender === "__none__" ? null : updates.gender)
        }

        if (fields.length === 0) return { success: true }

        params.push(ids)
        const sql = `UPDATE products SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ANY($${pIdx})`
        await query(sql, params)

        // Инвалидация кеша
        await redis.del('catalog:all')
        for (const id of ids) {
            await redis.del(`product:${id}`)
            // Обновляем в Elastic (упрощенно - только статус/категорию)
            await elastic.update({
                index: 'products',
                id: id,
                doc: { ...updates, updated_at: new Date() }
            }).catch(() => null)
        }

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk update error:', error)
        return { success: false, error: 'Failed to update products' }
    }
}

/**
 * Массовое удаление
 */
export async function bulkDeleteProductsAction(ids: string[]) {
    try {
        await query('DELETE FROM products WHERE id = ANY($1)', [ids])
        
        // Чистим кеш и Elastic
        await redis.del('catalog:all')
        for (const id of ids) {
            await redis.del(`product:${id}`)
            await elastic.delete({ index: 'products', id: id }).catch(() => null)
        }

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk delete error:', error)
        return { success: false, error: 'Failed to delete products' }
    }
}

/**
 * Массовое применение патчей (для сложных изменений)
 */
export async function bulkPatchObjectsAction(updates: { id: string, data: any }[]) {
    try {
        // Здесь лучше оставить цикл, так как данные у всех разные
        for (const update of updates) {
            const keys = Object.keys(update.data)
            const fields = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')
            const values = Object.values(update.data)
            
            await query(`UPDATE products SET ${fields}, updated_at = NOW() WHERE id = $${keys.length + 1}`, [...values, update.id])
            
            await redis.del(`product:${update.id}`)
            await elastic.index({
              index: 'products',
              id: update.id,
              document: { ...update.data, id: update.id, updated_at: new Date() }
            }).catch(() => null)
        }
        
        await redis.del('catalog:all')
        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk patch error:', error)
        return { success: false, error: 'Failed to mass replace products' }
    }
}

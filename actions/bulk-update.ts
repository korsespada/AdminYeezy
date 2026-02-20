'use server'

import { createClient } from '@/lib/pocketbase'
import { Collections } from '@/lib/types'
import { revalidatePath } from 'next/cache'

export async function bulkUpdateProductsAction(ids: string[], updates: { category?: string, subcategory?: string, gender?: string }) {
    try {
        const pb = createClient()
        const data: any = {}
        if (updates.category !== undefined) data.category = updates.category
        if (updates.subcategory !== undefined) data.subcategory = updates.subcategory
        if (updates.gender !== undefined) data.gender = updates.gender

        // Special case: if subcategory is explicitly "__none__" or empty string, clear it
        if (updates.subcategory === "__none__") {
            data.subcategory = ""
        }

        const CHUNK_SIZE = 5;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            const promises = chunk.map(id =>
                pb.collection(Collections.Products).update(id, data)
            );
            await Promise.all(promises);
            // Небольшая задержка между пачками (даст VPS время выдохнуть и очистить память)
            if (i + CHUNK_SIZE < ids.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk update error:', error)
        return { success: false, error: 'Failed to update products' }
    }
}

export async function bulkPatchObjectsAction(updates: { id: string, data: any }[]) {
    try {
        const pb = createClient()
        const CHUNK_SIZE = 5;
        for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
            const chunk = updates.slice(i, i + CHUNK_SIZE);
            const promises = chunk.map(u =>
                pb.collection(Collections.Products).update(u.id, u.data)
            );
            await Promise.all(promises);
            // Избегаем 100% RAM у PocketBase на недорогом VPS
            if (i + CHUNK_SIZE < updates.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk patch error:', error)
        return { success: false, error: 'Failed to mass replace products' }
    }
}

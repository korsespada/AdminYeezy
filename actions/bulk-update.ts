'use server'

import { createClient } from '@/lib/pocketbase'
import { Collections } from '@/lib/types'
import { revalidatePath } from 'next/cache'

export async function bulkUpdateProductsAction(ids: string[], updates: { category?: string, subcategory?: string }) {
    try {
        const pb = createClient()
        const data: any = {}
        if (updates.category !== undefined) data.category = updates.category
        if (updates.subcategory !== undefined) data.subcategory = updates.subcategory

        // If category is changing but subcategory is NOT provided, reset subcategory to empty
        // to prevent invalid state (old subcategory belonging to old category)
        if (updates.category && updates.subcategory === undefined) {
            data.subcategory = ""
        }
        // Special case: if subcategory is explicitly "__none__" or empty string, clear it
        if (updates.subcategory === "__none__") {
            data.subcategory = ""
        }

        const promises = ids.map(id =>
            pb.collection(Collections.Products).update(id, data)
        )

        await Promise.all(promises)

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk update error:', error)
        return { success: false, error: 'Failed to update products' }
    }
}

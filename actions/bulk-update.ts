'use server'

import { createClient } from '@/lib/pocketbase'
import { Collections } from '@/lib/types'
import { revalidatePath } from 'next/cache'

export async function bulkUpdateSubcategoryAction(ids: string[], subcategory: string) {
    try {
        const pb = createClient()

        // Use batch update if PocketBase supported it well, but loop is safer for now
        // or concurrent promises
        const promises = ids.map(id =>
            pb.collection(Collections.Products).update(id, { subcategory })
        )

        await Promise.all(promises)

        revalidatePath('/admin')
        return { success: true }
    } catch (error: any) {
        console.error('Bulk update error:', error)
        return { success: false, error: 'Failed to update products' }
    }
}

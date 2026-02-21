import { createClient } from '@/lib/pocketbase'
import { Collections, type Brand, type Category, type Subcategory } from '@/lib/types'
import AnalyticsDashboard from '@/components/AnalyticsDashboard'
import { unstable_noStore as noStore } from 'next/cache'

export default async function AnalyticsPage() {
    noStore()

    const pb = createClient()
    let brands: Brand[] = []
    let categories: Category[] = []
    let subcategories: Subcategory[] = []

    try {
        const [categoriesData, subcategoriesData, brandsData] = await Promise.all([
            pb.collection(Collections.Category).getFullList<Category>({ sort: 'name', requestKey: null }).catch(() => []),
            pb.collection(Collections.Subcategory).getFullList<Subcategory>({ sort: 'name', requestKey: null }).catch(() => []),
            pb.collection(Collections.Brand).getFullList<Brand>({ sort: 'name', requestKey: null }).catch(() => [])
        ])

        categories = categoriesData
        subcategories = subcategoriesData
        brands = brandsData
    } catch (err) {
        console.error('Failed to fetch filter data for analytics dashboard:', err)
    }

    return (
        <AnalyticsDashboard
            brands={brands}
            categories={categories}
            subcategories={subcategories}
        />
    )
}

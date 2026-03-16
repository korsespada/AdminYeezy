import { query } from '@/lib/db'
import AnalyticsDashboard from '@/components/AnalyticsDashboard'
import { unstable_noStore as noStore } from 'next/cache'

export default async function AnalyticsPage() {
    noStore()

    try {
        const [categoriesRes, subcategoriesRes, brandsRes] = await Promise.all([
            query('SELECT * FROM categories ORDER BY name ASC'),
            query('SELECT * FROM subcategories ORDER BY name ASC'),
            query('SELECT * FROM brands ORDER BY name ASC')
        ])

        return (
            <AnalyticsDashboard
                brands={brandsRes.rows}
                categories={categoriesRes.rows}
                subcategories={subcategoriesRes.rows}
            />
        )
    } catch (err) {
        console.error('Failed to fetch filter data for analytics dashboard:', err)
        return (
            <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">
                Ошибка загрузки справочников для аналитики.
            </div>
        )
    }
}

import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'
import { connection } from 'next/server'

export default async function AnalyticsPage() {
    await connection()

    return <AnalyticsDashboard />
}

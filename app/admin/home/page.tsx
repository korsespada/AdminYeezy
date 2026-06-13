import AdminLaunchpad from '@/components/dashboard/AdminLaunchpad'
import { describeScrapingDatabaseConnection } from '@/lib/db'
import { getRailsCatalogLookups, listRailsAdminProducts } from '@/lib/rails-admin'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  await connection()

  const railsConfigured = Boolean(process.env.RAILS_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL)
  const scrapingConfigured = Boolean(process.env.SCRAPING_DATABASE_URL)
  let productCount: number | null = null
  let brandCount: number | null = null
  let categoryCount: number | null = null

  if (railsConfigured) {
    try {
      const [lookups, products] = await Promise.all([
        getRailsCatalogLookups(),
        listRailsAdminProducts({ page: 1, perPage: 40 }),
      ])
      productCount = products.totalItems
      brandCount = lookups.brands.length
      categoryCount = lookups.categories.length + lookups.subcategories.length
    } catch (error) {
      console.warn('Admin home Rails status check failed:', error)
    }
  }

  const scrapingDb = describeScrapingDatabaseConnection()
  const hasScrapingDatabase = scrapingConfigured || scrapingDb.database !== 'не задан'

  return (
    <AdminLaunchpad
      railsConfigured={railsConfigured}
      scrapingConfigured={hasScrapingDatabase}
      productCount={productCount}
      brandCount={brandCount}
      categoryCount={categoryCount}
    />
  )
}

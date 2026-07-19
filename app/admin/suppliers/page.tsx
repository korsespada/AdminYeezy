import { getSupplierCatalogLookupsAction, getSuppliersAction } from '@/actions/suppliers'
import SupplierList from '@/components/inventory/SupplierList'
import ImportTabs from '@/components/ui/ImportTabs'
import AdminHeader from '@/components/ui/AdminHeader'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const [res, lookupsResult] = await Promise.all([
    getSuppliersAction(),
    getSupplierCatalogLookupsAction(),
  ])

  if (!res.success) {
    return <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">Ошибка загрузки поставщиков: {res.error}</div>
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <ImportTabs />
        <SupplierList
          initialData={res.data}
          catalogLookups={lookupsResult.success ? lookupsResult.data : { brands: [], categories: [], subcategories: [] }}
        />
      </div>
    </div>
  )
}

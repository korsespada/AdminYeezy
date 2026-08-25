import ChromoffCatalog from '@/components/chromoff/ChromoffCatalog'
import { getRailsCatalogLookups, listRailsChromoffCandidates, listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const PAGE_SIZES = [40, 100, 500] as const
const CHROMOFF_AUTO_SUPPLIER_IDS = [
  '_Z4krSCEyDqn5hvTYMJDEp4rykS4WwC0I',
  '_d_MrS1r4uCqp1cjuoVnfj6jJ42_p9R9NgeH-vag',
  '_Z6wrSBWbbi48HUyk59lk5c4PXN9NKqUQ',
]
const CHROMOFF_ASSIGNABLE_SOURCE_SUPPLIERS = [
  { id: '_Z4krSCEyDqn5hvTYMJDEp4rykS4WwC0I', name: 'CH Одежда', count: 0 },
  { id: '_d_MrS1r4uCqp1cjuoVnfj6jJ42_p9R9NgeH-vag', name: 'CH Одежда, обувь, ремни', count: 0 },
  { id: '_Z6wrSBWbbi48HUyk59lk5c4PXN9NKqUQ', name: 'CH Ювелирка, сумки, ремни', count: 0 },
]

type ChromoffSearchParams = {
  page?: string
  perPage?: string
  q?: string
  category?: string
  subcategory?: string
  minPrice?: string
  maxPrice?: string
  published?: string
  description?: string
  gender?: string
  source?: 'auto' | 'manual'
  sourceSupplier?: string
  aiStatus?: 'ai_assigned' | 'mapped' | 'needs_review' | 'manual'
  chromoffCategory?: string
  chromoffSubcategory?: string
}

function positivePage(value?: string) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function pageSize(value?: string) {
  const parsed = Number(value)
  return PAGE_SIZES.includes(parsed as typeof PAGE_SIZES[number]) ? parsed : PAGE_SIZES[0]
}

function supplierOptionKey(name: string, id: string) {
  const normalizedName = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')
  return normalizedName || id
}

export default async function ChromoffPage({
  searchParams,
}: {
  searchParams: Promise<ChromoffSearchParams>
}) {
  await connection()
  const params = await searchParams
  const page = positivePage(params.page)
  const perPage = pageSize(params.perPage)
  const filters = {
    q: params.q?.trim() || '',
    category: params.category || '',
    subcategory: params.subcategory || '',
    minPrice: params.minPrice || '',
    maxPrice: params.maxPrice || '',
    description: params.description || '',
    gender: params.gender || '',
    source: ['auto', 'manual'].includes(params.source || '') ? params.source as 'auto' | 'manual' : undefined,
    sourceSupplier: params.sourceSupplier || '',
    aiStatus: ['ai_assigned', 'mapped', 'needs_review', 'manual'].includes(params.aiStatus || '') ? params.aiStatus as 'ai_assigned' | 'mapped' | 'needs_review' | 'manual' : undefined,
    chromoffCategory: params.chromoffCategory || '',
    chromoffSubcategory: params.chromoffSubcategory || '',
    published: ['published', 'hidden'].includes(params.published || '') ? params.published as 'published' | 'hidden' : 'all' as const,
  }

  try {
    const [categories, listings, candidates, lookups, attributeDefinitions] = await Promise.all([
      listRailsChromoffCategories(),
      listRailsChromoffListings({
        page,
        perPage,
        search: filters.q,
        categoryId: filters.chromoffSubcategory || filters.chromoffCategory,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        description: filters.description,
        productCategoryId: filters.category,
        productSubcategoryId: filters.subcategory,
        gender: filters.gender,
        source: filters.source,
        sourceSupplierId: filters.sourceSupplier || undefined,
        aiStatus: filters.aiStatus,
        published: filters.published === 'all' ? undefined : filters.published === 'published',
      }),
      listRailsChromoffCandidates(),
      getRailsCatalogLookups(),
      getCatalogAttributeDefinitions(),
    ])
    const assignableSuppliers = Array.from(new Map([
      ...CHROMOFF_ASSIGNABLE_SOURCE_SUPPLIERS,
      ...listings.supplierOptions,
      ...listings.assignableSupplierOptions,
    ].map((item) => [supplierOptionKey(item.name, item.id), item] as const)).values())
    return (
      <ChromoffCatalog
        categories={categories}
        listings={listings.items}
        candidates={candidates}
        catalogCategories={lookups.categories}
        catalogSubcategories={lookups.subcategories}
        brands={lookups.brands}
        suppliers={[
          ...Array.from([...CHROMOFF_ASSIGNABLE_SOURCE_SUPPLIERS, ...listings.supplierOptions]
            .filter((item) => item.id)
            .reduce((map, item) => {
              const key = supplierOptionKey(item.name, item.id)
              const existing = map.get(key)
              if (existing) {
                const existingIsAuto = CHROMOFF_AUTO_SUPPLIER_IDS.includes(existing.id)
                const itemIsAuto = CHROMOFF_AUTO_SUPPLIER_IDS.includes(item.id)
                const count = (existing.count || 0) + (item.count || 0)
                if (itemIsAuto && !existingIsAuto) {
                  map.set(key, { ...item, count })
                } else {
                  existing.count = count
                }
              } else {
                map.set(key, { ...item })
              }
              return map
            }, new Map<string, typeof listings.supplierOptions[0]>())
            .values())
            .sort((left, right) => {
              const leftIndex = CHROMOFF_AUTO_SUPPLIER_IDS.indexOf(left.id)
              const rightIndex = CHROMOFF_AUTO_SUPPLIER_IDS.indexOf(right.id)
              const leftPriority = leftIndex === -1 ? CHROMOFF_AUTO_SUPPLIER_IDS.length : leftIndex
              const rightPriority = rightIndex === -1 ? CHROMOFF_AUTO_SUPPLIER_IDS.length : rightIndex
              return leftPriority - rightPriority || left.name.localeCompare(right.name, 'ru')
            }),
          { id: '__none__', name: 'Без поставщика', count: 0 },
        ]}
        assignableSuppliers={assignableSuppliers}
        totalItems={listings.totalItems}
        totalPages={listings.totalPages}
        page={page}
        perPage={perPage}
      />
    )
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось загрузить каталог Chromoff. {error instanceof Error ? error.message : 'Проверьте доступность Rails API.'}
        </div>
      </main>
    )
  }
}

import ChromoffCatalog from '@/components/chromoff/ChromoffCatalog'
import { getRailsCatalogLookups, getRailsProductFilterFacets, listRailsChromoffCandidates, listRailsChromoffCategories, listRailsChromoffListings } from '@/lib/rails-admin'
import { getCatalogAttributeDefinitions } from '@/lib/catalog-attribute-registry'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 48

type ChromoffSearchParams = {
  page?: string
  q?: string
  category?: string
  subcategory?: string
  minPrice?: string
  maxPrice?: string
  published?: string
  description?: string
  supplier?: string
  gender?: string
  source?: 'auto' | 'manual'
  aiStatus?: 'ai_assigned' | 'mapped' | 'needs_review' | 'manual'
  chromoffCategory?: string
  chromoffSubcategory?: string
}

function positivePage(value?: string) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

export default async function ChromoffPage({
  searchParams,
}: {
  searchParams: Promise<ChromoffSearchParams>
}) {
  await connection()
  const params = await searchParams
  const page = positivePage(params.page)
  const filters = {
    q: params.q?.trim() || '',
    category: params.category || '',
    subcategory: params.subcategory || '',
    minPrice: params.minPrice || '',
    maxPrice: params.maxPrice || '',
    description: params.description || '',
    supplier: params.supplier || '',
    gender: params.gender || '',
    source: ['auto', 'manual'].includes(params.source || '') ? params.source as 'auto' | 'manual' : undefined,
    aiStatus: ['ai_assigned', 'mapped', 'needs_review', 'manual'].includes(params.aiStatus || '') ? params.aiStatus as 'ai_assigned' | 'mapped' | 'needs_review' | 'manual' : undefined,
    chromoffCategory: params.chromoffCategory || '',
    chromoffSubcategory: params.chromoffSubcategory || '',
    published: ['published', 'hidden'].includes(params.published || '') ? params.published as 'published' | 'hidden' : 'all' as const,
  }

  try {
    const [categories, listings, candidates, lookups, facets, attributeDefinitions] = await Promise.all([
      listRailsChromoffCategories(),
      listRailsChromoffListings({
        page,
        perPage: PAGE_SIZE,
        search: filters.q,
        categoryId: filters.chromoffSubcategory || filters.chromoffCategory,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        description: filters.description,
        supplier: filters.supplier,
        productCategoryId: filters.category,
        productSubcategoryId: filters.subcategory,
        gender: filters.gender,
        source: filters.source,
        aiStatus: filters.aiStatus,
        published: filters.published === 'all' ? undefined : filters.published === 'published',
      }),
      listRailsChromoffCandidates(),
      getRailsCatalogLookups(),
      getRailsProductFilterFacets({}),
      getCatalogAttributeDefinitions(),
    ])
    return (
      <ChromoffCatalog
        categories={categories}
        listings={listings.items}
        candidates={candidates}
        catalogCategories={lookups.categories}
        catalogSubcategories={lookups.subcategories}
        brands={lookups.brands}
        attributeDefinitions={attributeDefinitions}
        suppliers={(facets.supplierFacets || []).map((item) => ({ id: item.slug, name: item.name || item.slug }))}
        totalItems={listings.totalItems}
        totalPages={listings.totalPages}
        page={page}
      />
    )
  } catch (error) {
    return (
      <main className="min-h-full bg-slate-950 p-8 text-slate-100">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Раздел Chromoff ожидает миграцию Rails API. {error instanceof Error ? error.message : ''}
        </div>
      </main>
    )
  }
}

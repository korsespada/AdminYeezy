import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import DavidImportPanel from '@/components/chromoff/DavidImportPanel'
import { scrapingQuery } from '@/lib/db'
import { getRailsCatalogLookups, listRailsChromoffCategories } from '@/lib/rails-admin'
import { listPhotoCleanJobs } from '@/lib/photo-clean-jobs'
import { listDavidPhotoExclusions } from '@/lib/david-photo-exclusions'
import { DAVID_SUPPLIER_NAME, davidPriceRange, davidProductVariantAttributes, type DavidCatalogProduct } from '@/lib/david-studio-import'
import { loadDavidStudioCatalog } from '@/lib/david-studio-catalog-server'

export const dynamic = 'force-dynamic'

/** Рабочий экран товара David: чистка фото, ИИ-черновик, создание или привязка к товару Chromoff. */
export default async function DavidImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { handle } = await params
  const { from } = await searchParams
  // «Назад» возвращает к выгрузке с теми же фильтрами, что были включены.
  const backHref = from ? `/admin/chromoff/david-studio?${from}` : '/admin/chromoff/david-studio'
  const catalog = loadDavidStudioCatalog()
  if (!catalog) notFound()
  const product = (catalog.products as DavidCatalogProduct[]).find((item) => item.handle === handle)
  if (!product) notFound()

  const [draftResult, photos, lookups, chromoffCategories, excluded] = await Promise.all([
    scrapingQuery('SELECT status, ai_output, error, price_rub, rails_product_id, chromoff_listing_id FROM david_import_drafts WHERE handle=$1', [handle]),
    listPhotoCleanJobs({ supplier: DAVID_SUPPLIER_NAME, sourceProduct: handle, limit: 200 }),
    getRailsCatalogLookups(),
    listRailsChromoffCategories(),
    listDavidPhotoExclusions(handle).catch(() => [] as string[]),
  ])

  const categoryNames = new Map<string, string>()
  for (const category of lookups.categories as any[]) categoryNames.set(String(category.id), String(category.name))
  const categories = (lookups.subcategories as any[])
    .map((subcategory) => ({
      id: String(subcategory.id),
      name: `${categoryNames.get(String(subcategory.parent_id)) || 'Без категории'} / ${subcategory.name}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))

  const variantAttributes = davidProductVariantAttributes(product)

  return (
    <main className="min-h-full bg-slate-900 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href={backHref}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700">
          <ArrowLeft className="h-4 w-4" />
          К выгрузке David Studio
        </Link>

        <DavidImportPanel
          handle={product.handle}
          title={product.title}
          sourceUrl={product.url || `https://www.david-studio.com/products/${product.handle}`}
          priceLabel={davidPriceRange(product).label}
          photos={photos.map((photo) => ({
            id: photo.id,
            sourceKey: photo.sourceKey,
            sourcePosition: photo.sourcePosition,
            status: photo.status,
            cleanStatus: photo.cleanStatus,
            s3CleanUrl: photo.s3CleanUrl,
            s3BeforeUrl: photo.s3BeforeUrl,
            s3AfterUrl: photo.s3AfterUrl,
            error: photo.error,
            manualBox: photo.manualBox,
          }))}
          draft={draftResult.rows[0] || null}
          excluded={excluded}
          variantSizes={variantAttributes.sizes}
          variantMeasurements={variantAttributes.measurements}
          variantNotSizes={variantAttributes.notSizes}
          categories={categories}
          chromoffCategories={chromoffCategories.map((category) => ({ id: String(category.id), name: String(category.name) }))}
        />
      </div>
    </main>
  )
}

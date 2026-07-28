'use client'

import { ChevronRight, FolderOpen } from 'lucide-react'
import type { Brand, Category, ProductFilterFacets, Subcategory } from '@/lib/types'
import { Button } from '@/components/ui/button'

interface CategoryBrowserProps {
  categories: Category[]
  subcategories: Subcategory[]
  brands: Brand[]
  filterFacets?: ProductFilterFacets
  onCategorySelect: (categoryId: string) => void
  onBrandSelect: (brandId: string) => void
}

export default function CategoryBrowser({
  categories,
  subcategories,
  brands,
  filterFacets,
  onCategorySelect,
  onBrandSelect,
}: CategoryBrowserProps) {
  const directCountsBySlug = new Map(
    (filterFacets?.categoryFacets || []).map((facet) => [facet.slug, Number(facet.count || 0)]),
  )
  const subcategoryCountsBySlug = new Map(
    (filterFacets?.subcategoryFacets || []).map((facet) => [facet.slug, Number(facet.count || 0)]),
  )
  const brandsBySlug = new Map<string, Brand>()
  brands.forEach((brand) => {
    brandsBySlug.set(brand.id, brand)
    if (brand.slug) brandsBySlug.set(brand.slug, brand)
  })
  const popularBrands = (filterFacets?.brandFacets || [])
    .map((facet) => ({ brand: brandsBySlug.get(facet.slug), count: Number(facet.count || 0) }))
    .filter((item): item is { brand: Brand; count: number } => Boolean(item.brand) && item.count > 0)
    .sort((a, b) => b.count - a.count || a.brand.name.localeCompare(b.brand.name, 'ru'))
    .slice(0, 14)

  return (
    <section aria-labelledby="category-browser-title" className="py-2">
      <div className="mb-4">
        <h3 id="category-browser-title" className="text-xl font-semibold text-slate-100">
          Выберите категорию
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          Товары загрузятся только после выбора категории или применения фильтра.
        </p>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center text-slate-400">
          Категории пока не созданы.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4">
          {categories.map((category) => {
            const children = subcategories.filter((subcategory) => subcategory.category === category.id)
            const childNames = children.map((subcategory) => subcategory.name)
            const directCount = directCountsBySlug.get(category.slug || category.id) || 0
            const childCount = children.reduce(
              (sum, subcategory) => sum + (subcategoryCountsBySlug.get(subcategory.slug || subcategory.id) || 0),
              0,
            )
            const count = directCount + childCount

            return (
              <Button
                key={category.id}
                type="button"
                variant="outline"
                onClick={() => onCategorySelect(category.id)}
                className="group h-auto min-h-20 justify-start rounded-lg border-slate-700 bg-slate-800/70 p-3 text-left text-slate-200 hover:border-indigo-500/60 hover:bg-slate-800 hover:text-white"
              >
                <span className="flex w-full items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-400 transition-colors group-hover:bg-indigo-500/20">
                    <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{category.name}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400" aria-hidden="true" />
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] font-normal text-slate-500">
                      <span className="truncate">{childNames.length > 0 ? childNames.slice(0, 3).join(' · ') : 'Без подкатегорий'}</span>
                      {count > 0 && <span className="shrink-0 text-slate-400">{count.toLocaleString('ru-RU')}</span>}
                    </span>
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
      )}

      {popularBrands.length > 0 && (
        <div className="mt-7 border-t border-slate-800 pt-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-200">Популярные бренды</h4>
            <span className="text-xs text-slate-500">14 брендов с наибольшим числом товаров</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {popularBrands.map(({ brand, count }) => (
              <Button
                key={brand.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onBrandSelect(brand.id)}
                className="h-8 rounded-full border-slate-700 bg-slate-800/70 px-3 text-xs text-slate-300 hover:border-indigo-500/60 hover:bg-indigo-500/10 hover:text-indigo-300"
              >
                <span>{brand.name}</span>
                <span className="text-[10px] font-normal text-slate-500">{count.toLocaleString('ru-RU')}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

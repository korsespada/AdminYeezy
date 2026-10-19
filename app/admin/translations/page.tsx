import { connection } from 'next/server'
import TranslationsDashboard from '@/components/translations/TranslationsDashboard'
import { getRailsCatalogLookups, getRailsCatalogAttributeRegistry, listRailsAdminProducts } from '@/lib/rails-admin'

export const dynamic = 'force-dynamic'

export default async function TranslationsPage() {
  await connection()

  try {
    // Очередь перевода: товаров без перевода, с неполным и с устаревшим переводом.
    const [missing, partial, stale, lookups, registry] = await Promise.all([
      listRailsAdminProducts({ page: 1, perPage: 20, enStatus: 'missing' }),
      listRailsAdminProducts({ page: 1, perPage: 20, enStatus: 'partial' }),
      listRailsAdminProducts({ page: 1, perPage: 20, enStatus: 'stale' }),
      getRailsCatalogLookups(),
      getRailsCatalogAttributeRegistry(),
    ])
    const queuedProducts = [...stale.products, ...partial.products, ...missing.products]

    return (
      <div className="mx-auto max-w-5xl p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-100">Переводы</h1>
          <p className="mt-1 text-sm text-slate-400">
            Машинный перевод EN через OpenRouter. Перед запуском проверьте, что ключ настроен на API.
          </p>
        </div>
        <TranslationsDashboard
          products={queuedProducts.map((product) => ({ id: product.id, name: product.name, translations: product.translations }))}
          categories={[
            ...lookups.categories.map((category) => ({
              id: category.id,
              name: category.name,
              description: category.description,
              seo_title: category.seo_title,
              seo_description: category.seo_description,
              seo_text_top: category.seo_text_top,
              seo_text_bottom: category.seo_text_bottom,
              translations: category.translations,
              parentId: '',
            })),
            ...lookups.subcategories.map((category) => ({
              id: category.id,
              name: category.name,
              description: category.description,
              seo_title: category.seo_title,
              seo_description: category.seo_description,
              seo_text_top: category.seo_text_top,
              seo_text_bottom: category.seo_text_bottom,
              translations: category.translations,
              parentId: category.category,
            })),
          ]}
          brands={lookups.brands.map((brand) => ({
            id: brand.id,
            name: brand.name,
            description: brand.description,
            seo_title: brand.seo_title,
            seo_description: brand.seo_description,
            seo_text: brand.seo_text,
            translations: brand.translations,
          }))}
          attributeDefinitions={(registry.definitions || []).map((definition: any) => ({
            id: String(definition.code),
            name: String(definition.label || definition.code),
            translations: definition.translations,
          }))}
          attributeValues={(registry.values || []).map((value: any) => ({
            id: String(value.id),
            name: String(value.canonical_value || value.filter_value),
            translations: value.translations,
          }))}
        />
      </div>
    )
  } catch (error: any) {
    return (
      <div className="m-8 rounded-lg bg-red-900/20 p-4 text-red-300">
        Не удалось загрузить данные переводов: {error.message}
      </div>
    )
  }
}

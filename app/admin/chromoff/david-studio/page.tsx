import Link from 'next/link'
import { ArrowLeft, FileWarning, RefreshCw } from 'lucide-react'
import DavidStudioCatalog from '@/components/chromoff/DavidStudioCatalog'
import { DAVID_STUDIO_CATALOG_FILE, loadDavidStudioCatalog } from '@/lib/david-studio-catalog-server'
import {
  buildDavidStudioFacets,
  filterDavidStudioProducts,
  normalizeFilters,
  normalizePageSize,
  paginate,
} from '@/lib/david-studio-catalog'
import { connection } from 'next/server'

export const dynamic = 'force-dynamic'

type DavidStudioSearchParams = {
  page?: string
  perPage?: string
  q?: string
  category?: string
  subcategory?: string
  productType?: string
  availability?: string
  sort?: string
}

/** Дата выгрузки в московском времени: одинаково на сервере и клиенте, без сдвига. */
function formatParsedAt(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

export default async function DavidStudioPage({
  searchParams,
}: {
  searchParams: Promise<DavidStudioSearchParams>
}) {
  await connection()
  const params = await searchParams

  let catalog: ReturnType<typeof loadDavidStudioCatalog>
  try {
    catalog = loadDavidStudioCatalog()
  } catch (error) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          Не удалось прочитать выгрузку David Studio.{' '}
          {error instanceof Error ? error.message : 'Файл повреждён.'}
        </div>
      </Shell>
    )
  }

  if (!catalog) {
    return (
      <Shell>
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 p-8 text-center">
          <FileWarning className="mx-auto h-9 w-9 text-amber-300" />
          <h2 className="mt-3 text-lg font-semibold text-slate-100">Выгрузка ещё не собрана</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
            Страница читает файл <code className="rounded bg-slate-900 px-1.5 py-0.5 text-xs text-violet-200">{DAVID_STUDIO_CATALOG_FILE}</code>.
            Соберите его командой:
          </p>
          <pre className="mx-auto mt-3 w-fit rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-left text-xs text-emerald-200">
            node scripts/sync-david-studio-catalog.mjs
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            Скрипт забирает каталог с david-studio.com. Повторный запуск обновляет данные.
          </p>
        </div>
      </Shell>
    )
  }

  const filters = normalizeFilters(params)
  const perPage = normalizePageSize(params.perPage)
  const filtered = filterDavidStudioProducts(catalog.products, filters)
  const facets = buildDavidStudioFacets(catalog.products, { category: filters.category })
  const { items, total, totalPages, page } = paginate(filtered, Number(params.page) || 1, perPage)

  return (
    <DavidStudioCatalog
      products={items}
      facets={facets}
      filters={filters}
      summary={catalog.summary}
      source={catalog.source}
      parsedAtLabel={formatParsedAt(catalog.parsed_at)}
      page={page}
      perPage={perPage}
      total={total}
      totalPages={totalPages}
    />
  )
}

/** Общая рамка для состояний, когда каталог показать нельзя. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-slate-900 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">David Studio</h1>
            <p className="mt-1 text-sm text-slate-400">Выгрузка каталога поставщика для просмотра</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin/chromoff"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              К Chromoff
            </Link>
            <Link
              href="/admin/chromoff/david-studio"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </Link>
          </div>
        </div>
        {children}
      </div>
    </main>
  )
}

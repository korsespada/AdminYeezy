import Link from 'next/link'
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Gem,
  Database,
  FileSearch,
  FolderTree,
  ListChecks,
  PackageSearch,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AdminLaunchpadProps {
  railsConfigured: boolean
  scrapingConfigured: boolean
  productCount?: number | null
  brandCount?: number | null
  categoryCount?: number | null
}

const sections = [
  {
    title: 'Chromoff',
    description: 'Каталог Chrome Hearts: отдельные категории, перенос из Supabase и ручная публикация на Chromoff.',
    href: '/admin/chromoff',
    icon: Gem,
    tone: 'text-violet-300',
  },
  {
    title: 'Товары',
    description: 'Опубликованный каталог из Rails CRM: поиск, фильтры, карточки и массовые действия.',
    href: '/admin',
    icon: PackageSearch,
    tone: 'text-sky-300',
  },
  {
    title: 'CRM',
    description: 'Заказы, item statuses, поставщики, замены, возвраты, выплаты и клиенты.',
    href: '/admin/crm',
    icon: ClipboardList,
    tone: 'text-violet-300',
  },
  {
    title: 'Выгрузки',
    description: 'Партии из scraping-контура, AI-обработка и публикация через Rails import API.',
    href: '/admin/batches',
    icon: RefreshCw,
    tone: 'text-orange-300',
  },
  {
    title: 'Поставщики',
    description: 'Поставщики, альбомы, настройки парсинга и технические данные AdminYeezy.',
    href: '/admin/suppliers',
    icon: Users,
    tone: 'text-emerald-300',
  },
  {
    title: 'Scraping',
    description: 'Запуск и контроль задач сбора данных перед формированием партий.',
    href: '/admin/scraping',
    icon: FileSearch,
    tone: 'text-cyan-300',
  },
  {
    title: 'Бренды',
    description: 'Справочник брендов опубликованного каталога и их URL-идентификаторы.',
    href: '/admin/brands',
    icon: Tags,
    tone: 'text-pink-300',
  },
  {
    title: 'Категории',
    description: 'Категории, подкатегории и структура размещения товаров на витрине.',
    href: '/admin/categories',
    icon: FolderTree,
    tone: 'text-amber-300',
  },
  {
    title: 'Атрибуты товаров',
    description: 'Проверка и применение найденных размеров, цветов, материалов и моделей.',
    href: '/admin/catalog-attributes',
    icon: ListChecks,
    tone: 'text-emerald-300',
  },
  {
    title: 'Схема атрибутов',
    description: 'Настройка характеристик, фильтров, вариантов и справочников значений.',
    href: '/admin/filter-characteristics',
    icon: SlidersHorizontal,
    tone: 'text-blue-300',
  },
  {
    title: 'Правила AI',
    description: 'Общие инструкции и правила обработки данных для AI-процессов.',
    href: '/admin/ai-rules',
    icon: Settings2,
    tone: 'text-purple-300',
  },
  {
    title: 'AI-каталог',
    description: 'Названия, описания, характеристики, гендер и подкатегории через локальный Cockpit Tools.',
    href: '/admin/seo-ai',
    icon: Sparkles,
    tone: 'text-fuchsia-300',
  },
  {
    title: 'Аналитика',
    description: 'Операционные графики и события storefront/admin analytics.',
    href: '/admin/analytics',
    icon: BarChart3,
    tone: 'text-indigo-300',
  },
  {
    title: 'Корзина',
    description: 'Архивированные товары и восстановление опубликованного каталога.',
    href: '/admin/trash',
    icon: Trash2,
    tone: 'text-rose-300',
  },
]

export default function AdminLaunchpad({
  railsConfigured,
  scrapingConfigured,
  productCount,
  brandCount,
  categoryCount,
}: AdminLaunchpadProps) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Badge className="border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/10">
              AdminYeezy
            </Badge>
            <h1 className="mt-4 text-4xl font-bold tracking-normal text-white sm:text-5xl">
              Операционная панель
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400">
              Storefront живет отдельно, Rails CRM остается источником опубликованного каталога, а AdminYeezy управляет
              выгрузками, поставщиками, AI-процессами и операторскими задачами.
            </p>
          </div>

          <Card className="border-slate-800 bg-slate-900 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4 text-indigo-300" />
                Состояние контуров
              </CardTitle>
              <CardDescription className="text-slate-400">
                Быстрая проверка, какие источники настроены в окружении.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <StatusRow label="Rails API" ok={railsConfigured} okText="Готов к CRM/API" failText="Нужен RAILS_API_URL" />
              <StatusRow label="Scraping DB" ok={scrapingConfigured} okText="Техническая БД подключена" failText="Нужен SCRAPING_DATABASE_URL" />
              <div className="grid grid-cols-3 gap-2 pt-2">
                <Metric label="Товаров" value={productCount} />
                <Metric label="Брендов" value={brandCount} />
                <Metric label="Категорий" value={categoryCount} />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-label={`Открыть раздел: ${section.title}`}
                className="group rounded-lg border border-slate-800 bg-slate-900 p-5 transition hover:border-indigo-500/60 hover:bg-slate-800"
              >
                <div className="flex h-full min-h-[164px] flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 ${section.tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 group-hover:text-indigo-300">
                      Открыть
                    </span>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold text-white">{section.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{section.description}</p>
                </div>
              </Link>
            )
          })}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <Boxes className="mt-0.5 h-5 w-5 text-indigo-300" />
            <div>
              <h2 className="text-base font-semibold text-white">Архитектурное решение</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Не переносим всю админку на Rails сейчас: Next.js сохраняет рабочие scraping/AI/analytics экраны, а Rails
                отвечает за CRM workflow, импорт, каталог, платежи, возвраты и SEO API.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function StatusRow({
  label,
  ok,
  okText,
  failText,
}: {
  label: string
  ok: boolean
  okText: string
  failText: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <Badge className={ok ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15' : 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/15'}>
        {ok ? okText : failText}
      </Badge>
    </div>
  )
}

function Metric({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="text-lg font-bold text-white">{typeof value === 'number' ? value.toLocaleString('ru-RU') : '—'}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  )
}

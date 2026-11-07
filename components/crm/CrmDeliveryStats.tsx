import Link from 'next/link'
import { AlertTriangle, CalendarRange, Clock, Eye, MapPin, PackageCheck, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { RailsDeliveryParcelRow, RailsDeliveryStage, RailsDeliveryStats } from '@/lib/rails-admin'
import { formatDateTime, formatDays, formatShare, formatWeek } from '@/lib/delivery-stats'

const stageLabels: Record<RailsDeliveryStage, string> = {
  created: 'Создана',
  shipped: 'Едет из Китая',
  customs: 'На таможне',
  sorting: 'В сортировочном центре',
  delivered: 'Вручена',
  unknown: 'Нет данных STD',
}

const sourceLabels: Record<RailsDeliveryParcelRow['source'], string> = {
  track: '/track',
  crm: 'CRM',
  both: '/track и CRM',
}

const segmentLabels: Array<[keyof RailsDeliveryStats['durations'], string, string]> = [
  ['total', 'Весь путь', 'от первого события STD до вручения'],
  ['before_customs', 'До таможни', 'от первого события до прихода на таможню'],
  ['customs', 'Таможня', 'от прихода на таможню до первого события после неё'],
  ['after_customs', 'После таможни', 'от выхода с таможни до вручения'],
]

const panelClassName = 'rounded-lg border border-slate-800 bg-slate-900 p-5'
const inputClassName = 'h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-500'

export default function CrmDeliveryStats({ stats }: { stats: RailsDeliveryStats }) {
  const { lookups, shipments, parcels, durations } = stats

  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/crm" className="text-sm text-sky-300 hover:text-sky-200">← CRM</Link>
            <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Доставка</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Посылки STD за период: номера с публичной страницы /track и треки, которые ввели менеджеры. Данные на {formatDateTime(stats.generated_at)}.
            </p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Период">
            <label className="grid gap-1 text-xs text-slate-400">
              С
              <input type="date" name="from" defaultValue={stats.period.from} className={inputClassName} />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              По
              <input type="date" name="to" defaultValue={stats.period.to} className={inputClassName} />
            </label>
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500">
              <CalendarRange className="h-4 w-4" />
              Показать
            </button>
          </form>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Главное">
          <Kpi icon={Truck} label="Посылок за период" value={parcels.total} hint="найденных в STD, без повторов" />
          <Kpi icon={PackageCheck} label="Заказы мимо сайта" value={lookups.off_site_parcels} hint="найдены на /track, трека нет в CRM" />
          <Kpi icon={PackageCheck} label="Вручено" value={parcels.delivered} hint={formatShare(parcels.delivered, parcels.total)} />
          <Kpi icon={Clock} label="Срок доставки" value={formatDays(durations.total.median)} hint="медиана по врученным" />
          <Kpi icon={Clock} label="Таможня" value={formatDays(durations.customs.median)} hint="медиана" />
        </section>

        <section className={panelClassName} aria-labelledby="durations-title">
          <h2 id="durations-title" className="text-lg font-semibold text-white">Сроки по этапам</h2>
          <p className="mt-1 text-sm text-slate-400">По датам событий STD. 90% посылок укладываются в срок из колонки «90%».</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Отрезок</th>
                  <th className="py-2 pr-4 font-medium">Медиана</th>
                  <th className="py-2 pr-4 font-medium">Среднее</th>
                  <th className="py-2 pr-4 font-medium">90%</th>
                  <th className="py-2 font-medium">Посылок</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {segmentLabels.map(([key, label, hint]) => (
                  <tr key={key}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-100">{label}</div>
                      <div className="text-xs text-slate-500">{hint}</div>
                    </td>
                    <td className="py-3 pr-4 font-semibold text-white">{formatDays(durations[key].median)}</td>
                    <td className="py-3 pr-4 text-slate-300">{formatDays(durations[key].average)}</td>
                    <td className="py-3 pr-4 text-slate-300">{formatDays(durations[key].p90)}</td>
                    <td className="py-3 text-slate-400">{durations[key].count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <BarList
            title="Где посылки сейчас"
            description="Последний известный этап STD."
            rows={(Object.keys(stageLabels) as RailsDeliveryStage[]).map((stage) => ({ key: stage, label: stageLabels[stage], value: stats.stages[stage] || 0 }))}
          />
          <BarList
            title="Города назначения"
            description={`Топ-${stats.destinations.length || 15} по числу посылок.`}
            icon={MapPin}
            rows={stats.destinations.map((row) => ({ key: row.city, label: row.city, value: row.count }))}
            empty="Города пока не известны"
          />
        </div>

        <BarList
          title="Новые посылки по неделям"
          description="Номера, найденные на /track впервые за неделю (с понедельника). Справа — опечатки и треки, добавленные в CRM."
          rows={stats.weekly.map((row) => ({
            key: row.week,
            label: `с ${formatWeek(row.week)}`,
            value: row.found,
            extra: `не найдено ${row.not_found} · CRM ${row.shipments}`,
          }))}
          empty="За период новых номеров нет"
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <section className={panelClassName} aria-labelledby="track-title">
            <h2 id="track-title" className="text-lg font-semibold text-white">Страница /track</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Разных номеров" value={lookups.numbers} />
              <Stat label="Всего проверок" value={lookups.lookups} />
              <Stat label="Найдено в STD" value={lookups.found} />
              <Stat label="Не найдено" value={lookups.not_found} hint={formatShare(lookups.not_found, lookups.numbers)} />
              <Stat label="STD не ответил" value={lookups.unavailable} />
              <Stat label="Проверок на посылку" value={lookups.avg_lookups_per_found ?? '—'} hint="в среднем" />
              <Stat label="Проверяли 3+ раз" value={lookups.repeat_checked} />
              <Stat label="Переданы в СДЭК" value={parcels.handed_to_cdek} hint={formatShare(parcels.handed_to_cdek, parcels.total)} />
              <Stat label="С объявлением STD" value={parcels.notice_seen} hint="задержки и т. п." />
            </dl>
          </section>

          <section className={panelClassName} aria-labelledby="crm-title">
            <h2 id="crm-title" className="text-lg font-semibold text-white">Треки в CRM</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Добавлено треков" value={shipments.total} />
              <Stat label="Вручено" value={shipments.delivered} />
              <Stat label="В пути" value={shipments.in_transit} />
              <Stat label="Движения нет" value={shipments.created} />
              <Stat label="К заказу сайта" value={shipments.with_order} />
              <Stat label="Без заказа" value={shipments.without_order} hint="оплачено менеджеру" />
              <Stat label="С ошибкой STD" value={shipments.with_error} />
            </dl>
          </section>
        </div>

        <ParcelTable
          title="Без движения больше 7 дней"
          description="Не вручены, и в последнем снимке STD нет новых событий. Снимок обновляется, когда посылку открывают."
          icon={AlertTriangle}
          rows={stats.stuck}
          showStall
          empty="Застрявших посылок нет"
        />

        <ParcelTable
          title="Чаще всего проверяют"
          description="Не вручены, проверяли больше одного раза: клиент ждёт, можно написать первым."
          icon={Eye}
          rows={stats.most_checked}
          empty="Повторных проверок нет"
        />

        <p className="text-xs leading-5 text-slate-500">
          Период отбирает посылки по первому появлению: первый запрос на /track или добавление трека в CRM. Время событий STD — как на его сайте, без пересчёта пояса, поэтому сроки точны до дня. Ссылки на /track из магазинного бота тоже попадают в статистику страницы; «Заказы мимо сайта» их не считают.
        </p>
      </div>
    </main>
  )
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Truck; label: string; value: number | string; hint: string }) {
  return (
    <div className={panelClassName}>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Icon className="h-4 w-4 text-sky-300" />
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-white">
        {value}
        {hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}
      </dd>
    </div>
  )
}

type BarRow = { key: string; label: string; value: number; extra?: string }

function BarList({ title, description, rows, icon: Icon, empty = 'Нет данных' }: {
  title: string
  description: string
  rows: BarRow[]
  icon?: typeof Truck
  empty?: string
}) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  // Каждая строка — своя сетка, поэтому колонки фиксированной ширины: иначе
  // полосы разной длины у чисел с разным количеством цифр.
  const columns = rows.some((row) => row.extra)
    ? 'grid-cols-[minmax(0,7rem)_1fr_3rem] sm:grid-cols-[minmax(0,10rem)_1fr_3rem_11rem]'
    : 'grid-cols-[minmax(0,9rem)_1fr_3rem] sm:grid-cols-[minmax(0,12rem)_1fr_3rem]'

  return (
    <section className={panelClassName} aria-label={title}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        {Icon && <Icon className="h-4 w-4 text-sky-300" />}
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {rows.length === 0 || total === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => (
            <li key={row.key} className={`grid items-center gap-3 text-sm ${columns}`} title={`${row.label}: ${row.value}${row.extra ? `, ${row.extra}` : ''}`}>
              <span className="truncate text-slate-300">{row.label}</span>
              <span className="h-2 rounded-full bg-slate-800" aria-hidden="true">
                <span className="block h-2 rounded-full bg-sky-400" style={{ width: `${(row.value / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-slate-100">{row.value}</span>
              {row.extra && <span className="hidden truncate text-xs text-slate-500 sm:block">{row.extra}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ParcelTable({ title, description, rows, icon: Icon, showStall = false, empty }: {
  title: string
  description: string
  rows: RailsDeliveryParcelRow[]
  icon: typeof Truck
  showStall?: boolean
  empty: string
}) {
  return (
    <section className={panelClassName} aria-label={title}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <Icon className="h-4 w-4 text-sky-300" />
        {title}
        <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800">{rows.length}</Badge>
      </h2>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Трек</th>
                <th className="py-2 pr-4 font-medium">Этап</th>
                <th className="py-2 pr-4 font-medium">Город</th>
                {showStall && <th className="py-2 pr-4 font-medium">Последнее событие</th>}
                <th className="py-2 pr-4 font-medium">Проверок</th>
                <th className="py-2 pr-4 font-medium">Последний запрос</th>
                <th className="py-2 font-medium">Источник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={row.number}>
                  <td className="py-3 pr-4 font-mono text-slate-100">{row.number}</td>
                  <td className="py-3 pr-4 text-slate-300">{stageLabels[row.stage || 'unknown']}</td>
                  <td className="py-3 pr-4 text-slate-300">{row.destination || '—'}</td>
                  {showStall && (
                    <td className="py-3 pr-4 text-slate-300">
                      {formatDateTime(row.last_event_at)}
                      <span className="ml-2 text-xs text-amber-300">{row.days_without_events} дн.</span>
                    </td>
                  )}
                  <td className="py-3 pr-4 tabular-nums text-slate-300">{row.lookups_count ?? '—'}</td>
                  <td className="py-3 pr-4 text-slate-400">{formatDateTime(row.last_lookup_at)}</td>
                  <td className="py-3 text-slate-400">{sourceLabels[row.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

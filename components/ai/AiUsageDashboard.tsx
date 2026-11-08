import Link from 'next/link'
import type { ReactNode } from 'react'
import { AlertTriangle, Brain, Clock, Coins, Database, Package, Zap } from 'lucide-react'
import type { AiUsageReport, AiUsageTotals } from '@/actions/ai-usage'

const PERIODS: Array<{ days: number | null; label: string }> = [
  { days: 1, label: 'Сутки' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: null, label: 'Всё время' },
]

const FEATURE_LABELS: Record<string, string> = {
  batch_ai: 'Выгрузки',
  card_updates: 'Обработка карточек',
  chromoff: 'Chromoff',
  david_studio: 'David Studio',
  measurement_templates: 'Шаблоны замеров',
  ai_process: 'Обработка ИИ (CSV)',
  provider_test: 'Проверка провайдера',
  other: 'Прочее',
}

export function formatUsd(value: number) {
  if (!value) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 10) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} млн`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} тыс.`
  return String(value)
}

function percent(part: number, total: number) {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

function perProduct(row: AiUsageTotals) {
  return row.products ? row.costUsd / row.products : 0
}

function costCell(row: AiUsageTotals) {
  return (
    <span>
      {formatUsd(row.costUsd)}
      {row.unpriced > 0 && <span className="ml-1 text-amber-300" title={`${row.unpriced} запросов без цены модели`}>*</span>}
    </span>
  )
}

export default function AiUsageDashboard({ report }: { report: AiUsageReport }) {
  const { totals } = report
  const maxDayCost = Math.max(...report.days.map((day) => day.costUsd), 0)
  const maxDayRequests = Math.max(...report.days.map((day) => day.requests), 0)
  const peakSavings = totals.peakCostUsd / 2

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((period) => {
          const active = period.days === report.periodDays
          return (
            <Link
              key={period.label}
              href={period.days ? `/admin/ai-usage?days=${period.days}` : '/admin/ai-usage?days=all'}
              className={`rounded-lg border px-3 py-2 text-sm ${active ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}
            >
              {period.label}
            </Link>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Coins} label="Стоимость" value={formatUsd(totals.costUsd)} hint={totals.unpriced ? `${totals.unpriced} запросов без цены модели — не учтены` : `${totals.requests} запросов`} />
        <StatCard icon={Package} label="В среднем на товар" value={totals.products ? formatUsd(perProduct(totals)) : '—'} hint={`${totals.products} товаров выгрузок`} />
        <StatCard icon={Database} label="Токены" value={formatTokens(totals.promptTokens + totals.completionTokens)} hint={`вход ${formatTokens(totals.promptTokens)} · выход ${formatTokens(totals.completionTokens)}`} />
        <StatCard icon={Zap} label="Вход из кэша" value={percent(totals.cachedTokens, totals.promptTokens)} hint={`${formatTokens(totals.cachedTokens)} токенов по цене кэша`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <Insight icon={Brain} title="Размышления модели">
          {totals.completionTokens
            ? <>{percent(totals.reasoningTokens, totals.completionTokens)} выходных токенов ушло на размышления ({formatTokens(totals.reasoningTokens)}). Они оплачиваются как выход.</>
            : 'Нет данных.'}
        </Insight>
        <Insight icon={Clock} title="Часы пик DeepSeek">
          {totals.peakCostUsd > 0
            ? <>В пик потрачено {formatUsd(totals.peakCostUsd)}. Вне пика те же запросы стоили бы на {formatUsd(peakSavings)} меньше. Пик: будни 04:00–07:00 и 09:00–13:00 МСК.</>
            : totals.offpeakCostUsd > 0
              ? <>Все запросы DeepSeek пришлись на часы со скидкой 50%.</>
              : 'Запросов к DeepSeek за период нет.'}
        </Insight>
        <Insight icon={AlertTriangle} title="Неудачные запросы">
          {totals.failed
            ? <>{totals.failed} из {totals.requests} ({percent(totals.failed, totals.requests)}) — обрывы, тайм-ауты и ошибки провайдера. Повторы увеличивают время обработки.</>
            : 'Ошибок провайдера нет.'}
        </Insight>
        <Insight icon={Clock} title="Скорость">
          {totals.avgDurationMs ? <>Средний ответ модели — {(totals.avgDurationMs / 1000).toFixed(1)} с.</> : 'Нет данных.'}
        </Insight>
      </div>

      {report.days.length > 0 && (
        <Section title="По дням">
          <div className="space-y-1.5 p-4">
            {report.days.map((day) => {
              const width = maxDayCost > 0 ? (day.costUsd / maxDayCost) * 100 : maxDayRequests > 0 ? (day.requests / maxDayRequests) * 100 : 0
              return (
                <div key={day.day} className="grid grid-cols-[88px_minmax(0,1fr)_150px] items-center gap-3 text-xs">
                  <span className="text-slate-400">{new Date(`${day.day}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>
                  <div className="h-3 overflow-hidden rounded bg-slate-800"><div className="h-full rounded bg-indigo-500/70" style={{ width: `${Math.max(width, day.requests ? 1 : 0)}%` }} /></div>
                  <span className="text-right text-slate-300">{formatUsd(day.costUsd)} · {day.requests} запр.</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Выгрузки">
        <UsageTable
          empty="За период ИИ не обрабатывал выгрузки."
          head={['Выгрузка', 'Товаров', 'Запросов', 'Вход', 'Кэш', 'Выход', 'Стоимость', 'На товар']}
          rows={report.batches.map((row) => [
            <Link key="name" href={`/admin/batches/${encodeURIComponent(row.batchId)}`} className="block min-w-0 hover:text-indigo-300">
              <span className="block truncate font-medium text-slate-100">{row.supplierName}</span>
              <span className="block truncate text-xs text-slate-500">{row.batchName} · {new Date(row.lastAt).toLocaleDateString('ru-RU')}</span>
            </Link>,
            row.products,
            <span key="requests">{row.requests}{row.failed ? <span className="ml-1 text-red-300">({row.failed} ош.)</span> : null}</span>,
            formatTokens(row.promptTokens),
            percent(row.cachedTokens, row.promptTokens),
            formatTokens(row.completionTokens),
            costCell(row),
            row.products ? formatUsd(perProduct(row)) : '—',
          ])}
        />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Поставщики: средняя цена товара">
          <UsageTable
            empty="Нет данных."
            head={['Поставщик', 'Выгрузок', 'Товаров', 'Стоимость', 'На товар']}
            rows={report.suppliers.map((row) => [
              <span key="name" className="font-medium text-slate-100">{row.supplierName}</span>,
              row.batches,
              row.products,
              costCell(row),
              row.products ? formatUsd(perProduct(row)) : '—',
            ])}
          />
        </Section>
        <Section title="Модели">
          <UsageTable
            empty="Нет данных."
            head={['Модель', 'Запросов', 'Кэш', 'Ответ', 'Стоимость']}
            rows={report.models.map((row) => [
              <span key="model" className="block min-w-0"><span className="block truncate font-mono text-slate-100">{row.model || '—'}</span><span className="block truncate text-xs text-slate-500">{row.host || '—'}</span></span>,
              <span key="requests">{row.requests}{row.failed ? <span className="ml-1 text-red-300">({row.failed} ош.)</span> : null}</span>,
              percent(row.cachedTokens, row.promptTokens),
              row.avgDurationMs ? `${(row.avgDurationMs / 1000).toFixed(1)} с` : '—',
              costCell(row),
            ])}
          />
        </Section>
      </div>

      <Section title="Разделы админки">
        <UsageTable
          empty="Нет данных."
          head={['Раздел', 'Запросов', 'Вход', 'Выход', 'Стоимость']}
          rows={report.features.map((row) => [
            <span key="feature" className="font-medium text-slate-100">{FEATURE_LABELS[row.feature] || row.feature}</span>,
            row.requests,
            formatTokens(row.promptTokens),
            formatTokens(row.completionTokens),
            costCell(row),
          ])}
        />
      </Section>

      <p className="text-xs leading-relaxed text-slate-500">
        * — часть запросов без цены модели: укажите цену в «Настройках ИИ», чтобы она учитывалась. Стоимость фиксируется в момент запроса и не пересчитывается задним числом. Учёт ведётся с момента включения этой вкладки.
      </p>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Coins; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Icon className="h-4 w-4 text-indigo-400" />{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  )
}

function Insight({ icon: Icon, title, children }: { icon: typeof Coins; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white"><Icon className="h-4 w-4 text-amber-300" />{title}</div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{children}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <h2 className="border-b border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

function UsageTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <div className="px-4 py-8 text-center text-sm text-slate-500">{empty}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
            {head.map((cell, index) => <th key={cell} className={`px-4 py-2 font-semibold ${index === 0 ? '' : 'text-right'}`}>{cell}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-800/70 last:border-0">
              {row.map((cell, index) => <td key={index} className={`px-4 py-2 ${index === 0 ? 'max-w-[320px]' : 'whitespace-nowrap text-right text-slate-300'}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

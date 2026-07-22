'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  createExportsV2CampaignAction,
  createExportsV2RunFromHistoryAction,
  resumeExportsV2CampaignAction,
} from '@/actions/exports-v2'
import type {
  V2CampaignSummary,
  V2HistoricalSource,
  V2RunSummary,
  V2SupplierSource,
} from '@/lib/exports-v2-types'
import { exportsV2CampaignTotals } from '@/lib/exports-v2-campaign'

const moscowDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short',
})

function formatDate(value: string | null | undefined) {
  return value ? moscowDate.format(new Date(value)) : '—'
}

function formatCutoff(value: string | null | undefined) {
  if (!value) return 'Без ограничения'
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`))
}

type DashboardData = {
  campaigns: V2CampaignSummary[]
  legacyRuns: V2RunSummary[]
  sources: V2HistoricalSource[]
  suppliers: V2SupplierSource[]
}

export default function ExportsV2Dashboard({ initialData }: { initialData: DashboardData }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [supplierSearch, setSupplierSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [pendingTaskId, setPendingTaskId] = useState<number | null>(null)
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(
    () => new Set(initialData.campaigns[0] ? [initialData.campaigns[0].id] : initialData.legacyRuns.length ? ['legacy'] : []),
  )
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)

  const visibleSuppliers = useMemo(() => {
    const query = supplierSearch.trim().toLowerCase()
    return query ? initialData.suppliers.filter((supplier) => supplier.name.toLowerCase().includes(query)) : initialData.suppliers
  }, [initialData.suppliers, supplierSearch])

  const toggleSupplier = (supplierId: number) => {
    const key = String(supplierId)
    setSelected((current) => {
      const next = { ...current }
      if (key in next) delete next[key]
      else next[key] = ''
      return next
    })
  }

  const createCampaign = async () => {
    const items = Object.entries(selected).map(([supplierId, endDate]) => ({ supplierId: Number(supplierId), endDate }))
    if (!items.length) {
      setError('Выберите хотя бы одного поставщика')
      return
    }
    setCreating(true)
    setError('')
    const result = await createExportsV2CampaignAction(items)
    setCreating(false)
    if (!result.success) {
      setError(result.error || 'Не удалось создать папку выгрузки')
      return
    }
    setSelected({})
    router.refresh()
  }

  const resumeCampaign = async (campaignId: string) => {
    setPendingCampaignId(campaignId)
    setError('')
    const result = await resumeExportsV2CampaignAction(campaignId)
    setPendingCampaignId(null)
    if (!result.success) setError(result.error || 'Не удалось продолжить очередь')
    router.refresh()
  }

  const createRun = async (taskId: number) => {
    setPendingTaskId(taskId)
    setError('')
    const result = await createExportsV2RunFromHistoryAction(taskId)
    setPendingTaskId(null)
    if (!result.success) {
      setError(result.error || 'Не удалось создать тестовый запуск')
      return
    }
    router.push(`/admin/exports-v2/${result.data.id}`)
  }

  const toggleCampaign = (id: string) => setExpandedCampaigns((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleRun = (id: string) => setExpandedRuns((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const folders: V2CampaignSummary[] = [
    ...initialData.campaigns,
    ...(initialData.legacyRuns.length ? [{
      id: 'legacy', name: 'Ранее созданные', status: 'COMPLETED',
      started_at: initialData.legacyRuns[0].created_at, completed_at: null,
      created_at: initialData.legacyRuns[0].created_at, runs: initialData.legacyRuns,
    }] : []),
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 to-cyan-950/30 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-cyan-300"><FolderOpen className="h-4 w-4" /> Основные выгрузки</div>
            <h1 className="mt-2 text-3xl font-bold text-white">Выгрузка 2.0</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Каждая папка — отдельный запуск выбранных поставщиков. Парсер идёт по очереди, а уже встречавшиеся external_id пропускаются.</p>
          </div>
          <button type="button" onClick={() => router.refresh()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-slate-300 hover:bg-slate-800"><RefreshCw className="h-4 w-4" /> Обновить статусы</button>
        </div>
      </section>

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4" /> {error}</div>}

      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
        <div className="flex flex-col gap-5 xl:flex-row">
          <div className="xl:w-72">
            <div className="flex items-center gap-2 text-lg font-bold text-white"><FolderPlus className="h-5 w-5 text-cyan-300" /> Новая папка</div>
            <p className="mt-2 text-sm leading-5 text-slate-400">Дата старта проставится автоматически. Для каждого поставщика можно задать свою дату окончания.</p>
            <div className="mt-4 rounded-xl bg-slate-950/60 p-3 text-sm text-slate-300">Выбрано поставщиков: <b className="text-white">{Object.keys(selected).length}</b></div>
            <button type="button" onClick={createCampaign} disabled={creating || Object.keys(selected).length === 0} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 font-bold text-white hover:bg-cyan-500 disabled:opacity-40">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Создать и запустить очередь</button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Найти поставщика" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white outline-none focus:border-cyan-500" /></div>
            <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-800">
              {visibleSuppliers.map((supplier) => {
                const key = String(supplier.id)
                const checked = key in selected
                return <div key={supplier.id} className={`flex flex-col gap-3 border-b border-slate-800 p-3 last:border-0 sm:flex-row sm:items-center ${checked ? 'bg-cyan-500/5' : 'bg-slate-950/30'}`}>
                  <button type="button" onClick={() => toggleSupplier(supplier.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <SupplierAvatar name={supplier.name} url={supplier.avatar_url} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">{supplier.name}</span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? 'border-cyan-400 bg-cyan-500 text-slate-950' : 'border-slate-600'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                  </button>
                  {checked && <label className="flex items-center gap-2 text-xs text-slate-500"><span>Дата окончания</span><input type="date" value={selected[key]} onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.value }))} className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200 outline-none focus:border-cyan-500" /></label>}
                </div>
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between"><div><h2 className="text-xl font-bold text-white">Папки выгрузок</h2><p className="mt-1 text-sm text-slate-400">Раскройте папку, затем поставщика.</p></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold text-slate-300">{folders.length}</span></div>
        {folders.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center"><PackageOpen className="mx-auto h-10 w-10 text-slate-600" /><p className="mt-3 text-sm text-slate-400">Создайте первую папку и выберите поставщиков.</p></div> : folders.map((campaign) => (
          <CampaignFolder key={campaign.id} campaign={campaign} expanded={expandedCampaigns.has(campaign.id)} expandedRuns={expandedRuns} onToggle={() => toggleCampaign(campaign.id)} onToggleRun={toggleRun} onResume={() => resumeCampaign(campaign.id)} pendingResume={pendingCampaignId === campaign.id} />
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
        <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between p-5 text-left"><div><div className="font-bold text-slate-200">Исторические сырые файлы V1</div><div className="mt-1 text-xs text-slate-500">Нужны только для старых сравнительных примеров.</div></div>{historyOpen ? <ChevronUp className="h-5 w-5 text-slate-500" /> : <ChevronDown className="h-5 w-5 text-slate-500" />}</button>
        {historyOpen && <div className="divide-y divide-slate-800 border-t border-slate-800">{initialData.sources.map((source) => <div key={source.task_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Database className="h-5 w-5 text-slate-500" /><div><div className="font-semibold text-slate-200">{source.supplier_name}</div><div className="mt-1 text-xs text-slate-500">Файл #{source.task_id} · {source.items_count} альбомов · {formatDate(source.created_at)}</div></div></div>{source.already_imported_run_id ? <Link href={`/admin/exports-v2/${source.already_imported_run_id}`} className="text-sm font-semibold text-cyan-300">Открыть <ArrowRight className="inline h-4 w-4" /></Link> : <button type="button" onClick={() => createRun(source.task_id)} disabled={pendingTaskId !== null} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-slate-700 px-4 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50">{pendingTaskId === source.task_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />} Импортировать</button>}</div>)}</div>}
      </section>
    </div>
  )
}

function CampaignFolder({ campaign, expanded, expandedRuns, onToggle, onToggleRun, onResume, pendingResume }: { campaign: V2CampaignSummary; expanded: boolean; expandedRuns: Set<string>; onToggle: () => void; onToggleRun: (id: string) => void; onResume: () => void; pendingResume: boolean }) {
  const totals = exportsV2CampaignTotals(campaign.runs)
  const hasQueued = campaign.runs.some((run) => run.status === 'QUEUED')
  const hasActive = campaign.runs.some((run) => ['STARTING', 'RUNNING'].includes(run.status))
  return <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60">
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300"><FolderOpen className="h-5 w-5" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-white">{campaign.name}</span><CampaignStatus status={campaign.status} /></div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500"><span><CalendarDays className="mr-1 inline h-3.5 w-3.5" />{formatDate(campaign.started_at)}</span><span>{campaign.runs.length} поставщиков</span></div></div></button>
      <div className="grid grid-cols-3 gap-2 text-center"><SmallMetric label="Альбомы" value={totals.albums} /><SmallMetric label="Товары" value={totals.products} /><SmallMetric label="Запушено" value={totals.pushed} /></div>
      {hasQueued && !hasActive && campaign.id !== 'legacy' && <button type="button" onClick={onResume} disabled={pendingResume} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-bold text-amber-200">{pendingResume ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Продолжить очередь</button>}
      <button type="button" onClick={onToggle} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white">{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>
    </div>
    {expanded && <div className="divide-y divide-slate-800 border-t border-slate-700">{campaign.runs.map((run) => <SupplierRun key={run.id} run={run} expanded={expandedRuns.has(run.id)} onToggle={() => onToggleRun(run.id)} />)}</div>}
  </div>
}

function SupplierRun({ run, expanded, onToggle }: { run: V2RunSummary; expanded: boolean; onToggle: () => void }) {
  return <div className="bg-slate-950/20"><button type="button" onClick={onToggle} className="flex w-full flex-col gap-3 px-4 py-3 text-left lg:flex-row lg:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><SupplierAvatar name={run.supplier_name} url={run.supplier_avatar} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-slate-100">{run.supplier_name}</span><RunStatus status={run.status} /></div><div className="mt-1 text-xs text-slate-500">До: {formatCutoff(run.cutoff_date)}{run.queue_position === null ? ' · старый запуск' : ` · позиция #${Number(run.queue_position) + 1}`}</div></div></div><div className="grid grid-cols-4 gap-2 text-center"><SmallMetric label="Альбомы" value={run.album_count} /><SmallMetric label="Товары" value={run.draft_count} /><SmallMetric label="К пушу" value={run.ready_to_push_count} /><SmallMetric label="В БД" value={run.pushed_count} /></div>{expanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}</button>
    {expanded && <div className="grid gap-3 border-t border-slate-800 px-4 py-4 md:grid-cols-[1fr_auto]"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Detail icon={ImageIcon} label="Новых" value={run.last_inserted_count} /><Detail icon={Database} label="Пропущено прошлых" value={run.last_duplicate_count} /><Detail icon={Sparkles} label="Карточки AI" value={run.ai_processed_count} /><Detail icon={Check} label="Примеры" value={run.training_example_count} /></div><Link href={`/admin/exports-v2/${run.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500">Открыть выгрузку и обработку <ArrowRight className="h-4 w-4" /></Link>{run.last_error && <div className="md:col-span-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-300">{run.last_error}</div>}</div>}
  </div>
}

function SupplierAvatar({ name, url }: { name: string; url: string | null }) { return <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-sm font-bold text-slate-300">{url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}</div> }
function SmallMetric({ label, value }: { label: string; value: number }) { return <div className="min-w-16 rounded-lg bg-slate-950/60 px-2 py-1.5"><div className="text-sm font-bold text-slate-200">{Number(value || 0)}</div><div className="text-[9px] uppercase text-slate-600">{label}</div></div> }
function Detail({ icon: Icon, label, value }: { icon: typeof ImageIcon; label: string; value: number }) { return <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2"><Icon className="h-3.5 w-3.5 text-slate-500" /><div className="mt-1 text-sm font-bold text-slate-200">{Number(value || 0)}</div><div className="text-[10px] text-slate-600">{label}</div></div> }
function CampaignStatus({ status }: { status: string }) { const label: Record<string, string> = { QUEUED: 'В очереди', RUNNING: 'Парсинг', COMPLETED: 'Парсинг готов', COMPLETED_WITH_ERRORS: 'Парсинг с ошибками' }; return <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-400">{label[status] || status}</span> }
function RunStatus({ status }: { status: string }) { const label: Record<string, string> = { QUEUED: 'В очереди', STARTING: 'Запускается', RUNNING: 'Парсинг', READY_FOR_GROUPING: 'К объединению', GROUPING: 'Обработка', READY_FOR_AI: 'К AI', FAILED: 'Ошибка', ARCHIVED: 'Архив' }; const color = status === 'FAILED' ? 'border-red-500/30 text-red-300' : ['STARTING', 'RUNNING'].includes(status) ? 'border-cyan-500/30 text-cyan-300' : status === 'QUEUED' ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/30 text-emerald-300'; return <span className={`rounded-full border bg-slate-950 px-2 py-0.5 text-[10px] font-bold ${color}`}>{label[status] || status}</span> }

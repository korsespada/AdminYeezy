'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AlertTriangle, ArrowRight, Database, FlaskConical, Loader2, LockKeyhole, PackageOpen, Play } from 'lucide-react'
import { createExportsV2RunFromHistoryAction, startExportsV2ScrapingAction } from '@/actions/exports-v2'
import type { V2HistoricalSource, V2RunSummary, V2SupplierSource } from '@/lib/exports-v2-types'

const moscowDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' })

function formatDate(value: string) {
  return moscowDate.format(new Date(value))
}

export default function ExportsV2Dashboard({ initialData }: {
  initialData: { runs: V2RunSummary[]; sources: V2HistoricalSource[]; suppliers: V2SupplierSource[] }
}) {
  const router = useRouter()
  const [pendingTaskId, setPendingTaskId] = useState<number | null>(null)
  const [pendingSupplierId, setPendingSupplierId] = useState<number | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState('')

  const startNativeRun = async () => {
    const id = Number(supplierId)
    if (!Number.isFinite(id) || id <= 0) {
      setError('Выберите поставщика')
      return
    }

    setPendingSupplierId(id)
    setError('')
    const result = await startExportsV2ScrapingAction(id, endDate || undefined)
    setPendingSupplierId(null)
    if (!result.success) {
      setError(result.error || 'Не удалось запустить DB-native выгрузку')
      return
    }
    router.push(`/admin/exports-v2/${result.data.runId}`)
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

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/30">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <FlaskConical className="h-4 w-4" /> Безопасный контур
            </div>
            <h1 className="text-3xl font-bold text-white">Выгрузка 2.0</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Исходные альбомы остаются неизменными. Здесь можно объединять их в товары,
              назначать роли источникам и сохранять реальные примеры для будущей AI-группировки.
            </p>
          </div>
          <div className="flex min-w-64 items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <div className="font-semibold">Production-пуш отключён</div>
              <div className="mt-1 text-xs leading-5 text-amber-200/80">V2 пока не может изменить основной каталог или фотографии.</div>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white">Новая DB-native выгрузка</h2>
            <p className="mt-1 text-sm text-slate-400">
              Парсер сохраняет исходные альбомы сразу в V2. Повторный запуск добавит только новые external_id и сохранит ревизии изменившихся альбомов.
            </p>
          </div>
          <label className="grid min-w-64 gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Поставщик
            <select
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-500"
            >
              <option value="">Выберите поставщика</option>
              {initialData.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Не старше даты
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-500"
            />
          </label>
          <button
            type="button"
            onClick={startNativeRun}
            disabled={pendingSupplierId !== null}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {pendingSupplierId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Запустить
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Тестовые запуски</h2>
            <p className="mt-1 text-sm text-slate-400">Изолированные копии для ручной разметки и сравнения.</p>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">{initialData.runs.length}</span>
        </div>

        {initialData.runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center">
            <PackageOpen className="mx-auto h-10 w-10 text-slate-600" />
            <div className="mt-3 font-semibold text-slate-300">Запусков пока нет</div>
            <div className="mt-1 text-sm text-slate-500">Создайте безопасную копию одной из исторических сырых выгрузок ниже.</div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {initialData.runs.map((run) => (
              <Link
                key={run.id}
                href={`/admin/exports-v2/${run.id}`}
                className="group rounded-2xl border border-slate-700 bg-slate-800/70 p-5 transition hover:border-cyan-500/40 hover:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-lg font-bold text-white">{run.supplier_name}</div>
                      <RunStatus status={run.status} />
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{run.name}</div>
                    {run.source_kind === 'DB_NATIVE' && run.last_completed_at && (
                      <div className="mt-2 text-xs text-slate-400">
                        Последний проход: +{run.last_inserted_count} новых · {run.last_updated_count} изменено · {run.last_unchanged_count} без изменений
                      </div>
                    )}
                    {run.last_error && <div className="mt-2 line-clamp-2 text-xs text-red-300">{run.last_error}</div>}
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-500 transition group-hover:translate-x-1 group-hover:text-cyan-300" />
                </div>
                <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                  <Metric label="Альбомы" value={run.album_count} />
                  <Metric label="Размечено" value={run.assigned_count} />
                  <Metric label="Товары" value={run.draft_count} />
                  <Metric label="Примеры" value={run.training_example_count} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Исторические примеры V1</h2>
          <p className="mt-1 text-sm text-slate-400">
            Одноразовый импорт нужен только для сравнения старых скриптов и обучения разметки. Новый парсер V2 будет писать в БД напрямую.
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/60">
          <div className="divide-y divide-slate-800">
            {initialData.sources.map((source) => (
              <div key={source.task_id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-cyan-300">
                    <Database className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100">{source.supplier_name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>Файл #{source.task_id}</span>
                      <span>{source.items_count} альбомов</span>
                      <span>{formatDate(source.created_at)}</span>
                      {source.script_name && <span>Скрипт: {source.script_name.trim()}</span>}
                    </div>
                  </div>
                </div>
                {source.already_imported_run_id ? (
                  <Link
                    href={`/admin/exports-v2/${source.already_imported_run_id}`}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Открыть копию <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => createRun(source.task_id)}
                    disabled={pendingTaskId !== null}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {pendingTaskId === source.task_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                    Создать тест V2
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function RunStatus({ status }: { status: string }) {
  const style = status === 'RUNNING'
    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
    : status === 'FAILED'
      ? 'border-red-500/30 bg-red-500/10 text-red-200'
      : 'border-slate-600 bg-slate-900 text-slate-300'
  const label = status === 'RUNNING' ? 'Идёт' : status === 'FAILED' ? 'Ошибка' : status === 'READY_FOR_GROUPING' ? 'К разметке' : status === 'GROUPING' ? 'Разметка' : status
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${style}`}>{label}</span>
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-950/50 px-2 py-3">
      <div className="text-lg font-bold text-slate-100">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

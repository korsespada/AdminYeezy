'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  checkBatchAiProxiesAction,
  deleteBatchAiProxyAction,
  getBatchAiProxiesAction,
  getBatchAiProxyAllProvidersAction,
  saveBatchAiProxyAction,
  setBatchAiProxyAllProvidersAction,
} from '@/actions/batch-ai'

type ProxyStatus = 'unknown' | 'ok' | 'fail'

type ProxyRow = {
  id: string
  url: string
  label: string
  enabled: boolean
  status: ProxyStatus
  latencyMs: number | null
  checkedAt: string | null
  lastError: string
}

const STATUS_STYLE: Record<ProxyStatus, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'работает' },
  fail: { dot: 'bg-rose-500', text: 'text-rose-300', label: 'не отвечает' },
  unknown: { dot: 'bg-slate-500', text: 'text-slate-400', label: 'не проверялся' },
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.password) url.password = '••••'
    return url.toString()
  } catch {
    return value
  }
}

function formatCheckedAt(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Прокси для ИИ в «Настройках ИИ». BYESU ходит через пул всегда, остальные
 * провайдеры — при включённом флажке «Все провайдеры ИИ через прокси».
 *
 * С сервера админки крупные запросы к byesu.com по HTTP/1.1 не доходят, поэтому
 * карточки идут через прокси. Один адрес — единая точка отказа, здесь ведётся
 * список: рабочая строка идёт первой, упавшая — последней, и обработка сама
 * пробует следующий прокси при обрыве.
 */
export default function BatchAiProxySettings() {
  const [rows, setRows] = useState<ProxyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [allProviders, setAllProviders] = useState(false)

  const load = useCallback(async () => {
    const [result, scope] = await Promise.all([getBatchAiProxiesAction(), getBatchAiProxyAllProvidersAction()])
    if (result.success) setRows(result.data as ProxyRow[])
    else setError('Не удалось загрузить прокси')
    if (scope.success) setAllProviders(Boolean(scope.data))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key)
    setError('')
    try {
      const result = await action()
      if (!result.success) setError(result.error || 'Ошибка сохранения')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const addProxy = () => run('add', async () => {
    const result = await saveBatchAiProxyAction({ url, label })
    if (result.success) {
      setUrl('')
      setLabel('')
    }
    return result
  })

  return (
    <section className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Прокси для ИИ</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Запросы к byesu.com идут через прокси всегда: напрямую с сервера большие тела с фотографиями не доходят.
            Если прокси перестаёт отвечать, обработка сама пробует следующий по списку.
          </p>
          <label className="mt-3 flex max-w-3xl items-start gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-indigo-500"
              checked={allProviders}
              disabled={busy !== null || loading}
              onChange={(event) => {
                const next = event.target.checked
                void run('scope', async () => {
                  const result = await setBatchAiProxyAllProvidersAction(next)
                  if (result.success) setAllProviders(next)
                  return result
                })
              }}
            />
            <span>
              Все провайдеры ИИ через прокси
              <span className="block text-xs text-slate-500">OpenRouter, Anthropic-совместимые, DeepSeek и остальные провайдеры тоже идут через этот список. Выключено — только BYESU.</span>
            </span>
          </label>
        </div>
        <button
          type="button"
          onClick={() => void run('check', () => checkBatchAiProxiesAction())}
          disabled={busy !== null || !rows.length}
          className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-200 disabled:opacity-40"
        >
          {busy === 'check' ? 'Проверяю…' : 'Проверить все'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-slate-500">Загружаю…</p>}
        {!loading && !rows.length && (
          <p className="text-sm text-slate-500">Прокси не добавлены — обработка идёт напрямую.</p>
        )}
        {rows.map((row) => {
          const style = STATUS_STYLE[row.status] || STATUS_STYLE.unknown
          return (
            <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-950/40 px-3 py-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
              <div className="min-w-[240px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all text-xs text-slate-200">
                    {revealed[row.id] ? row.url : maskProxyUrl(row.url)}
                  </code>
                  <button
                    type="button"
                    onClick={() => setRevealed((current) => ({ ...current, [row.id]: !current[row.id] }))}
                    className="text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                  >
                    {revealed[row.id] ? 'скрыть' : 'показать'}
                  </button>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {row.label && <span>{row.label}</span>}
                  <span className={style.text}>{style.label}</span>
                  {row.latencyMs != null && <span>{row.latencyMs} мс</span>}
                  <span>проверка: {formatCheckedAt(row.checkedAt)}</span>
                  {row.lastError && <span className="text-rose-300/80">{row.lastError}</span>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(event) => void run(row.id, () => saveBatchAiProxyAction({ id: row.id, url: row.url, label: row.label, enabled: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-500"
                />
                включён
              </label>
              <button
                type="button"
                onClick={() => void run(`delete-${row.id}`, () => deleteBatchAiProxyAction(row.id))}
                disabled={busy !== null}
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-rose-500/50 hover:text-rose-200 disabled:opacity-40"
              >
                {busy === `delete-${row.id}` ? 'Удаляю…' : 'Удалить'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-xs text-slate-400">
          Адрес прокси
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://user:pass@1.2.3.4:8888"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-xs text-slate-400">
          Подпись
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="FR Paris"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
        </label>
        <button
          type="button"
          onClick={() => void addProxy()}
          disabled={busy !== null || !url.trim()}
          className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy === 'add' ? 'Добавляю…' : 'Добавить'}
        </button>
      </div>
    </section>
  )
}

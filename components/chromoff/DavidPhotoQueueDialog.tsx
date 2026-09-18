'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { requeueDavidProblemPhotosAction } from '@/actions/david-studio'

/**
 * Очередь чистки фото David: сколько всего, сколько осталось и где именно.
 * Пока в очереди есть незабранные задания, данные обновляются сами.
 */

interface QueueTotals {
  total: number
  pending: number
  claimed: number
  ok: number
  review: number
  miss: number
  failed: number
}

interface QueueProduct {
  handle: string
  title: string
  total: number
  pending: number
  claimed: number
  ok: number
  review: number
  miss: number
  failed: number
  published: boolean
  lastUpdate: string | null
}

interface QueuePayload {
  totals: QueueTotals
  products: QueueProduct[]
  remaining: number
  productsInCatalog: number
}

function percent(done: number, total: number) {
  if (!total) return 0
  return Math.round((done / total) * 100)
}

export default function DavidPhotoQueueDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = useState<QueuePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/david-photo-queue', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      setData(payload)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось прочитать очередь')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const remaining = data?.remaining ?? 0
  useEffect(() => {
    if (!open || remaining === 0) return
    const timer = setInterval(() => { void load() }, 5000)
    return () => clearInterval(timer)
  }, [open, remaining, load])

  const totals = data?.totals
  const done = (totals?.ok || 0) + (totals?.review || 0) + (totals?.miss || 0)
  const active = (data?.products || []).filter((product) => product.pending + product.claimed > 0)
  const problems = (totals?.miss || 0) + (totals?.review || 0) + (totals?.failed || 0)

  const requeueProblems = async () => {
    setLoading(true)
    try {
      const result: any = await requeueDavidProblemPhotosAction(null)
      if (!result?.success) throw new Error(result?.error || 'Не получилось')
      await load()
    } catch (requeueError) {
      setError(requeueError instanceof Error ? requeueError.message : 'Не удалось вернуть кадры в очередь')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border-slate-700 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle>Очередь чистки фото David Studio</DialogTitle>
          <DialogDescription className="text-slate-400">
            Задания берёт локальный воркер. Пока есть незабранные кадры, список обновляется сам.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void load() }}
            disabled={loading}
            className="border-slate-600 bg-slate-800 text-slate-200"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </Button>
          {remaining > 0 && (
            <span className="text-xs text-amber-300">осталось {remaining.toLocaleString('ru-RU')} — воркер работает</span>
          )}
          {remaining === 0 && data && <span className="text-xs text-emerald-300">очередь разобрана</span>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void requeueProblems() }}
            disabled={loading || problems === 0}
            title="Вернуть в очередь кадры «не найдена», «на глаза» и сбои"
            className="border-slate-600 bg-slate-800 text-slate-200"
          >
            <RotateCcw className="h-4 w-4" />
            Переочистить проблемные ({problems})
          </Button>
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}

        {totals && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Всего кадров', value: totals.total },
                { label: 'Осталось', value: remaining, tone: 'text-amber-300' },
                { label: 'В работе', value: totals.claimed },
                { label: 'Очищено', value: totals.ok, tone: 'text-emerald-300' },
                { label: 'На глаза', value: totals.review, tone: 'text-amber-300' },
                { label: 'Не найдена', value: totals.miss, tone: 'text-slate-300' },
                { label: 'Ошибки', value: totals.failed, tone: 'text-rose-300' },
                { label: 'Готово, %', value: `${percent(done, totals.total)}%` },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{item.label}</div>
                  <div className={`text-lg font-semibold ${item.tone || 'text-slate-100'}`}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500/70"
                style={{ width: `${percent(done, totals.total)}%` }}
              />
            </div>
          </>
        )}

        {active.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">Где осталось ({active.length})</h3>
            <div className="divide-y divide-slate-700 overflow-hidden rounded-lg border border-slate-700">
              {active.map((product) => (
                <div key={product.handle} className="flex flex-wrap items-center justify-between gap-2 bg-slate-800/40 px-3 py-2 text-sm">
                  <Link
                    href={`/admin/chromoff/david-studio/import/${product.handle}`}
                    className="min-w-0 flex-1 truncate text-slate-100 hover:text-violet-300"
                    title={product.title}
                  >
                    {product.title}
                  </Link>
                  <span className="text-xs text-slate-400">
                    очищено {product.ok + product.review + product.miss}/{product.total}
                  </span>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                    в очереди {product.pending + product.claimed}
                  </Badge>
                  {product.miss > 0 && (
                    <Badge variant="outline" className="border-slate-600 text-slate-300">не найдена {product.miss}</Badge>
                  )}
                  {product.review > 0 && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-200">на глаза {product.review}</Badge>
                  )}
                  {product.published && (
                    <Badge className="bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20">в Chromoff</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data && active.length === 0 && (
          <p className="text-sm text-slate-400">
            Незабранных заданий нет. Всего обработано {totals?.total.toLocaleString('ru-RU')} кадров, товаров в выгрузке{' '}
            {data.productsInCatalog.toLocaleString('ru-RU')}.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

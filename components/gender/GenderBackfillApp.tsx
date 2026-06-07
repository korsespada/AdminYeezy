'use client'

import React, { useMemo, useState } from 'react'
import Image from 'next/image'
import { Check, Download, FileSpreadsheet, Search, Upload, Users } from 'lucide-react'
import {
  applyGenderUpdatesAction,
  exportGenderBackfillReportAction,
  parseGenderCsvAction,
  previewGenderMatchesAction,
} from '@/actions/gender-backfill'
import {
  GENDER_VALUES,
  type GenderBackfillPreviewRow,
  type GenderBackfillStatus,
  type GenderValue,
} from '@/lib/gender-backfill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CHUNK_SIZE = 40

const STATUS_LABELS: Record<GenderBackfillStatus | 'all' | 'found', string> = {
  all: 'Все',
  found: 'Найден',
  ready: 'Готово',
  needs_review: 'Нужен выбор',
  not_found: 'Не найден',
  has_gender: 'Уже есть',
  applied: 'Применено',
  skipped: 'Пропущено',
  error: 'Ошибка',
}

const STATUS_TONES: Record<GenderBackfillStatus, string> = {
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  needs_review: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  not_found: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  has_gender: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  applied: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  skipped: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
}

function rowKey(row: GenderBackfillPreviewRow) {
  return `${row.rowNumber}:${row.csvProductId}`
}

function canSelect(row: GenderBackfillPreviewRow) {
  return Boolean(row.product && !row.product.gender && !['not_found', 'has_gender', 'skipped', 'error', 'applied'].includes(row.status))
}

function canApply(row: GenderBackfillPreviewRow) {
  return canSelect(row) && row.selected && Boolean(row.selectedGender)
}

function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function GenderBackfillApp() {
  const [rows, setRows] = useState<GenderBackfillPreviewRow[]>([])
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState('')
  const [statusFilter, setStatusFilter] = useState<GenderBackfillStatus | 'all' | 'found'>('all')
  const [search, setSearch] = useState('')
  const [bulkGender, setBulkGender] = useState<GenderValue>('Для женщин')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [message, setMessage] = useState('')

  const stats = useMemo(() => {
    return rows.reduce((acc, row) => {
      acc.total += 1
      if (row.product) acc.found += 1
      if (canApply(row)) acc.toApply += 1
      acc[row.status] = (acc[row.status] || 0) + 1
      return acc
    }, { total: 0, found: 0, toApply: 0 } as Record<string, number>)
  }, [rows])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter === 'found' && !row.product) return false
      if (statusFilter !== 'all' && statusFilter !== 'found' && row.status !== statusFilter) return false
      if (!needle) return true
      return [
        row.csvProductId,
        row.csvName,
        row.product?.name,
        row.product?.sku,
        row.product?.external_id,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [rows, search, statusFilter])

  const analyzeCsv = async (text: string, name: string) => {
    setLoading(true)
    setMessage('')
    setFileName(name)
    setRows([])
    setExcludedKeys(new Set())
    setProgress({ current: 0, total: 0 })

    try {
      const parsed = await parseGenderCsvAction(text)
      if (!parsed.success || !parsed.data) throw new Error(parsed.error || 'CSV не прочитан')

      setProgress({ current: 0, total: parsed.data.totalRows })

      let cursor = 0
      const nextRows: GenderBackfillPreviewRow[] = []
      while (cursor < parsed.data.rows.length) {
        const preview = await previewGenderMatchesAction(parsed.data.rows, cursor, CHUNK_SIZE)
        if (!preview.success || !preview.data) throw new Error(preview.error || 'Preview не построен')

        nextRows.push(...preview.data.rows)
        setRows([...nextRows])
        cursor = preview.data.nextCursor
        setProgress({ current: cursor, total: parsed.data.totalRows })
        if (preview.data.done) break
      }

      setMessage(`Готово: найдено ${nextRows.filter((row) => row.product).length} из ${parsed.data.rows.length}`)
    } catch (error: any) {
      setMessage(error.message || 'Ошибка анализа')
    } finally {
      setLoading(false)
    }
  }

  const handleFile = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    await analyzeCsv(text, file.name)
  }

  const updateRow = (key: string, patch: Partial<GenderBackfillPreviewRow>) => {
    setRows((current) => current.map((row) => rowKey(row) === key ? { ...row, ...patch } : row))
  }

  const toggleRow = (row: GenderBackfillPreviewRow, checked: boolean) => {
    const key = rowKey(row)
    setExcludedKeys((current) => {
      const next = new Set(current)
      if (checked) next.delete(key)
      else next.add(key)
      return next
    })
    updateRow(key, { selected: checked })
  }

  const assignFound = () => {
    setRows((current) => current.map((row) => {
      const key = rowKey(row)
      if (!canSelect(row) || excludedKeys.has(key)) return row
      return {
        ...row,
        selected: true,
        selectedGender: bulkGender,
        status: row.status === 'needs_review' ? 'ready' : row.status,
        reason: row.reason || 'Назначено массово',
      }
    }))
  }

  const assignSelected = () => {
    setRows((current) => current.map((row) => {
      if (!canSelect(row) || !row.selected) return row
      return {
        ...row,
        selectedGender: bulkGender,
        status: row.status === 'needs_review' ? 'ready' : row.status,
      }
    }))
  }

  const selectVisible = (checked: boolean) => {
    const visibleKeys = new Set(filteredRows.filter(canSelect).map(rowKey))
    setExcludedKeys((current) => {
      const next = new Set(current)
      for (const key of visibleKeys) {
        if (checked) next.delete(key)
        else next.add(key)
      }
      return next
    })
    setRows((current) => current.map((row) => visibleKeys.has(rowKey(row)) ? { ...row, selected: checked } : row))
  }

  const applySelected = async () => {
    const targets = rows.filter(canApply)
    if (targets.length === 0) {
      setMessage('Нет выбранных строк с gender')
      return
    }

    setApplying(true)
    setMessage('')
    try {
      const result = await applyGenderUpdatesAction(targets.map((row) => ({
        productId: row.product!.id,
        gender: row.selectedGender as GenderValue,
      })))
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось применить')

      const itemResults = new Map(result.data.items.map((item) => [item.productId, item]))
      setRows((current) => current.map((row) => {
        if (!row.product) return row
        const item = itemResults.get(row.product.id)
        if (!item) return row
        return {
          ...row,
          status: item.status === 'updated' ? 'applied' : item.status === 'skipped' ? 'skipped' : 'error',
          selected: false,
          message: item.message,
        }
      }))
      setMessage(`Обновлено: ${result.data.updated}, пропущено: ${result.data.skipped}, ошибок: ${result.data.failed}`)
    } catch (error: any) {
      setMessage(error.message || 'Ошибка применения')
    } finally {
      setApplying(false)
    }
  }

  const exportReport = async () => {
    const result = await exportGenderBackfillReportAction(rows)
    if (result.success && result.data) {
      downloadCsv(result.data.fileName, result.data.content)
    } else {
      setMessage(result.error || 'Не удалось скачать отчет')
    }
  }

  return (
    <div className="min-h-full bg-slate-900 px-4 py-6 text-slate-200 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Проставление гендера</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-400">
              <span>{fileName || 'CSV не выбран'}</span>
              <span>•</span>
              <span>{stats.total || 0} строк</span>
              <span>•</span>
              <span>{stats.found || 0} найдено</span>
              <span>•</span>
              <span>{stats.toApply || 0} к применению</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500">
              <Upload className="h-4 w-4" />
              CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={exportReport}
              disabled={rows.length === 0}
              className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              <Download className="mr-2 h-4 w-4" />
              Отчет
            </Button>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-800/40 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="grid gap-3 sm:grid-cols-[220px_1fr] lg:grid-cols-[220px_220px_1fr]">
            <Select value={bulkGender} onValueChange={(value) => setBulkGender(value as GenderValue)}>
              <SelectTrigger className="border-slate-700 bg-slate-900 text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDER_VALUES.map((gender) => (
                  <SelectItem key={gender} value={gender}>{gender}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={assignFound}
                disabled={rows.length === 0}
                className="flex-1"
              >
                <Users className="mr-2 h-4 w-4" />
                Всем найденным
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={assignSelected}
                disabled={rows.length === 0}
                className="flex-1 border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-700"
              >
                Выбранным
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск"
                className="border-slate-700 bg-slate-900 pl-9 text-slate-100"
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={applySelected}
            disabled={applying || rows.filter(canApply).length === 0}
            className="bg-emerald-600 text-white hover:bg-emerald-500"
          >
            <Check className="mr-2 h-4 w-4" />
            {applying ? 'Применение...' : 'Apply selected'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['all', 'found', 'ready', 'needs_review', 'not_found', 'has_gender', 'applied', 'error'] as const).map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={statusFilter === status ? 'default' : 'outline'}
              onClick={() => setStatusFilter(status)}
              className={statusFilter === status ? '' : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'}
            >
              {STATUS_LABELS[status]} {status !== 'all' && status !== 'found' ? stats[status] || 0 : ''}
            </Button>
          ))}
        </div>

        {(loading || progress.total > 0) && (
          <div className="overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-2 bg-indigo-500 transition-all"
              style={{ width: `${progress.total ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0}%` }}
            />
          </div>
        )}

        {message && (
          <div className="rounded-md border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-300">
            {message}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-800/30 text-slate-400">
            <FileSpreadsheet className="mb-4 h-10 w-10 text-slate-500" />
            <span>{loading ? `Анализ ${progress.current}/${progress.total}` : 'Загрузите CSV'}</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-800">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="w-10 px-3 py-3">
                      <Checkbox
                        checked={filteredRows.length > 0 && filteredRows.filter(canSelect).every((row) => row.selected)}
                        onCheckedChange={(checked) => selectVisible(Boolean(checked))}
                        className="border-slate-500"
                      />
                    </th>
                    <th className="px-3 py-3">Товар</th>
                    <th className="px-3 py-3">SKU / CSV</th>
                    <th className="px-3 py-3">Текущий</th>
                    <th className="px-3 py-3">Gender</th>
                    <th className="px-3 py-3">Статус</th>
                    <th className="px-3 py-3">Причина</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900">
                  {filteredRows.map((row) => (
                    <tr key={rowKey(row)} className="align-top hover:bg-slate-800/50">
                      <td className="px-3 py-4">
                        <Checkbox
                          checked={row.selected}
                          disabled={!canSelect(row)}
                          onCheckedChange={(checked) => toggleRow(row, Boolean(checked))}
                          className="border-slate-500"
                        />
                      </td>
                      <td className="min-w-[280px] px-3 py-4">
                        <div className="flex gap-3">
                          {row.product?.thumb ? (
                            <Image src={row.product.thumb} alt="" width={56} height={56} unoptimized className="h-14 w-14 rounded-md object-cover" />
                          ) : (
                            <div className="h-14 w-14 rounded-md bg-slate-800" />
                          )}
                          <div>
                            <div className="font-medium text-slate-100">{row.product?.name || row.csvName || 'Без названия'}</div>
                            <div className="mt-1 line-clamp-2 max-w-md text-xs text-slate-500">{row.csvName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="min-w-[220px] px-3 py-4 font-mono text-xs text-slate-400">
                        <div>{row.product?.sku || row.product?.external_id || '—'}</div>
                        <div className="mt-1 text-slate-500">{row.csvProductId}</div>
                      </td>
                      <td className="px-3 py-4 text-slate-300">{row.product?.gender || '—'}</td>
                      <td className="min-w-[180px] px-3 py-4">
                        <Select
                          value={row.selectedGender || '__none__'}
                          disabled={!canSelect(row)}
                          onValueChange={(value) => {
                            const selectedGender = value === '__none__' ? '' : value as GenderValue
                            updateRow(rowKey(row), {
                              selectedGender,
                              selected: Boolean(selectedGender),
                              status: selectedGender && row.status === 'needs_review' ? 'ready' : row.status,
                            })
                          }}
                        >
                          <SelectTrigger className="border-slate-700 bg-slate-950 text-slate-100">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Не выбран</SelectItem>
                            {GENDER_VALUES.map((gender) => (
                              <SelectItem key={gender} value={gender}>{gender}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {row.suggestedGender && (
                          <div className="mt-1 text-xs text-slate-500">
                            {row.suggestedGender} · {Math.round(row.confidence * 100)}%
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <Badge className={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                      </td>
                      <td className="max-w-[320px] px-3 py-4 text-xs text-slate-400">
                        {row.message || row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

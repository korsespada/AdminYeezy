'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { getMeasurementTemplatesAction } from '@/actions/measurement-templates'
import { measurementTemplateGarmentLabel, type MeasurementTemplate } from '@/lib/measurement-templates'

export default function MeasurementTemplatePicker({
  supplierId,
  onApply,
}: {
  supplierId: number | null | undefined
  onApply: (measurements: unknown) => void
}) {
  const [templates, setTemplates] = useState<MeasurementTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let cancelled = false
    setSelectedId('')
    if (!supplierId) {
      setTemplates([])
      return () => { cancelled = true }
    }
    setLoading(true)
    getMeasurementTemplatesAction(supplierId)
      .then((result) => {
        if (!cancelled) setTemplates(result.success ? result.data || [] : [])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [supplierId])

  const selectTemplate = (id: string) => {
    setSelectedId(id)
    const template = templates.find((item) => String(item.id) === id)
    if (template) onApply(template.measurements)
  }

  if (!supplierId) return <span className="text-[11px] text-slate-600">Сначала выберите поставщика</span>
  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-label="Загрузка шаблонов" />
  if (!templates.length) return <span className="text-[11px] text-slate-600">У поставщика нет шаблонов</span>

  return (
    <label className="relative min-w-[190px]">
      <span className="sr-only">Шаблон таблицы замеров</span>
      <select
        value={selectedId}
        onChange={(event) => selectTemplate(event.target.value)}
        className="w-full appearance-none rounded-md border border-slate-700 bg-slate-900 py-1.5 pl-2 pr-7 text-xs text-slate-200 outline-none focus:border-violet-500"
      >
        <option value="">Выберите шаблон…</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {measurementTemplateGarmentLabel(template.garmentType)} · {template.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
    </label>
  )
}
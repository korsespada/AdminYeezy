'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { getMeasurementTemplatesAction } from '@/actions/measurement-templates'
import { measurementTemplateGarmentLabel, type MeasurementTemplate } from '@/lib/measurement-templates'

export default function MeasurementTemplateBulkPicker({
  value,
  onChange,
  disabled,
}: {
  value: MeasurementTemplate | null
  onChange: (template: MeasurementTemplate | null) => void
  disabled?: boolean
}) {
  const [templates, setTemplates] = useState<MeasurementTemplate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getMeasurementTemplatesAction()
      .then((result) => {
        if (!cancelled) setTemplates(result.success ? result.data || [] : [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-label="Загрузка шаблонов размеров" />
  if (!templates.length) return <span className="text-xs text-slate-500">Нет шаблонов размеров</span>

  return (
    <label className="relative flex shrink-0 items-center gap-1.5">
      <span className="text-xs text-slate-500">Размеры</span>
      <span className="relative">
        <select
          value={value ? String(value.id) : ''}
          onChange={(event) => onChange(templates.find((template) => String(template.id) === event.target.value) || null)}
          disabled={disabled}
          aria-label="Шаблон размеров для выбранных товаров"
          className="h-9 w-64 appearance-none rounded-md border border-slate-600 bg-slate-700 py-1.5 pl-2 pr-7 text-xs text-slate-200 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Без изменений</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.supplierName || 'Без поставщика'} · {measurementTemplateGarmentLabel(template.garmentType)} · {template.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
      </span>
    </label>
  )
}

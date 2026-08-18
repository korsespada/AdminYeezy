'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info, Plus, Trash2, X } from 'lucide-react'
import {
  getCatalogAttributeDefinitionsForCategory,
  type CatalogAttributeDefinition,
} from '@/lib/catalog-attribute-schema'
import { normalizeCatalogAttributes } from '@/lib/catalog-attribute-values'
import {
  normalizeMeasurementTable,
  type MeasurementTable,
} from '@/lib/measurement-templates'

export default function CatalogAttributeFields({
  value,
  onChange,
  categoryName,
  subcategoryName,
  registryDefinitions,
  compact = false,
}: {
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
  categoryName?: string | null
  subcategoryName?: string | null
  registryDefinitions?: CatalogAttributeDefinition[]
  compact?: boolean
}) {
  const definitions = useMemo(
    () => {
      const storedByCode = new Map((registryDefinitions || []).map((item) => [item.code, item]))
      return getCatalogAttributeDefinitionsForCategory(categoryName, subcategoryName)
        .map((definition) => ({ ...definition, ...storedByCode.get(definition.code) }))
        .filter((definition) => definition.active !== false)
    },
    [categoryName, subcategoryName, registryDefinitions],
  )
  const knownCodes = useMemo(() => new Set(definitions.map((item) => item.code)), [definitions])
  const unknownEntries = Object.entries(value || {}).filter(([code]) => !knownCodes.has(code))

  function update(code: string, nextValue: unknown) {
    const next = { ...(value || {}) }
    if (empty(nextValue)) delete next[code]
    else next[code] = nextValue
    onChange(next)
  }

  function normalizeAll() {
    onChange(normalizeCatalogAttributes(value, {
      categoryName,
      subcategoryName,
      preserveUnknown: true,
      definitions: registryDefinitions,
    }))
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-200">Характеристики</div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Пустые значения не сохраняются. Размеры рекомендуются, но не блокируют публикацию.
          </p>
        </div>
        <button
          type="button"
          onClick={normalizeAll}
          className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-indigo-500 hover:text-white"
        >
          Нормализовать
        </button>
      </div>

      {!categoryName && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/80">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Выберите категорию — появятся подходящие характеристики.
        </div>
      )}

      <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
        {definitions.map((definition) => (
          <AttributeField
            key={definition.code}
            definition={definition}
            value={value?.[definition.code]}
            onChange={(nextValue) => update(definition.code, nextValue)}
            shoeMeasurements={isShoeCategory(categoryName)}
          />
        ))}
      </div>

      {unknownEntries.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <div className="mb-2 text-[11px] font-bold text-amber-200">Старые или неподходящие атрибуты</div>
          <div className="space-y-1.5">
            {unknownEntries.map(([code, entryValue]) => (
              <div key={code} className="flex items-center gap-2 text-xs">
                <span className="min-w-32 font-mono text-amber-300">{code}</span>
                <span className="min-w-0 flex-1 truncate text-slate-400">{formatValue(entryValue)}</span>
                <button type="button" onClick={() => update(code, undefined)} title="Удалить старый атрибут" className="text-slate-500 hover:text-red-400">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AttributeField({
  definition,
  value,
  onChange,
  shoeMeasurements = false,
}: {
  definition: CatalogAttributeDefinition
  value: unknown
  onChange: (value: unknown) => void
  shoeMeasurements?: boolean
}) {
  const serialized = formatAttributeValue(definition, value)
  const [draft, setDraft] = useState(serialized)
  useEffect(() => setDraft(serialized), [serialized])

  if (definition.code === 'measurements') {
    return <MeasurementsField value={value} onChange={onChange} shoe={shoeMeasurements} />
  }

  const isList = definition.value_type === 'size' || definition.value_type === 'multi_enum'
  const datalistId = `attribute-values-${definition.code}`
  const fieldClass = 'mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500'

  function commit(text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      onChange(undefined)
      return
    }
    onChange(isList
      ? trimmed.split(/[,;/|]+/).map((item) => item.trim()).filter(Boolean)
      : trimmed)
  }

  return (
    <label className="block rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-300">
        <span>{definition.label}</span>
        <span className="flex gap-1">
          {definition.use_as_filter && <Marker>фильтр</Marker>}
          {definition.use_as_variant_dimension && <Marker>вариант</Marker>}
        </span>
      </span>
      {definition.value_type === 'enum' && definition.values?.length ? (
        <select
          value={serialized}
          onChange={(event) => onChange(event.target.value || undefined)}
          className={fieldClass}
        >
          <option value="">Не найдено</option>
          {definition.values.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      ) : (
        <>
          <input
            value={draft}
            list={definition.values?.length ? datalistId : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(event.currentTarget.value)
                event.currentTarget.blur()
              }
            }}
            placeholder={placeholder(definition)}
            className={fieldClass}
          />
          {definition.values?.length ? (
            <datalist id={datalistId}>
              {definition.values.map((item) => <option key={item} value={item} />)}
            </datalist>
          ) : null}
        </>
      )}
      {definition.unit && <span className="mt-1 block text-[10px] text-slate-600">Единица: {definition.unit}</span>}
    </label>
  )
}

function Marker({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-medium text-indigo-300">{children}</span>
}

function placeholder(definition: CatalogAttributeDefinition) {
  if (definition.value_type === 'size') return 'Например: S, M, L или 38, 39, 40'
  if (definition.value_type === 'multi_enum') return 'Значения через запятую'
  if (definition.unit) return `Значение в ${definition.unit}`
  return 'Не найдено'
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatAttributeValue(definition: CatalogAttributeDefinition, value: unknown) {
  if (
    (definition.value_type === 'size' || definition.code === 'jewelry_size')
    && value
    && typeof value === 'object'
    && !Array.isArray(value)
  ) {
    const values = (value as Record<string, unknown>).values
    if (Array.isArray(values)) return values.join(', ')
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatAttributePart(definition, item)).filter(Boolean).join(', ')
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>
    for (const key of ['display_value', 'value', 'filter_value']) {
      if (typeof item[key] === 'string' || typeof item[key] === 'number') return formatAttributePart(definition, item[key])
    }
    for (const key of ['names', 'raw_values', 'display_values', 'filter_values', 'families', 'values']) {
      if (Array.isArray(item[key])) return item[key].map((entry) => formatAttributePart(definition, entry)).filter(Boolean).join(', ')
    }
    return formatAttributeObject(definition, item)
  }
  return formatAttributePart(definition, value)
}

export function MeasurementsField({ value, onChange, shoe = false }: { value: unknown; onChange: (value: unknown) => void; shoe?: boolean }) {
  const table = normalizeMeasurementTable(value)
  const legacyText = typeof value === 'string' ? value.trim() : ''

  if (!table) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 md:col-span-2">
        <div className="text-[11px] font-semibold text-slate-300">Замеры</div>
        {legacyText && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{legacyText}</p>}
        <button
          type="button"
          onClick={() => onChange(defaultMeasurementTable(legacyText, shoe))}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/20"
        >
          <Plus className="h-3.5 w-3.5" />
          {legacyText ? 'Преобразовать в таблицу' : 'Добавить таблицу замеров'}
        </button>
      </div>
    )
  }

  const update = (next: Partial<MeasurementTable>) => onChange({ ...table, ...next })
  const updateColumn = (index: number, label: string) => {
    const columns = table.columns.map((column, columnIndex) => columnIndex === index ? { ...column, label } : column)
    update({ columns })
  }
  const addColumn = () => {
    const key = nextMeasurementKey(table.columns)
    update({
      columns: [...table.columns, { key, label: 'Параметр' }],
      rows: table.rows.map((row) => ({ ...row, values: { ...row.values, [key]: '' } })),
    })
  }
  const removeColumn = (key: string) => update({
    columns: table.columns.filter((column) => column.key !== key),
    rows: table.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).filter(([valueKey]) => valueKey !== key)),
    })),
  })
  const updateRow = (index: number, nextRow: MeasurementRow) => update({
    rows: table.rows.map((row, rowIndex) => rowIndex === index ? nextRow : row),
  })

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-300">Замеры</span>
        <button type="button" onClick={() => onChange(undefined)} title="Удалить таблицу замеров" className="text-slate-500 hover:text-red-400">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="min-w-24 border-r border-slate-800 p-2 text-left">Размер</th>
              {table.columns.map((column, index) => (
                <th key={column.key} className="min-w-32 border-r border-slate-800 p-1.5 last:border-r-0">
                  <div className="flex items-center gap-1">
                    <input
                      value={column.label}
                      onChange={(event) => updateColumn(index, event.target.value)}
                      aria-label={`Название колонки ${index + 1}`}
                      className="h-8 min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                    />
                    <button type="button" onClick={() => removeColumn(column.key)} title="Удалить колонку" className="text-slate-600 hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-10 p-1.5">
                <button type="button" onClick={addColumn} title="Добавить колонку" className="text-indigo-300 hover:text-indigo-200">
                  <Plus className="h-4 w-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border-r border-slate-800 p-1.5">
                  <input
                    value={row.size}
                    onChange={(event) => updateRow(rowIndex, { ...row, size: event.target.value })}
                    placeholder="M"
                    aria-label={`Размер в строке ${rowIndex + 1}`}
                    className="h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  />
                </td>
                {table.columns.map((column) => (
                  <td key={column.key} className="border-r border-slate-800 p-1.5 last:border-r-0">
                    <input
                      value={row.values[column.key] || ''}
                      onChange={(event) => updateRow(rowIndex, {
                        ...row,
                        values: { ...row.values, [column.key]: event.target.value },
                      })}
                      placeholder="—"
                      aria-label={`${column.label}, размер ${row.size || rowIndex + 1}`}
                      className="h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                    />
                  </td>
                ))}
                <td className="p-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => update({ rows: table.rows.filter((_, index) => index !== rowIndex) })}
                    title="Удалить строку"
                    className="text-slate-600 hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => update({ rows: [...table.rows, { size: '', values: {} }] })}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" /> Строка размера
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
          Единица
          <input
            value={table.unit}
            onChange={(event) => update({ unit: event.target.value })}
            className="h-8 w-14 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
          />
        </label>
      </div>
      <textarea
        value={table.note || ''}
        onChange={(event) => update({ note: event.target.value })}
        rows={2}
        placeholder="Примечание к замерам (необязательно)"
        className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
      />
    </div>
  )
}

function defaultMeasurementTable(note = '', shoe = false): MeasurementTable {
  return {
    unit: 'см',
    columns: shoe
      ? [{ key: 'insole_length', label: 'Длина стельки' }, { key: 'foot_length', label: 'Длина стопы' }, { key: 'width', label: 'Ширина' }]
      : [
          { key: 'length', label: 'Длина' },
          { key: 'chest', label: 'Обхват груди' },
          { key: 'shoulders', label: 'Плечи' },
          { key: 'sleeve', label: 'Рукав' },
        ],
    rows: [{ size: '', values: {} }],
    note,
  }
}

function nextMeasurementKey(columns: MeasurementColumn[]) {
  let index = columns.length + 1
  while (columns.some((column) => column.key === `measurement_${index}`)) index += 1
  return `measurement_${index}`
}

function formatAttributePart(definition: CatalogAttributeDefinition, value: unknown): string {
  if (value && typeof value === 'object') {
    return Array.isArray(value)
      ? value.map((item) => formatAttributePart(definition, item)).filter(Boolean).join(', ')
      : formatAttributeObject(definition, value as Record<string, unknown>)
  }
  const text = String(value ?? '').trim()
  if (!text) return ''
  const normalized = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
  const dictionaryValue = definition.dictionary_values?.find((item) => (
    [item.filter_value, item.canonical_value, ...item.aliases]
      .some((candidate) => String(candidate).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === normalized)
  ))
  if (definition.code === 'stones' && normalized === 'quartz') return 'Кварц'
  return dictionaryValue?.canonical_value || TECHNICAL_VALUE_LABELS[normalized] || text
}

function formatAttributeObject(definition: CatalogAttributeDefinition, value: Record<string, unknown>) {
  const name = value.name || value.type
  if (name) {
    const title = String(name).trim()
    const naturalTitle = value.natural === true && !/^натуральн/i.test(title) ? `Натуральный ${title}` : title
    return [naturalTitle, value.color, value.shape].map(String).map((item) => item.trim()).filter(Boolean).join(', ')
  }
  return Object.values(value)
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => formatAttributePart(definition, item))
    .filter(Boolean)
    .join(', ')
}

const TECHNICAL_VALUE_LABELS: Record<string, string> = {
  rose_gold: 'Розовое золото', white_gold: 'Белое золото', yellow_gold: 'Жёлтое золото', combined_gold: 'Комбинированное золото',
  gold: 'Золото', silver: 'Серебро', platinum: 'Платина', steel: 'Сталь', metal: 'Металл', titanium: 'Титан', ceramic: 'Керамика', carbon: 'Карбон',
  leather: 'Кожа', rubber: 'Каучук', textile: 'Текстиль', plastic: 'Пластик',
  diamond: 'Бриллианты', lab_diamond: 'Выращенные бриллианты', mother_of_pearl: 'Перламутр', pearl: 'Жемчуг',
  sapphire: 'Сапфиры', emerald: 'Изумруды', ruby: 'Рубины', malachite: 'Малахит', onyx: 'Оникс', agate: 'Агат',
  moissanite: 'Муазаниты', chalcedony: 'Халцедон', cubic_zirconia: 'Фианиты', pietersite: 'Петерсит', rhinestone: 'Стразы',
  quartz: 'Кварцевый', mechanical: 'Механический', automatic: 'Автоматический',
}

function empty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function isShoeCategory(categoryName?: string | null) {
  return String(categoryName || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === 'обувь'
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info, X } from 'lucide-react'
import {
  getCatalogAttributeDefinitionsForCategory,
  type CatalogAttributeDefinition,
} from '@/lib/catalog-attribute-schema'
import { normalizeCatalogAttributes } from '@/lib/catalog-attribute-values'

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
}: {
  definition: CatalogAttributeDefinition
  value: unknown
  onChange: (value: unknown) => void
}) {
  const serialized = formatAttributeValue(definition, value)
  const [draft, setDraft] = useState(serialized)
  useEffect(() => setDraft(serialized), [serialized])

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

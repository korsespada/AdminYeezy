'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { BookOpen, Loader2, Plus, Save } from 'lucide-react'
import { upsertCatalogAttributeDictionaryValueAction } from '@/actions/catalog-attribute-registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  CatalogAttributeDefinition,
  CatalogAttributeDictionaryValue,
} from '@/lib/catalog-attribute-schema'

type EditableValue = CatalogAttributeDictionaryValue & { isNew?: boolean }

export default function CatalogAttributeDictionaryEditor({
  definitions,
}: {
  definitions: CatalogAttributeDefinition[]
}) {
  const dictionaryDefinitions = useMemo(
    () => definitions.filter((item) => (
      item.value_type === 'enum'
      || item.value_type === 'multi_enum'
      || item.value_type === 'size'
      || (item.dictionary_values?.length || 0) > 0
    )),
    [definitions],
  )
  const [selectedCode, setSelectedCode] = useState(dictionaryDefinitions[0]?.code || '')
  const [valuesByCode, setValuesByCode] = useState<Record<string, EditableValue[]>>(() => dictionaryState(definitions))
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!dictionaryDefinitions.some((item) => item.code === selectedCode)) {
      setSelectedCode(dictionaryDefinitions[0]?.code || '')
    }
  }, [dictionaryDefinitions, selectedCode])

  useEffect(() => {
    setValuesByCode((current) => {
      const next = { ...current }
      for (const definition of definitions) {
        if (!next[definition.code]) next[definition.code] = definition.dictionary_values || []
      }
      return next
    })
  }, [definitions])

  const selectedDefinition = dictionaryDefinitions.find((item) => item.code === selectedCode)
  const selectedValues = valuesByCode[selectedCode] || []

  function addValue() {
    const localId = `new-${Date.now()}`
    setValuesByCode((current) => ({
      ...current,
      [selectedCode]: [
        ...(current[selectedCode] || []),
        {
          id: localId,
          attribute_code: selectedCode,
          canonical_value: '',
          aliases: [],
          sort_order: (current[selectedCode]?.length || 0) * 10 + 10,
          active: true,
          isNew: true,
        },
      ],
    }))
    setMessage(null)
  }

  function saved(localId: string, value: CatalogAttributeDictionaryValue) {
    setValuesByCode((current) => ({
      ...current,
      [value.attribute_code]: (current[value.attribute_code] || []).map((item) => (
        item.id === localId ? value : item
      )),
    }))
    setMessage({ kind: 'success', text: `Значение «${value.canonical_value}» сохранено` })
  }

  if (dictionaryDefinitions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
        В выбранной категории нет атрибутов с фиксированным справочником значений.
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
        <div className="px-2 pb-3">
          <div className="flex items-center gap-2 font-semibold text-white">
            <BookOpen className="h-4 w-4 text-indigo-300" />
            Справочники
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Канонические значения, которые сохраняются в товар.
          </p>
        </div>
        <div className="space-y-1">
          {dictionaryDefinitions.map((definition) => {
            const entries = valuesByCode[definition.code] || []
            const activeCount = entries.filter((item) => item.active).length
            return (
              <button
                key={definition.code}
                type="button"
                onClick={() => {
                  setSelectedCode(definition.code)
                  setMessage(null)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  definition.code === selectedCode
                    ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-100'
                    : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-950/60 hover:text-white'
                }`}
              >
                <span>
                  <span className="block text-sm font-medium">{definition.label}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-600">{definition.code}</span>
                </span>
                <Badge variant="outline" className="border-slate-700 bg-slate-950 text-slate-400">
                  {activeCount}
                </Badge>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-white">{selectedDefinition?.label}</h2>
            <p className="mt-1 text-xs text-slate-500">
              Алиасы используются парсером и AI для приведения исходного текста к каноническому значению.
            </p>
          </div>
          <Button type="button" onClick={addValue} className="bg-indigo-600 text-white hover:bg-indigo-500">
            <Plus className="h-4 w-4" />
            Добавить значение
          </Button>
        </div>

        {message && (
          <div className={`mx-4 mt-4 rounded-xl border px-3 py-2 text-sm ${
            message.kind === 'success'
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
              : 'border-red-800 bg-red-950/40 text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-2 p-4">
          {selectedValues.map((value) => (
            <DictionaryValueRow
              key={value.id}
              value={value}
              onSaved={(savedValue) => saved(value.id, savedValue)}
              onError={(text) => setMessage({ kind: 'error', text })}
            />
          ))}
          {selectedValues.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
              Значений пока нет. Добавьте первое каноническое значение.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function DictionaryValueRow({
  value,
  onSaved,
  onError,
}: {
  value: EditableValue
  onSaved: (value: CatalogAttributeDictionaryValue) => void
  onError: (message: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [canonicalValue, setCanonicalValue] = useState(value.canonical_value)
  const [aliasesText, setAliasesText] = useState(value.aliases.join(', '))
  const [active, setActive] = useState(value.active)

  useEffect(() => {
    setCanonicalValue(value.canonical_value)
    setAliasesText(value.aliases.join(', '))
    setActive(value.active)
  }, [value])

  function save() {
    startTransition(async () => {
      const result = await upsertCatalogAttributeDictionaryValueAction({
        id: value.isNew ? undefined : value.id,
        attribute_code: value.attribute_code,
        canonical_value: canonicalValue,
        aliases: aliasesText.split(',').map((item) => item.trim()).filter(Boolean),
        active,
      })
      if (!result.success || !result.data) {
        onError(result.error || 'Не удалось сохранить значение')
        return
      }
      onSaved(result.data as CatalogAttributeDictionaryValue)
    })
  }

  return (
    <div className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(240px,1.4fr)_auto_auto] md:items-center ${
      active ? 'border-slate-800 bg-slate-950/50' : 'border-slate-800/70 bg-slate-950/20 opacity-70'
    }`}>
      <label>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">
          Каноническое значение
        </span>
        <input
          value={canonicalValue}
          onChange={(event) => setCanonicalValue(event.target.value)}
          placeholder="Например: Чёрный"
          className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none focus:border-indigo-500"
        />
      </label>
      <label>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">
          Алиасы через запятую
        </span>
        <input
          value={aliasesText}
          onChange={(event) => setAliasesText(event.target.value)}
          placeholder="black, noir, черный"
          className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none focus:border-indigo-500"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-400 md:pt-4">
        <Checkbox
          checked={active}
          onCheckedChange={(checked) => setActive(checked === true)}
          className="border-slate-600 data-[state=checked]:border-indigo-500 data-[state=checked]:bg-indigo-600"
        />
        Активно
      </label>
      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={isPending || !canonicalValue.trim()}
        className="bg-slate-800 text-slate-200 hover:bg-indigo-600 hover:text-white md:mt-4"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Сохранить
      </Button>
    </div>
  )
}

function dictionaryState(definitions: CatalogAttributeDefinition[]) {
  return Object.fromEntries(
    definitions.map((definition) => [definition.code, definition.dictionary_values || []]),
  )
}

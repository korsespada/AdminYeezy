'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Save, Sparkles } from 'lucide-react'
import { updateCatalogAttributeDefinitionAction } from '@/actions/catalog-attribute-registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { CatalogAttributeDefinition } from '@/lib/catalog-attribute-registry'
import {
  categoryNames,
  getCatalogAttributeDefinitionsForCategory,
} from '@/lib/catalog-attribute-schema'

export default function CatalogAttributeRegistry({
  initialDefinitions,
}: {
  initialDefinitions: CatalogAttributeDefinition[]
}) {
  const [definitions, setDefinitions] = useState(initialDefinitions)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [isPending, startTransition] = useTransition()
  const categoryCodes = new Set(
    selectedCategory
      ? getCatalogAttributeDefinitionsForCategory(selectedCategory).map((item) => item.code)
      : definitions.map((item) => item.code),
  )
  const visibleDefinitions = definitions.filter((item) => categoryCodes.has(item.code))

  function update(code: string, patch: Partial<CatalogAttributeDefinition>) {
    setDefinitions((current) => current.map((item) => item.code === code ? { ...item, ...patch } : item))
    setDirty((current) => new Set(current).add(code))
    setMessage(null)
  }

  function save(definition: CatalogAttributeDefinition) {
    setSavingCode(definition.code)
    setMessage(null)
    startTransition(async () => {
      const result = await updateCatalogAttributeDefinitionAction({
        code: definition.code,
        show_as_characteristic: definition.show_as_characteristic,
        use_as_filter: definition.use_as_filter,
        use_as_variant_dimension: definition.use_as_variant_dimension,
        active: definition.active,
      })
      setSavingCode(null)
      if (!result.success) {
        setMessage({ kind: 'error', text: result.error || 'Не удалось сохранить настройку' })
        return
      }
      setDirty((current) => {
        const next = new Set(current)
        next.delete(definition.code)
        return next
      })
      setMessage({ kind: 'success', text: `Настройки «${definition.label}» сохранены` })
    })
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Характеристика" text="Показывается в карточке товара как структурированное значение." />
        <InfoCard title="Фильтр" text="Используется для фильтрации товаров на сайте и в админке." />
        <InfoCard title="Вариант товара" text="Создаёт выбираемый вариант, например конкретный размер или цвет." />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="mb-2 text-xs font-semibold text-slate-400">Показать схему категории</div>
        <div className="flex flex-wrap gap-2">
          <CategoryButton active={!selectedCategory} onClick={() => setSelectedCategory('')}>Все</CategoryButton>
          {categoryNames().map((category) => (
            <CategoryButton key={category} active={selectedCategory === category} onClick={() => setSelectedCategory(category)}>
              {category}
            </CategoryButton>
          ))}
        </div>
        {selectedCategory && (
          <p className="mt-3 text-xs text-slate-500">
            Показаны общие атрибуты и характеристики категории «{selectedCategory}». Размеры могут быть вариантом, но не обязательны для публикации.
          </p>
        )}
      </div>

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          message.kind === 'success'
            ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
            : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-4">Атрибут</th>
                <th className="px-4 py-4">Категории</th>
                <th className="px-4 py-4 text-center">Характеристика</th>
                <th className="px-4 py-4 text-center">Фильтр</th>
                <th className="px-4 py-4 text-center">Вариант</th>
                <th className="px-4 py-4 text-center">Включён</th>
                <th className="px-5 py-4 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visibleDefinitions.map((definition) => (
                <tr key={definition.code} className={definition.active ? 'text-slate-200' : 'text-slate-500'}>
                  <td className="px-5 py-4 align-top">
                    <div className="font-semibold text-white">{definition.label}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">{definition.code}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {definition.parser_rules.slice(0, 3).map((rule) => (
                        <Badge key={rule} variant="outline" className="border-slate-700 bg-slate-950 text-slate-400">
                          {rule}
                        </Badge>
                      ))}
                    </div>
                    {definition.aliases.length > 0 && (
                      <div className="mt-2 text-[11px] text-slate-600">
                        Старые коды: {definition.aliases.slice(0, 4).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <div>{definition.category_scope}</div>
                    <div className="mt-1 text-xs text-slate-500">{valueTypeLabel(definition.value_type)}</div>
                  </td>
                  <ToggleCell
                    checked={definition.show_as_characteristic}
                    label={`Показывать «${definition.label}» как характеристику`}
                    onChange={(checked) => update(definition.code, { show_as_characteristic: checked })}
                  />
                  <ToggleCell
                    checked={definition.use_as_filter}
                    label={`Использовать «${definition.label}» как фильтр`}
                    onChange={(checked) => update(definition.code, { use_as_filter: checked })}
                  />
                  <ToggleCell
                    checked={definition.use_as_variant_dimension}
                    label={`Использовать «${definition.label}» как вариант товара`}
                    onChange={(checked) => update(definition.code, { use_as_variant_dimension: checked })}
                  />
                  <ToggleCell
                    checked={definition.active}
                    label={`Атрибут «${definition.label}» включён`}
                    onChange={(checked) => update(definition.code, { active: checked })}
                  />
                  <td className="px-5 py-4 text-right align-top">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!dirty.has(definition.code) || isPending}
                      onClick={() => save(definition)}
                      className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600"
                    >
                      {savingCode === definition.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Сохранить
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-indigo-900/70 bg-indigo-950/30 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />
          <div>
            <h2 className="font-semibold text-indigo-100">Как применяется AI</h2>
            <p className="mt-1 text-sm leading-6 text-indigo-200/70">
              Сначала используются точные подписи и словари из правил, затем AI разбирает неоднозначный текст.
              Результат становится предложением на проверку. Пустые значения и остатки по размерам не придумываются.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200'
          : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function ToggleCell({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <td className="px-4 py-4 text-center align-top">
      <Checkbox
        checked={checked}
        aria-label={label}
        onCheckedChange={(value) => onChange(value === true)}
        className="border-slate-600 data-[state=checked]:border-indigo-500 data-[state=checked]:bg-indigo-600"
      />
    </td>
  )
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center gap-2 font-semibold text-slate-100">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        {title}
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-400">{text}</p>
    </div>
  )
}

function valueTypeLabel(value: CatalogAttributeDefinition['value_type']) {
  const labels: Record<CatalogAttributeDefinition['value_type'], string> = {
    text: 'Текст',
    number: 'Число',
    enum: 'Одно значение',
    multi_enum: 'Несколько значений',
    size: 'Размер',
  }
  return labels[value]
}

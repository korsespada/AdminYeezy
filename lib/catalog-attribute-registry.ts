import {
  CATALOG_ATTRIBUTE_DEFINITIONS,
  type CatalogAttributeDictionaryValue,
  type CatalogAttributeDefinition,
  type CatalogAttributeValueType,
} from '@/lib/catalog-attribute-schema'
import {
  getRailsCatalogAttributeRegistry,
  syncRailsCatalogAttributeRegistry,
  updateRailsCatalogAttributeDefinition,
  upsertRailsCatalogAttributeValue,
} from '@/lib/rails-admin'
import { scrapingQuery } from '@/lib/db'

export type { CatalogAttributeDictionaryValue, CatalogAttributeDefinition, CatalogAttributeValueType }
export const DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS = CATALOG_ATTRIBUTE_DEFINITIONS

export async function getCatalogAttributeDefinitions(): Promise<CatalogAttributeDefinition[]> {
  try {
    let payload = await getRailsCatalogAttributeRegistry()
    if (payload.definitions.length === 0) {
      try {
        const legacy = await legacyRegistryPayload(payload.values)
        if (legacy.definitions.length > 0) {
          payload = await syncRailsCatalogAttributeRegistry(legacy)
        }
      } catch (error) {
        console.warn('[catalog-attribute-registry] legacy import skipped:', error)
      }
    }
    const overridesByCode = new Map(payload.definitions.map((item) => [item.code, item]))
    const defaultsByCode = new Map(DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => [item.code, item]))
    const valuesByCode = new Map<string, CatalogAttributeDictionaryValue[]>()

    for (const value of payload.values as CatalogAttributeDictionaryValue[]) {
      const current = valuesByCode.get(value.attribute_code) || []
      current.push(value)
      valuesByCode.set(value.attribute_code, current)
    }

    return [...new Set([...defaultsByCode.keys(), ...overridesByCode.keys()])].map((code, index) => {
      const definition = defaultsByCode.get(code) || genericDefinition(code, index)
      const dictionaryValues = valuesByCode.get(code) || []
      return {
        ...definition,
        ...overridesByCode.get(code),
        values: dictionaryValues.filter((item) => item.active).map((item) => item.canonical_value),
        dictionary_values: dictionaryValues,
      }
    }).sort((left, right) => left.sort_order - right.sort_order)
  } catch (error) {
    console.warn('[catalog-attribute-registry] Rails fallback to local defaults:', error)
    return localFallbackDefinitions()
  }
}

function genericDefinition(code: string, index: number): CatalogAttributeDefinition {
  return {
    code,
    label: code.replaceAll('_', ' '),
    category_scope: 'Все категории',
    value_type: 'text',
    show_as_characteristic: true,
    use_as_filter: false,
    use_as_variant_dimension: false,
    parser_rules: [],
    aliases: [],
    sort_order: 10_000 + index,
    active: true,
  }
}

export async function upsertCatalogAttributeDictionaryValue(input: {
  id?: string
  attribute_code: string
  filter_value: string
  canonical_value: string
  aliases: string[]
  active: boolean
}) {
  return upsertRailsCatalogAttributeValue({
    ...input,
    aliases: [...new Set(input.aliases.map((item) => item.trim()).filter(Boolean))],
  }) as Promise<CatalogAttributeDictionaryValue>
}

export async function updateCatalogAttributeDefinition(
  code: string,
  patch: Pick<CatalogAttributeDefinition, 'show_as_characteristic' | 'use_as_filter' | 'use_as_variant_dimension' | 'active'>,
) {
  return updateRailsCatalogAttributeDefinition(code, patch) as Promise<CatalogAttributeDefinition>
}

function localFallbackDefinitions(): CatalogAttributeDefinition[] {
  return DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((definition) => {
    const dictionaryValues = (definition.values || []).map((canonicalValue, index) => ({
      id: `fallback:${definition.code}:${index}`,
      attribute_code: definition.code,
      filter_value: fallbackFilterValue(canonicalValue),
      canonical_value: canonicalValue,
      aliases: [],
      sort_order: (index + 1) * 10,
      active: true,
    }))
    return { ...definition, dictionary_values: dictionaryValues }
  })
}

function fallbackFilterValue(value: string) {
  const transliterated = [...value.trim().toLowerCase()].map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter).join('')
  return transliterated.replace(/[ -]+/g, '_').replace(/[^a-z0-9_:.]/g, '').replace(/\./g, '_')
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

async function legacyRegistryPayload(currentValues: any[]) {
  const [definitionsResult, valuesResult] = await Promise.all([
    scrapingQuery(
      `SELECT code, show_as_characteristic, use_as_filter, use_as_variant_dimension, active
         FROM catalog_attribute_definitions`,
    ),
    scrapingQuery(
      `SELECT id::text, attribute_code, canonical_value, aliases, sort_order, active
         FROM catalog_attribute_values`,
    ),
  ])

  const definitions = definitionsResult.rows.map((item: any) => ({
    code: item.code,
    show_as_characteristic: Boolean(item.show_as_characteristic),
    use_as_filter: Boolean(item.use_as_filter),
    use_as_variant_dimension: Boolean(item.use_as_variant_dimension),
    active: Boolean(item.active),
  }))
  const values = valuesResult.rows.map((item: any) => legacyValue(item, currentValues))
  return { definitions, values }
}

function legacyValue(item: any, currentValues: any[]) {
  const sameAttribute = currentValues.filter((value) => value.attribute_code === item.attribute_code)
  const legacyCandidates = [item.canonical_value, ...Array(item.aliases)].map(normalizeDictionaryText)
  const match = sameAttribute.find((value) => (
    [value.filter_value, value.canonical_value, ...Array(value.aliases)]
      .map(normalizeDictionaryText)
      .some((candidate) => legacyCandidates.includes(candidate))
  ))
  const filterValue = match?.filter_value
    || asciiFilterValue(item.aliases)
    || fallbackFilterValue(item.canonical_value)
    || `value_${item.id.replace(/\D/g, '')}`
  const aliases = [...new Set([...Array(match?.aliases), ...Array(item.aliases)])].filter((alias) => (
    !sameAttribute.some((value) => (
      value.filter_value !== filterValue
      && [value.filter_value, value.canonical_value, ...Array(value.aliases)]
        .map(normalizeDictionaryText)
        .includes(normalizeDictionaryText(alias))
    ))
  ))

  return {
    attribute_code: item.attribute_code,
    filter_value: filterValue,
    canonical_value: item.canonical_value,
    aliases,
    sort_order: Number(item.sort_order || 0),
    active: Boolean(item.active),
  }
}

function asciiFilterValue(aliases: unknown) {
  const alias = Array(aliases).map(String).find((value) => /^[a-z0-9 _:-]+$/i.test(value.trim()))
  return alias?.trim().toLowerCase().replace(/[ -]+/g, '_').replace(/[^a-z0-9_:-]/g, '') || ''
}

function normalizeDictionaryText(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_')
}

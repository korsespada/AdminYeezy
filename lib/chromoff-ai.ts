import type { BatchAiProvider } from './batch-ai'
import { normalizePhotoAlt } from './product-media-seo'

export type ChromoffAiCategoryRule = {
  id: string
  categoryId: string
  title: string
  prompt: string
}

export type ChromoffAiSettings = {
  provider: BatchAiProvider
  providerId?: string
  activeProviderId?: string | null
  providerName?: string
  providerBaseUrl?: string
  providerApiKey?: string
  openrouterModel: string
  byesuModel: string
  temperature: number
  maxTokens: number
  concurrency: number
  systemPrompt: string
  categoryRules: ChromoffAiCategoryRule[]
}

export type ChromoffAiProductInput = {
  name?: string | null
  description?: string | null
  brand?: string | { id?: string; name?: string | null } | null
  price_cents?: number | string | null
  gender?: string | null
  catalog_attributes?: Record<string, unknown> | null
  images?: string[] | null
  media?: Array<{ original_url?: string; preview_url?: string; alt_text?: string | null }> | null
  chromoff_category?: { id?: string; parent_id?: string | null; name?: string; slug?: string } | null
}

export type ChromoffAiAttributeDefinition = {
  code: string
  label?: string
  value_type?: string
  values?: string[]
  dictionary_values?: Array<{ canonical_value?: string; filter_value?: string; aliases?: string[] }>
}

export type NormalizedChromoffAiOutput = {
  name: string
  description: string
  h1: string
  seoDescription: string
  attributes: Record<string, unknown>
  alts: string[]
}

export const DEFAULT_CHROMOFF_AI_SYSTEM_PROMPT = `Ты редактор готовых карточек магазина CHROMOFF.

Используй исходные название и описание товара, существующие характеристики и все переданные contact sheets 3×3. Фотографии — источник фактов о внешнем виде; не выдумывай материал, состав, модель или комплектность, если этого нельзя подтвердить.

Верни только JSON:
{
  "name": "название товара без дублирования бренда",
  "description": "полное клиентское описание",
  "chromoff_h1": "уникальный H1 для CHROMOFF",
  "chromoff_seo_description": "уникальное SEO-описание для CHROMOFF",
  "attributes": { "код_характеристики": "значение или массив" },
  "alts": ["alt для фото 1", "alt для фото 2"]
}

Не возвращай и не определяй category, subcategory, brand, gender, price, seo_title или slug. Категория, подкатегория, бренд, гендер и цена уже утверждены оператором и неизменяемы в этом процессе. Массив alts должен соответствовать фотографиям по порядку и длине.`

export const DEFAULT_CHROMOFF_AI_SETTINGS: ChromoffAiSettings = {
  provider: 'byesu',
  openrouterModel: 'google/gemini-2.5-flash',
  byesuModel: 'gemini-3.7-flash-high',
  temperature: 0.1,
  maxTokens: 5000,
  concurrency: 5,
  systemPrompt: DEFAULT_CHROMOFF_AI_SYSTEM_PROMPT,
  categoryRules: [],
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function text(value: unknown, maxLength: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeCategoryRules(value: unknown): ChromoffAiCategoryRule[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const categoryId = text(source.categoryId, 100)
    const prompt = String(source.prompt || '').trim().slice(0, 12_000)
    if (!categoryId || !prompt) return []
    return [{
      id: text(source.id, 100) || `chromoff-rule-${index + 1}`,
      categoryId,
      title: text(source.title, 180) || 'Правило Chromoff',
      prompt,
    }]
  })
}

export function hydrateChromoffAiSettings(data: unknown): ChromoffAiSettings {
  const source = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const provider = ['openrouter', 'byesu', 'cockpit'].includes(String(source.provider))
    ? source.provider as BatchAiProvider
    : DEFAULT_CHROMOFF_AI_SETTINGS.provider
  return {
    ...DEFAULT_CHROMOFF_AI_SETTINGS,
    provider,
    providerId: text(source.providerId, 100) || undefined,
    activeProviderId: text(source.activeProviderId, 100) || null,
    providerName: text(source.providerName, 200) || undefined,
    providerBaseUrl: text(source.providerBaseUrl, 500) || undefined,
    providerApiKey: typeof source.providerApiKey === 'string' ? source.providerApiKey : undefined,
    openrouterModel: text(source.openrouterModel, 200) || DEFAULT_CHROMOFF_AI_SETTINGS.openrouterModel,
    byesuModel: text(source.byesuModel, 200) || DEFAULT_CHROMOFF_AI_SETTINGS.byesuModel,
    temperature: Math.max(0, Math.min(2, finiteNumber(source.temperature, DEFAULT_CHROMOFF_AI_SETTINGS.temperature))),
    maxTokens: Math.max(1000, Math.min(20_000, Math.round(finiteNumber(source.maxTokens, DEFAULT_CHROMOFF_AI_SETTINGS.maxTokens)))),
    concurrency: Math.max(1, Math.min(10, Math.round(finiteNumber(source.concurrency, DEFAULT_CHROMOFF_AI_SETTINGS.concurrency)))),
    systemPrompt: String(source.systemPrompt || '').trim() || DEFAULT_CHROMOFF_AI_SYSTEM_PROMPT,
    categoryRules: normalizeCategoryRules(source.categoryRules),
  }
}

export function promptRulesForChromoffCategory(
  rules: ChromoffAiCategoryRule[],
  categoryId?: string | null,
  parentId?: string | null,
) {
  const selectedIds = [parentId, categoryId].map((value) => String(value || '').trim()).filter(Boolean)
  return selectedIds.flatMap((id) => rules.filter((rule) => rule.categoryId === id).map((rule) => rule.prompt))
}

function brandName(input: ChromoffAiProductInput) {
  return typeof input.brand === 'string' ? text(input.brand, 160) : text(input.brand?.name, 160)
}

function brandAndName(brand: string, name: string) {
  if (!brand) return name
  return name.toLocaleLowerCase('ru-RU').startsWith(brand.toLocaleLowerCase('ru-RU')) ? name : `${brand} ${name}`
}

function mediaCount(input: ChromoffAiProductInput) {
  if (Array.isArray(input.media)) return input.media.length
  return Array.isArray(input.images) ? input.images.length : 0
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function buildChromoffAiUserPrompt(
  input: ChromoffAiProductInput,
  categoryPrompts: string[] = [],
  attributeDefinitions: ChromoffAiAttributeDefinition[] = [],
) {
  const category = input.chromoff_category
  const attributeSchema = attributeDefinitions.map((definition) => ({
    code: definition.code,
    label: definition.label || definition.code,
    value_type: definition.value_type || 'text',
    values: definition.values || definition.dictionary_values?.map((item) => item.canonical_value).filter(Boolean) || [],
  }))
  return [
    'Обработай готовую карточку CHROMOFF. Все изображения ниже будут переданы как contact sheet 3×3 с нумерацией.',
    'Используй фото, текущее название, описание и характеристики как единый источник. Не изменяй категорию, подкатегорию, бренд, гендер и цену.',
    `Текущая карточка: ${JSON.stringify({
      name: input.name || '',
      description: input.description || '',
      brand: brandName(input),
      price_cents: Number(input.price_cents || 0),
      gender: input.gender || null,
      chromoff_category: category ? { id: category.id, name: category.name, slug: category.slug, parent_id: category.parent_id } : null,
      catalog_attributes: plainObject(input.catalog_attributes),
    })}`,
    categoryPrompts.length ? `Дополнительные правила выбранной категории:\n${categoryPrompts.join('\n\n')}` : '',
    attributeSchema.length
      ? `Заполняй характеристики только кодами из этого справочника. Значения enum/multi_enum выбирай из values, если подходящее значение подтверждено фото или исходником; неизвестные коды не добавляй:\n${JSON.stringify(attributeSchema)}`
      : '',
    `Верни alts ровно для ${mediaCount(input)} фотографий по порядку.`,
  ].filter(Boolean).join('\n\n')
}

export function normalizeChromoffAiOutput(
  output: unknown,
  input: ChromoffAiProductInput,
  attributeDefinitions: ChromoffAiAttributeDefinition[] = [],
): NormalizedChromoffAiOutput {
  const source = plainObject(output)
  const name = text(source.name, 240) || text(input.name, 240) || 'Товар'
  const brand = brandName(input)
  const displayName = brandAndName(brand, name)
  const description = String(source.description || '').trim().slice(0, 12_000) || String(input.description || '').trim().slice(0, 12_000)
  const h1 = text(source.chromoff_h1 ?? source.h1, 240) || displayName
  const seoDescription = text(source.chromoff_seo_description ?? source.seo_description, 500)
  const existingAttributes = plainObject(input.catalog_attributes)
  const generatedAttributes = plainObject(source.attributes ?? source.catalog_attributes)
  const definitionsByCode = new Map(attributeDefinitions.map((definition) => [definition.code, definition]))
  const canonicalizeValue = (code: string, value: unknown) => {
    const definition = definitionsByCode.get(code)
    const dictionary = definition?.dictionary_values || []
    if (!dictionary.length) return value
    const resolve = (item: unknown) => {
      const candidate = String(item || '').trim().toLocaleLowerCase('ru-RU')
      const match = dictionary.find((entry) => [entry.canonical_value, entry.filter_value, ...(entry.aliases || [])]
        .some((value) => String(value || '').trim().toLocaleLowerCase('ru-RU') === candidate))
      return match?.canonical_value || String(item || '').trim()
    }
    return Array.isArray(value) ? [...new Set(value.map(resolve).filter(Boolean))] : resolve(value)
  }
  const normalizedGeneratedAttributes = Object.fromEntries(
    Object.entries(generatedAttributes)
      .filter(([code]) => !attributeDefinitions.length || definitionsByCode.has(code))
      .map(([code, value]) => [code, canonicalizeValue(code, value)]),
  )
  const count = mediaCount(input)
  const rawAlts = Array.isArray(source.alts) ? source.alts : Array.isArray(source.photo_alts) ? source.photo_alts : []
  const alts = Array.from({ length: count }, (_, index) => normalizePhotoAlt(
    rawAlts[index],
    `${displayName}, фото ${index + 1}`,
  ))

  return {
    name,
    description,
    h1,
    seoDescription,
    attributes: { ...existingAttributes, ...normalizedGeneratedAttributes },
    alts,
  }
}

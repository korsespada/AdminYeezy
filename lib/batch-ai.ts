import crypto from 'crypto'
import sharp from 'sharp'
import { openRouterChatCompletion } from '@/lib/openrouter'

export type BatchAiProvider = 'openrouter' | 'cockpit'

export type BatchAiSettings = {
  provider: BatchAiProvider
  openrouterModel: string
  temperature: number
  maxTokens: number
  concurrency: number
  systemPrompt: string
}

export type BatchAiLookup = { id: string; name: string; parent_id?: string | null }
export type BatchAiAttributeDefinition = {
  code: string
  label: string
  value_type?: string
  unit?: string | null
  values?: string[]
  aliases?: string[]
}

export type BatchAiPriceRuleHint = {
  rule_key: string
  name: string
  conditions: Record<string, unknown>
  visual_hint?: string | null
  reference_images?: string[]
  price: number
  priority?: number
}

export const DEFAULT_BATCH_AI_SYSTEM_PROMPT = `Ты — редактор каталога премиальных товаров. Обрабатывай сырой китайский товар только по предоставленному тексту и фотографиям.

Если фотографии предоставлены, главный источник фактов — фотографии, затем исходный текст; соотноси сведения между всеми contact sheet одного товара. Если фотографий нет, работай только по тексту и не делай визуальных выводов. Не выдумывай модель, материал, размеры или характеристики.

Требования:
- Пиши по-русски, без китайских иероглифов, эмодзи, рекламных обещаний и упоминаний реплики.
- name: кратко «Бренд + тип/модель товара», без артикула.
- description: содержательное описание обычно 350–700 знаков. Сохраняй подтверждённые детали дизайна, формы, цвета, отделки, застёжек, материалов и размеров; разделяй смысловые части не более чем двумя одиночными переносами.
- h1, seo_title и seo_description должны быть естественными, полезными для поиска и без keyword stuffing.
- Не сообщай покупателю, что факт неизвестен или не удалось определить: просто не упоминай его.
- Не начинай текст словами «на фото видно», «на фотографиях представлено», «исходный текст» и подобными служебными фразами.
- Не используй слова «оригинал», «официальный», «лучший», «премиальный» или «трендовый» и не делай заявлений о подлинности.
- Внутренние артикулы не являются моделью и не должны попадать в публичные тексты.
- Каждый подтверждённый материал перенеси и в description, и в подходящий атрибут.
- Бренд и категорию выбирай только из справочника. Не предлагай новые бренды или верхнеуровневые категории.
- model_name — свободное каноничное название конкретной линейки/модели. При низкой уверенности оставь пустым.
- Используй существующие коды атрибутов. Новый атрибут вынеси только в attribute_suggestions.
- Новую подкатегорию вынеси только в subcategory_suggestion; не подменяй ею исходную подкатегорию.
- Определи size_class как small, medium или large по фото и тексту наиболее вероятным образом.
- Для сумок запиши числовые bag_width_cm и bag_height_cm, если размеры явно указаны в тексте или уверенно читаются на таблице/фото. Не угадывай точные сантиметры только по внешнему виду.
- Если переданы ценовые правила, выбери price_rule_key только при уверенном совпадении модели, размеров или визуального эталона. Цена в этих правилах не должна попадать в тексты товара.
- Отметь рекламные, нерелевантные и дублирующиеся изображения для исключения. Таблицы размеров исключи из публичной галереи, но распознай данные в sizes.
- Для цветового семейства предложи один group_signature только когда это один и тот же товар, отличающийся цветом.
- Для сумок должны совпадать бренд, model_name, размер самой сумки, материалы и фурнитура; разные размеры сумки не объединяй.
- Для обуви должны совпадать бренд, model_name, конструкция и материал; обувные размеры являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для одежды должны совпадать бренд, model_name/фасон и материал; размеры одежды являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для остальных категорий объединяй только при уверенном совпадении всех значимых характеристик кроме цвета.
- Верни строго JSON без markdown.`

export function buildBatchAiUserPrompt(input: {
  product: any
  supplierInstructions?: string | null
  brands: BatchAiLookup[]
  categories: BatchAiLookup[]
  subcategories: BatchAiLookup[]
  attributes: BatchAiAttributeDefinition[]
  priceRules?: BatchAiPriceRuleHint[]
}) {
  const { product, supplierInstructions, brands, categories, subcategories, attributes, priceRules = [] } = input
  let referenceOffset = 0
  const priceRulePrompt = priceRules.map((rule) => {
    const references = (rule.reference_images || []).map((_, index) => referenceOffset + index + 1)
    referenceOffset += references.length
    return {
      rule_key: rule.rule_key,
      name: rule.name,
      conditions: rule.conditions,
      visual_hint: rule.visual_hint || '',
      reference_photo_numbers: references,
    }
  })
  return [
    'Верни объект следующей формы:',
    JSON.stringify({
      product: {
        name: '', description: '', h1: '', seo_title: '', seo_description: '',
        brand: 'existing-id-or-empty', category: 'existing-id', subcategory: 'existing-id-or-original',
        gender: 'male|female|unisex|null', catalog_attributes: {}, price_rule_key: '', confidence: 0,
      },
      media: { discard_indexes: [], size_chart_indexes: [] },
      inspect_full_size_indexes: [],
      subcategory_suggestion: null,
      attribute_suggestions: [],
      color_family: null,
    }),
    'Индексы фотографий начинаются с 1 и подписаны на contact sheet.',
    'inspect_full_size_indexes: не более 3 номеров фото, которые нужно запросить в оригинальном размере только для уточнения плохо читаемого бренда, модели или логотипа при низкой уверенности.',
    `Особенности поставщика: ${supplierInstructions || 'нет'}`,
    `Товар: ${JSON.stringify(product)}`,
    `Бренды: ${JSON.stringify(brands)}`,
    `Категории: ${JSON.stringify(categories)}`,
    `Подкатегории: ${JSON.stringify(subcategories)}`,
    `Схема атрибутов: ${JSON.stringify(attributes)}`,
    `Ценовые правила поставщика: ${JSON.stringify(priceRulePrompt)}`,
    'Номера визуальных эталонов относятся к отдельному листу «Эталоны цен», а не к фотографиям товара. Если точного правила нет, price_rule_key оставь пустым; size_class всё равно определи для резервного правила.',
    'attribute_suggestions: [{code,label,value_type,unit,allowed_values,aliases,value,reason,confidence}].',
    'subcategory_suggestion: {name,parent_category_id,reason,confidence} или null.',
    'color_family: {group_signature,category_kind,model_name,bag_size,materials,hardware,color,matching_evidence,confidence} или null.',
  ].join('\n\n')
}

export async function buildBatchAiContactSheets(photoUrls: string[]) {
  const allowedHosts = new Set((process.env.AI_CATALOG_MEDIA_HOSTS || 'static.yeezyunique.ru,xcimg.szwego.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))
  const validUrls = [...new Set(photoUrls.map(String).filter((url) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) && allowedHosts.has(parsed.hostname.toLowerCase())
    } catch { return false }
  }))]
  const sheets: string[] = []
  for (let start = 0; start < validUrls.length; start += 9) {
    const urls = validUrls.slice(start, start + 9)
    const tiles = await Promise.all(urls.map(async (url, index) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`Фото ${start + index + 1}: HTTP ${response.status}`)
      const declaredSize = Number(response.headers.get('content-length') || 0)
      if (declaredSize > 12 * 1024 * 1024) throw new Error(`Фото ${start + index + 1}: файл больше 12 МБ`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > 12 * 1024 * 1024) throw new Error(`Фото ${start + index + 1}: файл больше 12 МБ`)
      const image = await sharp(buffer)
        .rotate()
        .resize(384, 384, { fit: 'contain', background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer()
      const label = await sharp({
        text: {
          text: `<span foreground="white" background="#111827"> ${start + index + 1} </span>`,
          width: 100,
          height: 42,
          rgba: true,
        },
      }).png().toBuffer()
      return { input: image, left: (index % 3) * 384, top: Math.floor(index / 3) * 384, label }
    }))
    const rows = Math.ceil(tiles.length / 3)
    const base = sharp({ create: { width: 1152, height: rows * 384, channels: 3, background: '#ffffff' } })
    const composites = tiles.flatMap((tile) => [
      { input: tile.input, left: tile.left, top: tile.top },
      { input: tile.label, left: tile.left + 8, top: tile.top + 8 },
    ])
    const sheet = await base.composite(composites).jpeg({ quality: 84 }).toBuffer()
    sheets.push(`data:image/jpeg;base64,${sheet.toString('base64')}`)
  }
  return sheets
}

export async function runBatchAiOpenRouter(input: {
  settings: BatchAiSettings
  systemPrompt: string
  userPrompt: string
  contactSheets: string[]
  referenceSheets?: string[]
}) {
  const content: any[] = [{ type: 'text', text: input.userPrompt }]
  input.contactSheets.forEach((url, index) => {
    content.push({ type: 'text', text: `Contact sheet ${index + 1}` })
    content.push({ type: 'image_url', image_url: { url } })
  })
  ;(input.referenceSheets || []).forEach((url, index) => {
    content.push({ type: 'text', text: `Эталоны цен ${index + 1}. Это не фотографии текущего товара.` })
    content.push({ type: 'image_url', image_url: { url } })
  })
  const payload = await openRouterChatCompletion({
    model: input.settings.openrouterModel,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content },
    ],
    temperature: input.settings.temperature,
    max_tokens: input.settings.maxTokens,
    response_format: { type: 'json_object' },
  })
  const text = payload?.choices?.[0]?.message?.content
  if (!text) throw new Error('ИИ вернул пустой ответ')
  return parseBatchAiJson(String(text))
}

function allowedOriginalPhotoUrls(photoUrls: unknown[], indexes: unknown[]) {
  const allowedHosts = new Set((process.env.AI_CATALOG_MEDIA_HOSTS || 'static.yeezyunique.ru,xcimg.szwego.com').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))
  const selected = [...new Set(indexes.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= photoUrls.length))].slice(0, 3)
  return selected.flatMap((index) => {
    try {
      const url = String(photoUrls[index - 1] || '')
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) && allowedHosts.has(parsed.hostname.toLowerCase())
        ? [{ index, url }]
        : []
    } catch { return [] }
  })
}

export async function runBatchAiOpenRouterRefinement(input: {
  settings: BatchAiSettings
  systemPrompt: string
  userPrompt: string
  previousOutput: unknown
  photoUrls: unknown[]
  indexes: unknown[]
}) {
  const originals = allowedOriginalPhotoUrls(input.photoUrls, input.indexes)
  if (!originals.length) return input.previousOutput
  const content: any[] = [{
    type: 'text',
    text: `${input.userPrompt}\n\nПредыдущий результат: ${JSON.stringify(input.previousOutput)}\n\nНиже только запрошенные оригиналы. Уточни плохо читаемый бренд/модель по ним и верни полный итоговый JSON той же схемы. Не запрашивай дополнительные фото.`,
  }]
  originals.forEach(({ index, url }) => {
    content.push({ type: 'text', text: `Оригинал фото ${index}` })
    content.push({ type: 'image_url', image_url: { url } })
  })
  const payload = await openRouterChatCompletion({
    model: input.settings.openrouterModel,
    messages: [{ role: 'system', content: input.systemPrompt }, { role: 'user', content }],
    temperature: input.settings.temperature,
    max_tokens: input.settings.maxTokens,
    response_format: { type: 'json_object' },
  })
  const text = payload?.choices?.[0]?.message?.content
  if (!text) throw new Error('ИИ вернул пустой ответ при уточнении оригинала')
  return parseBatchAiJson(String(text))
}

export function parseBatchAiJson(text: string) {
  const clean = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    const object = clean.match(/\{[\s\S]*\}/)?.[0]
    if (!object) throw new Error('ИИ вернул невалидный JSON')
    return JSON.parse(object)
  }
}

export function normalizeBatchAiOutput(raw: any, input: {
  product: any
  brandIds: Set<string>
  categoryIds: Set<string>
  subcategoryIds: Set<string>
  attributeCodes: Set<string>
  priceRuleKeys?: Set<string>
}) {
  const proposed = raw?.product || {}
  const original = input.product
  const choose = (value: unknown, allowed: Set<string>, fallback: unknown) => {
    const candidate = String(value || '')
    return allowed.has(candidate) ? candidate : String(fallback || '')
  }
  const attributes: Record<string, unknown> = { ...(original.attributes || {}) }
  const suggestions = Array.isArray(raw?.attribute_suggestions) ? raw.attribute_suggestions : []
  for (const [code, value] of Object.entries(proposed.catalog_attributes || {})) {
    if (input.attributeCodes.has(code)) attributes[code] = value
    else suggestions.push({ code, label: code, value, reason: 'Новый код из результата AI' })
  }
  const discard = new Set<number>((raw?.media?.discard_indexes || []).map(Number).filter((value: number) => value > 0))
  const sizeCharts = new Set<number>((raw?.media?.size_chart_indexes || []).map(Number).filter((value: number) => value > 0))
  const photos = Array.isArray(original.photos)
    ? original.photos.filter((_: string, index: number) => !discard.has(index + 1) && !sizeCharts.has(index + 1))
    : []

  return {
    product: {
      ...original,
      name: String(proposed.name || original.name || '').trim().slice(0, 250),
      description: String(proposed.description || original.description || '').trim().slice(0, 8000),
      h1: String(proposed.h1 || proposed.name || original.h1 || original.name || '').trim().slice(0, 250),
      seo_title: String(proposed.seo_title || '').trim().slice(0, 250),
      seo_description: String(proposed.seo_description || '').trim().slice(0, 500),
      brand: choose(proposed.brand, input.brandIds, original.brand),
      category: choose(proposed.category, input.categoryIds, original.category),
      subcategory: choose(proposed.subcategory, input.subcategoryIds, original.subcategory),
      gender: ['male', 'female', 'unisex'].includes(String(proposed.gender)) ? proposed.gender : original.gender,
      photos: photos.length > 0 ? photos : original.photos,
      attributes,
      ai_processed: true,
      ai_error: null,
      ai_confidence: Math.max(0, Math.min(1, Number(proposed.confidence || 0))),
      price_rule_key: input.priceRuleKeys?.has(String(proposed.price_rule_key || ''))
        ? String(proposed.price_rule_key)
        : '',
      variant_group_key: raw?.color_family?.confidence >= 0.75 && raw.color_family.group_signature
        ? crypto.createHash('sha256').update(String(raw.color_family.group_signature).trim().toLowerCase()).digest('hex').slice(0, 32)
        : original.variant_group_key || null,
    },
    suggestions,
    subcategorySuggestion: raw?.subcategory_suggestion || null,
    colorFamily: raw?.color_family || null,
    mediaDecision: { discard: [...discard], sizeCharts: [...sizeCharts] },
  }
}

function scalarAttribute(value: any): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarAttribute)
  if (value && typeof value === 'object') {
    return scalarAttribute(value.value ?? value.filter_value ?? value.display_value ?? value.values ?? value.filter_values ?? [])
  }
  return value === undefined || value === null ? [] : [String(value).trim().toLowerCase()]
}

export function matchingPriceRule(product: any, rules: any[]) {
  const candidates = rules.filter((rule) => {
    if (!rule.enabled) return false
    const conditions = rule.conditions || {}
    return Object.entries(conditions).every(([key, expected]) => {
      const actual = key.startsWith('attributes.')
        ? product.attributes?.[key.slice('attributes.'.length)]
        : product[key]
      if (expected && typeof expected === 'object' && !Array.isArray(expected) && ('min' in expected || 'max' in expected)) {
        const numericValues = scalarAttribute(actual)
          .map((value) => Number(String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]))
          .filter(Number.isFinite)
        if (!numericValues.length) return false
        const min = Number((expected as any).min)
        const max = Number((expected as any).max)
        return numericValues.some((value) =>
          (!Number.isFinite(min) || value >= min) && (!Number.isFinite(max) || value <= max)
        )
      }
      const expectedValues = scalarAttribute(expected)
      const actualValues = scalarAttribute(actual)
      return expectedValues.some((value) => actualValues.includes(value))
    })
  })
  return candidates.sort((left, right) => {
    const score = (rule: any) => Object.keys(rule.conditions || {}).length
      + (rule.conditions?.price_rule_key ? 1000 : 0)
    const specificity = score(right) - score(left)
    return specificity || Number(right.priority || 0) - Number(left.priority || 0)
  })[0] || null
}

const ATTRIBUTE_CODE_ALIASES: Record<string, string> = {
  color: 'colors',
  colour: 'colors',
  material: 'materials',
  size: 'sizes',
  model: 'model_name',
  model_names: 'model_name',
  bag_dimensions: 'dimensions',
  dimension: 'dimensions',
}

export function canonicalBatchSuggestionKey(value: unknown, kind = 'attribute') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_.-]+/giu, '_')
    .replace(/^_+|_+$/g, '')
  if (kind !== 'attribute') return normalized
  return ATTRIBUTE_CODE_ALIASES[normalized] || normalized
}

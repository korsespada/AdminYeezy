import sharp from 'sharp'
import { openRouterChatCompletion } from '@/lib/openrouter'
import { byesuChatCompletion } from '@/lib/byesu'
import { extractExplicitShoeAttributes } from '@/lib/product-attributes'
import {
  canonicalShoeSubcategoryName,
  inferGenericShoeSubcategoryName,
  isGenericShoeSubcategory,
} from '@/lib/shoe-taxonomy'
import { batchAiCategoryRuleFor } from '@/lib/batch-ai-category-rules'

export type BatchAiProvider = 'openrouter' | 'byesu' | 'cockpit'

export type BatchAiSettings = {
  provider: BatchAiProvider
  openrouterModel: string
  byesuModel: string
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

Если фотографии предоставлены, главный источник фактов — фотографии, затем исходный текст; соотноси сведения между всеми contact sheet одного товара. Исходный текст может по ошибке относиться к соседней карточке или другой модели. Сначала определи, какой товар стабильно показан на фотографиях, и проверь, согласуется ли с ним текст. При конфликте доверяй согласованной серии фотографий: модель, тип товара, цвет, материал, фурнитуру, категорию, подкатегорию и публичные тексты определяй по фотографиям, а противоречащие сведения из текста игнорируй. Если фотографий нет, работай только по тексту и не делай визуальных выводов. Не выдумывай модель, материал, размеры или характеристики.

Требования:
- Пиши по-русски, без китайских иероглифов, эмодзи, рекламных обещаний и упоминаний реплики.
- name: кратко «Бренд + тип/модель товара», без артикула.
- description: содержательное описание обычно 350–700 знаков. Сохраняй подтверждённые детали дизайна, формы, цвета, отделки, застёжек, материалов и размеров; разделяй смысловые части не более чем двумя одиночными переносами.
- h1, seo_title и seo_description должны быть естественными, полезными для поиска и без keyword stuffing.
- Не сообщай покупателю, что факт неизвестен или не удалось определить: просто не упоминай его.
- Не начинай текст словами «на фото видно», «на фотографиях представлено», «исходный текст» и подобными служебными фразами.
- Не используй слова «оригинал», «официальный», «лучший», «премиальный» или «трендовый» и не делай заявлений о подлинности.
- Внутренние артикулы не являются моделью и не должны попадать в публичные тексты.
- Коды сезона и коллекции вроде 24B, 25C и 26C не являются моделью и не должны попадать в model_name.
- Каждый подтверждённый материал перенеси и в description, и в подходящий атрибут.
- Бренд и категорию выбирай только из справочника. Не предлагай новые бренды или верхнеуровневые категории.
- model_name — свободное каноничное название конкретной линейки/модели. При низкой уверенности оставь пустым.
- Не записывай в атрибуты служебные заглушки «не определён», «не указано», «unknown» и подобные: неизвестное значение оставляй пустым.
- Используй существующие коды атрибутов. Новый атрибут вынеси только в attribute_suggestions.
- Новую подкатегорию вынеси только в subcategory_suggestion; не подменяй ею исходную подкатегорию.
- Перед предложением новой подкатегории сверь её со всем переданным справочником. Учитывай регистр, дефисы, число слов и близкие формулировки.
- Не создавай узкий синоним существующей подкатегории: например, «Сумки с верхней ручкой» и «Сумки с ручкой» считаются одной подкатегорией. Выбирай существующую более общую формулировку.
- Определи size_class как small, medium или large по фото и тексту наиболее вероятным образом.
- Для сумок запиши числовые bag_width_cm и bag_height_cm, если размеры явно указаны в тексте или уверенно читаются на таблице/фото. Не угадывай точные сантиметры только по внешнему виду.
- Если переданы ценовые правила, выбери price_rule_key только при уверенном совпадении модели, размеров или визуального эталона. Цена в этих правилах не должна попадать в тексты товара.
- Отметь рекламные, нерелевантные и дублирующиеся изображения для исключения. Фото таблиц размеров и замеров исключи из публичной галереи, но распознай размеры в sizes, а замеры изделия — в measurements.
- measurements заполняй только по явно читаемой таблице или тексту и только объектом {unit:"см",columns:[{key,label}],rows:[{size,values:{key:value}}],note:""}. В columns оставляй только реально указанные параметры, например length/Длина, chest/Обхват груди, shoulders/Плечи, sleeve/Рукав, waist/Талия, hips/Бёдра, rise/Посадка, inseam/Шаговый шов. Не смешивай таблицы разных товаров, не достраивай отсутствующие размеры и не пересчитывай значения.
- Для цветового семейства group_signature описывает неизменяемую основу товара и НИКОГДА не содержит цвет.
- В group_signature обязательно включи бренд, точную модель/конструкцию, размер самого товара, материал и фурнитуру. Цвет верни только в отдельном поле color.
- Для сумок должны совпадать бренд, model_name, размер самой сумки, материалы и фурнитура; разные размеры сумки не объединяй.
- Для обуви должны совпадать бренд, model_name, конструкция и материал; обувные размеры являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для одежды должны совпадать бренд, model_name/фасон и материал; размеры одежды являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для остальных категорий объединяй только при уверенном совпадении всех значимых характеристик кроме цвета.
- Верни строго JSON без markdown.`

export const GLOBAL_BATCH_AI_CATALOG_RULES = `Обязательные правила каталога для всех категорий:
- Заполняй catalog_attributes только кодами из переданной для конкретного товара схемы атрибутов. Не переноси атрибут из другой категории и не используй похожий по смыслу код не по назначению.
- Атрибут stones предназначен только для ювелирных изделий и бижутерии. Стразы, кристаллы и декоративные вставки на обуви, одежде или сумках описывай как декор в description, но никогда не записывай в stones и не предлагай stones как новый атрибут.
- Коды сезона и коллекции вроде 24B, 25C и 26C не являются model_name. Если точная коммерческая модель неизвестна, оставь model_name пустым.
- Не записывай в атрибуты служебные заглушки «не определён», «не указано», «unknown» и подобные: неизвестное значение оставляй пустым.

Глобальные правила сверки текста с фотографиями:
- Исходный текст ненадёжен и может относиться к другой карточке. Не переноси из него модель или характеристики автоматически.
- Если фотографии переданы, сначала установи общий товар на всей серии кадров, затем отдельно сверь с ним каждое утверждение исходного текста.
- При противоречии фотографий и текста фотографии важнее для модели, типа товара, цвета, материала, фурнитуры, категории, подкатегории, названия и описания.
- Если по визуальным признакам уверенно определяется более конкретная модель, используй её вместо общего или ошибочного названия из текста.
- Если фотографии переданы, description должен дополнять скудный исходный текст подтверждёнными визуальными деталями, а не просто пересказывать его. Опиши не менее четырёх информативных признаков, когда они различимы: тип и силуэт, форму, фактуру и цвет, конструкцию, застёжку или шнуровку, подошву и каблук, фурнитуру и декор. Для обуви отдельно учитывай форму мыска, высоту голенища, тип подошвы/каблука и способ фиксации. Не выдумывай скрытые свойства и точный состав материала.
- При наличии нескольких информативных фотографий делай description содержательным, обычно 350–700 знаков. Не сокращай его до одной общей фразы, даже если исходное китайское описание короткое.
- Не добавляй рекламные и неподтверждённые фразы вроде «идеальный выбор», «обеспечивает комфорт», «гарантирует устойчивость», «универсальное дополнение» или «купить».
- Не смешивай признаки разных товаров. Если кадр явно относится к другому товару, рекламе или упаковке, исключи его через media.discard_indexes.
- Таблицу замеров сохраняй в catalog_attributes.measurements строго как {unit:"см",columns:[{key,label}],rows:[{size,values:{key:value}}],note:""}. Одна строка соответствует одному размеру; один параметр — одной колонке. Используй только читаемые значения и не объединяй замеры разных товаров.
- При противоречии текста и фотографий или плохо читаемой таблице запроси через inspect_full_size_indexes до трёх наиболее информативных оригиналов, если они помогут уточнить модель, логотип, конструкцию или замеры.`

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
  const selectedCategory = categories.find((category) => String(category.id) === String(product.category))
    || (categories.length === 1 ? categories[0] : null)
  const categoryRule = batchAiCategoryRuleFor(selectedCategory?.name)
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
    'inspect_full_size_indexes: не более 3 номеров фото, которые нужно запросить в оригинальном размере для уточнения плохо читаемого бренда, модели, логотипа, таблицы замеров или конфликта между исходным текстом и фотографиями.',
    'До заполнения product сначала внутренне проверь согласованность текста и всей серии фотографий. Исходный текст может принадлежать другой карточке; противоречащие фотографиям сведения не используй.',
    `Особенности поставщика: ${supplierInstructions || 'нет'}`,
    categoryRule
      ? `Автоматические правила категории «${categoryRule.categoryName}». Они важнее особенностей поставщика:\n${categoryRule.rules}`
      : 'Для категории товара дополнительные автоматические правила пока не заданы.',
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

export function buildBatchAiVariantPrompt(product: any) {
  const textOnlyProduct = {
    external_id: product.external_id,
    name: product.name,
    description: product.description,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    gender: product.gender,
    attributes: product.attributes || {},
  }
  return [
    'Проверь только возможность объединить этот товар с такими же товарами других цветов.',
    'Используй исключительно переданные текстовые поля и атрибуты. Фотографии отсутствуют и не нужны.',
    'Ничего не переписывай, не классифицируй и не предлагай: SEO, цену, категорию, подкатегорию или атрибуты.',
    'Верни строго JSON вида {"color_family": null} либо {"color_family": {"group_signature":"","category_kind":"","model_name":"","bag_size":"","materials":[],"hardware":"","color":"","matching_evidence":"","confidence":0}}.',
    'color_family верни только если из текста достоверно известны конкретная модель/конструкция и цвет.',
    'group_signature — стабильная основа товара без цвета. Для сумок в ней должны совпасть бренд, точная модель, габариты, материал и фурнитура. Для обуви — бренд, модель, конструкция и материал; размер обуви не включай. Для одежды — бренд, модель/фасон и материал; размер одежды не включай.',
    'Не объединяй разные модели, конструкции, материалы, фурнитуру или размеры самого изделия. При сомнении верни null.',
    `Товар: ${JSON.stringify(textOnlyProduct)}`,
  ].join('\n\n')
}

export function buildBatchAiVisualFamilyPrompt(products: any[]) {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    color: product.attributes?.colors || [],
    model_name: product.attributes?.model_name || '',
    materials: product.attributes?.materials || [],
  }))
  return [
    'Сравни товары между собой по первым фотографиям. Номер товара совпадает с номером фотографии на contact sheet.',
    'Создай цветовую семью только когда это одна и та же физическая модель и конструкция, отличающаяся цветом.',
    'Сверяй силуэт, рисунок и плотность вязки, воротник, края, швы, фурнитуру, пропорции и расположение деталей.',
    'Одинаковый бренд и общее название товара сами по себе недостаточны.',
    'В каждой семье оставляй не больше одного товара каждого цвета. Повторную публикацию того же цвета укажи в duplicate_indexes и не включай в product_indexes.',
    'Не включай семьи с одним товаром, одним цветом или уверенностью ниже 0.9. При сомнении не объединяй.',
    'Верни строго JSON вида {"families":[{"label":"","product_indexes":[1,2],"duplicate_indexes":[],"matching_evidence":"","confidence":0.95}]}.',
    `Кандидаты: ${JSON.stringify(candidates)}`,
  ].join('\n\n')
}

export function buildBatchAiShadePrompt(products: any[]) {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    id: product.id,
    current_color: product.attributes?.colors || [],
    name: product.name,
  }))
  return [
    'Это один товар с одинаковым внутренним артикулом. Сравни только его цветовые варианты по первым фотографиям.',
    'Номер товара совпадает с номером фотографии на contact sheet.',
    'Если два товара имеют одинаковое общее название цвета, но визуально отличаются оттенком, сохрани оба и дай им разные точные русские названия: например «Светло-серый» и «Графитовый», «Светло-бежевый» и «Песочный».',
    'base_color — общий цвет для фильтра каталога: «Серый», «Бежевый», «Синий» и т. п.',
    'duplicate_of_index указывай только если это действительно повторная публикация визуально одинакового цвета. Разные оттенки дублями не являются.',
    'Если различие оттенков неуверенное, оставь duplicate_of_index пустым: система покажет оба товара человеку.',
    'Верни каждый переданный товар ровно один раз.',
    'Верни строго JSON вида {"variants":[{"product_index":1,"color":"Графитовый","base_color":"Серый","duplicate_of_index":null,"confidence":0.95}]}.',
    `Товары: ${JSON.stringify(candidates)}`,
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
  const completion = input.settings.provider === 'byesu' ? byesuChatCompletion : openRouterChatCompletion
  const payload = await completion({
    model: input.settings.provider === 'byesu' ? input.settings.byesuModel : input.settings.openrouterModel,
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
    text: `${input.userPrompt}\n\nПредыдущий результат: ${JSON.stringify(input.previousOutput)}\n\nНиже только запрошенные оригиналы. Уточни по ним плохо читаемый бренд, модель, конструкцию или конфликт между исходным текстом и фотографиями. Если текст относится к другому товару, проигнорируй противоречащие сведения и исправь весь результат по фотографиям. Верни полный итоговый JSON той же схемы. Не запрашивай дополнительные фото.`,
  }]
  originals.forEach(({ index, url }) => {
    content.push({ type: 'text', text: `Оригинал фото ${index}` })
    content.push({ type: 'image_url', image_url: { url } })
  })
  const completion = input.settings.provider === 'byesu' ? byesuChatCompletion : openRouterChatCompletion
  const payload = await completion({
    model: input.settings.provider === 'byesu' ? input.settings.byesuModel : input.settings.openrouterModel,
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
    try {
      return JSON.parse(object)
    } catch {
      const repaired = object
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
      try {
        return JSON.parse(repaired)
      } catch {
        throw new Error('ИИ вернул невалидный JSON')
      }
    }
  }
}

export function normalizeBatchAiOutput(raw: any, input: {
  product: any
  brandIds: Set<string>
  categoryIds: Set<string>
  subcategoryIds: Set<string>
  subcategoryParents?: Map<string, string>
  categoryNames?: Map<string, string>
  subcategoryNames?: Map<string, string>
  attributeCodes: Set<string>
  knownAttributeCodes?: Set<string>
  attributeDictionaryValues?: Array<{
    id?: string
    attribute_code?: string
    filter_value?: string
    canonical_value?: string
    aliases?: string[]
  }>
  priceRuleKeys?: Set<string>
}) {
  const proposed = raw?.product || {}
  const original = input.product
  const choose = (value: unknown, allowed: Set<string>, fallback: unknown) => {
    const candidate = String(value || '')
    if (allowed.has(candidate)) return candidate
    const previous = String(fallback || '')
    return allowed.has(previous) ? previous : ''
  }
  const attributes: Record<string, unknown> = {}
  for (const [code, value] of Object.entries(original.attributes || {})) {
    const canonicalCode = canonicalBatchSuggestionKey(code, 'attribute')
    if (input.attributeCodes.has(canonicalCode)) attributes[canonicalCode] = value
  }
  const suggestions: any[] = []
  const dictionaryByCode = new Map<string, Map<string, string>>()
  for (const item of input.attributeDictionaryValues || []) {
    const code = String(item.attribute_code || '')
    const canonical = String(item.canonical_value || '').trim()
    if (!code || !canonical) continue
    const values = dictionaryByCode.get(code) || new Map<string, string>()
    for (const candidate of [item.id, item.filter_value, item.canonical_value, ...(item.aliases || [])]) {
      const key = String(candidate || '').trim().toLowerCase()
      if (key) values.set(key, canonical)
    }
    dictionaryByCode.set(code, values)
  }
  const resolveDictionaryValue = (code: string, value: unknown) => {
    const dictionary = dictionaryByCode.get(code)
    if (!dictionary) return value
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\s*,\s*/).filter(Boolean)
    const resolved = source.map((item) => dictionary.get(String(item).trim().toLowerCase()) || String(item).trim()).filter(Boolean)
    if (['colors', 'materials'].includes(code) || Array.isArray(value) || resolved.length > 1) {
      return [...new Set(resolved)]
    }
    return resolved[0] || ''
  }
  for (const [code, value] of Object.entries(attributes)) {
    attributes[code] = resolveDictionaryValue(code, value)
  }
  const normalizedMaterial = (value: unknown) => {
    const text = String(value || '').trim()
    const key = text.toLowerCase().replace(/ё/g, 'е')
    if (/(caviar|кавьяр|рыбь.*икр|зернист.*кож)/i.test(key)) return 'Кожа'
    if (/(lambskin|ягнен)/i.test(key)) return 'Кожа ягнёнка'
    if (/(calfskin|теляч)/i.test(key)) return 'Телячья кожа'
    return text
  }
  const normalizeMaterials = (value: unknown) => {
    const values = Array.isArray(value) ? value : [value]
    return [...new Set(values.map(normalizedMaterial).filter(Boolean))]
  }
  const isCaviarMaterialSuggestion = (suggestion: any) => {
    const text = [suggestion?.code, suggestion?.label, suggestion?.value].flat().join(' ')
    return /(caviar|кавьяр|рыбь.*икр|зернист.*кож)/i.test(text)
  }
  for (const suggestion of (Array.isArray(raw?.attribute_suggestions) ? raw.attribute_suggestions : [])) {
    if (isCaviarMaterialSuggestion(suggestion)) {
      attributes.materials = normalizeMaterials([...(Array.isArray(attributes.materials) ? attributes.materials : []), 'Кожа'])
      continue
    }
    const code = canonicalBatchSuggestionKey(suggestion?.code || suggestion?.label, 'attribute')
    if (code && input.attributeCodes.has(code)) {
      if (suggestion?.value !== undefined && suggestion?.value !== null) attributes[code] = resolveDictionaryValue(code, suggestion.value)
    } else if (!input.knownAttributeCodes?.has(code)) {
      suggestions.push({ ...suggestion, code: code || suggestion?.code })
    }
  }
  for (const [code, value] of Object.entries(proposed.catalog_attributes || {})) {
    const canonicalCode = canonicalBatchSuggestionKey(code, 'attribute')
    if (canonicalCode === 'materials') attributes[canonicalCode] = normalizeMaterials(resolveDictionaryValue(canonicalCode, value))
    else if (input.attributeCodes.has(canonicalCode)) attributes[canonicalCode] = resolveDictionaryValue(canonicalCode, value)
    else if (!input.knownAttributeCodes?.has(canonicalCode)) {
      suggestions.push({ code: canonicalCode || code, label: code, value, reason: 'Новый код из результата AI' })
    }
  }
  if (attributes.materials !== undefined) attributes.materials = normalizeMaterials(attributes.materials)
  if (attributes.measurements !== undefined) {
    attributes.measurements = normalizeMeasurementRowSizes(attributes.measurements)
  }
  if (input.attributeCodes.has('sizes')) {
    const sizeSourceText = [original.description, proposed.description].filter(Boolean).join('\n')
    const categoryId = [proposed.category, original.category]
      .map((value) => String(value || ''))
      .find((value) => input.categoryIds.has(value)) || ''
    const isClothing = String(input.categoryNames?.get(categoryId) || '')
      .trim().toLowerCase().replace(/ё/g, 'е') === 'одежда'
    const sizeValues = [
      ...extractExplicitClothingSizes(sizeSourceText),
      ...(isClothing ? extractExplicitNumericClothingSizes(sizeSourceText) : []),
      ...attributeSizeValues(attributes.sizes),
      ...measurementRowSizes(attributes.measurements),
    ].map(canonicalClothingSize).filter(Boolean)
    if (sizeValues.length > 0) attributes.sizes = [...new Set(sizeValues)]
    if (
      !attributes.size_system
      && input.attributeCodes.has('size_system')
      && sizeValues.some((size) => /^(?:X{0,6}[SML]|\d+XL)$/i.test(size))
    ) {
      attributes.size_system = 'International'
    }
  }
  const emptyAttributeValues = new Set([
    '', '-', '—', 'null', 'n/a', 'unknown', 'неизвестно', 'не известно',
    'не определено', 'не определен', 'не определён', 'не указано', 'нет данных',
  ])
  const cleanAttributeValue = (code: string, value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value
        .map((item) => cleanAttributeValue(code, item))
        .filter((item) => item !== '' && item !== null && item !== undefined)
    }
    if (typeof value !== 'string') return value
    const text = value.trim()
    const key = text.toLowerCase().replace(/ё/g, 'е')
    if (emptyAttributeValues.has(key)) return ''
    if (code === 'model_name' && /^\d{2}\s*[a-z]$/i.test(text)) return ''
    return text
  }
  for (const [code, value] of Object.entries(attributes)) {
    const cleaned = cleanAttributeValue(code, value)
    if (cleaned === '' || (Array.isArray(cleaned) && cleaned.length === 0)) delete attributes[code]
    else attributes[code] = cleaned
  }
  if (input.attributeCodes.has('sizes') && scalarAttribute(attributes.sizes).length === 0) {
    const explicit = extractExplicitShoeAttributes([
      original.name,
      original.description,
      proposed.name,
      proposed.description,
      proposed.h1,
      proposed.seo_description,
    ].filter(Boolean).join('\n'))
    if (Array.isArray(explicit.sizes) && explicit.sizes.length > 0) attributes.sizes = explicit.sizes
    if (!attributes.size_system && explicit.size_system && input.attributeCodes.has('size_system')) {
      attributes.size_system = explicit.size_system
    }
  }
  const discard = new Set<number>((raw?.media?.discard_indexes || []).map(Number).filter((value: number) => value > 0))
  const sizeCharts = new Set<number>((raw?.media?.size_chart_indexes || []).map(Number).filter((value: number) => value > 0))
  const photos = Array.isArray(original.photos)
    ? original.photos.filter((_: string, index: number) => !discard.has(index + 1) && !sizeCharts.has(index + 1))
    : []
  let subcategory = choose(proposed.subcategory, input.subcategoryIds, original.subcategory)
  const proposedCategory = choose(proposed.category, input.categoryIds, original.category)
  const parentCategory = subcategory ? input.subcategoryParents?.get(subcategory) : undefined
  const category = parentCategory && input.categoryIds.has(parentCategory) ? parentCategory : proposedCategory
  const normalizedName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/ё/g, 'е')
  if (normalizedName(input.categoryNames?.get(category)) === 'сумки') {
    const selectedName = normalizedName(input.subcategoryNames?.get(subcategory))
    const shoulderBags = [...(input.subcategoryNames?.entries() || [])].find(([id, name]) => (
      normalizedName(name) === 'сумки на плечо'
      && (!input.subcategoryParents?.get(id) || input.subcategoryParents.get(id) === category)
    ))
    if ([
      'сумки-косметички', 'сумки косметички',
      'сумки-кейсы', 'сумки кейсы',
      'сумки с клапаном',
      'сумки-багет', 'сумки багет',
      'мини-сумки', 'мини сумки',
      'сумки-боулинг', 'сумки боулинг',
      'пляжные сумки', 'пляжная сумка',
    ].includes(selectedName) && shoulderBags) {
      subcategory = shoulderBags[0]
    }
    if (!subcategory || normalizedName(input.subcategoryNames?.get(subcategory)) === 'сумки') {
      throw new Error('Для категории «Сумки» требуется конкретная подкатегория вместо «Сумки»')
    }
  }

  let subcategorySuggestion = typeof raw?.subcategory_suggestion === 'string'
    ? { name: raw.subcategory_suggestion }
    : raw?.subcategory_suggestion || null
  if (normalizedName(input.categoryNames?.get(category)) === 'обувь') {
    const canonicalFromSelection = canonicalShoeSubcategoryName(input.subcategoryNames?.get(subcategory))
    const canonicalFromSuggestion = canonicalShoeSubcategoryName(subcategorySuggestion?.name)
    let canonicalName = canonicalFromSuggestion || canonicalFromSelection
    const proposedShoeText = [
      proposed.name,
      proposed.h1,
      proposed.seo_title,
      proposed.catalog_attributes?.model_name,
    ].filter(Boolean).join(' ')
    const explicitlyMules = /(мюл(?:и|ей|ям|ями|ях)?|\bmules?\b|穆勒鞋)/i.test(proposedShoeText)
    if (explicitlyMules && ['Туфли на каблуке', 'Туфли на плоской подошве'].includes(canonicalName)) {
      canonicalName = 'Мюли и сабо'
    }
    const canonicalEntry = canonicalName
      ? [...(input.subcategoryNames?.entries() || [])].find(([id, name]) => (
        canonicalShoeSubcategoryName(name) === canonicalName
        && (!input.subcategoryParents?.get(id) || input.subcategoryParents.get(id) === category)
      ))
      : undefined

    if (canonicalEntry) {
      subcategory = canonicalEntry[0]
      if (canonicalFromSuggestion) subcategorySuggestion = null
    }
    if (subcategory && isGenericShoeSubcategory(input.subcategoryNames?.get(subcategory))) {
      const inferredName = inferGenericShoeSubcategoryName([
        proposed.name,
        proposed.description,
        proposed.h1,
        proposed.seo_title,
        proposed.seo_description,
        original.name,
        original.description,
      ].filter(Boolean).join('\n'))
      const inferredEntry = [...(input.subcategoryNames?.entries() || [])].find(([id, name]) => (
        canonicalShoeSubcategoryName(name) === inferredName
        && (!input.subcategoryParents?.get(id) || input.subcategoryParents.get(id) === category)
      ))
      if (inferredEntry) subcategory = inferredEntry[0]
    }
    if (!subcategory || isGenericShoeSubcategory(input.subcategoryNames?.get(subcategory))) {
      throw new Error('Для категории «Обувь» требуется конкретная подкатегория вместо общей «Туфли»')
    }
    if (subcategorySuggestion && !canonicalFromSuggestion) {
      throw new Error('Для категории «Обувь» нельзя создавать новую подкатегорию: выберите существующий тип конструкции')
    }
  }

  const rawConfidence = Number(proposed.confidence || 0)
  const normalizedConfidence = rawConfidence > 1 && rawConfidence <= 100
    ? rawConfidence / 100
    : rawConfidence

  return {
    product: {
      ...original,
      name: String(proposed.name || original.name || '').trim().slice(0, 250),
      description: String(proposed.description || original.description || '').trim().slice(0, 8000),
      h1: String(proposed.h1 || proposed.name || original.h1 || original.name || '').trim().slice(0, 250),
      seo_title: String(proposed.seo_title || '').trim().slice(0, 250),
      seo_description: String(proposed.seo_description || '').trim().slice(0, 500),
      brand: choose(proposed.brand, input.brandIds, original.brand),
      category,
      subcategory,
      gender: ['male', 'female', 'unisex'].includes(String(proposed.gender)) ? proposed.gender : original.gender,
      photos: photos.length > 0 ? photos : original.photos,
      attributes,
      ai_processed: true,
      ai_error: null,
      ai_confidence: Math.max(0, Math.min(1, normalizedConfidence)),
      price_rule_key: input.priceRuleKeys?.has(String(proposed.price_rule_key || ''))
        ? String(proposed.price_rule_key)
        : '',
      // Цветовое семейство применяется только после серверной сверки нескольких
      // разных цветов и ручного одобрения предложения.
      variant_group_key: original.variant_group_key || null,
    },
    suggestions,
    subcategorySuggestion,
    colorFamily: raw?.color_family || null,
    mediaDecision: { discard: [...discard], sizeCharts: [...sizeCharts] },
  }
}

function attributeSizeValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(attributeSizeValues)
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    return attributeSizeValues(item.values ?? item.value ?? item.display_values ?? [])
  }
  return value === undefined || value === null ? [] : [String(value)]
}

function measurementRowSizes(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const rows = (value as Record<string, unknown>).rows
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => (
    row && typeof row === 'object' && !Array.isArray(row) && (row as Record<string, unknown>).size
      ? [String((row as Record<string, unknown>).size)]
      : []
  ))
}

function normalizeMeasurementRowSizes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const table = value as Record<string, unknown>
  if (!Array.isArray(table.rows)) return value
  return {
    ...table,
    rows: table.rows.map((row) => (
      row && typeof row === 'object' && !Array.isArray(row)
        ? { ...row, size: canonicalClothingSize((row as Record<string, unknown>).size) }
        : row
    )),
  }
}

function extractExplicitClothingSizes(value: unknown): string[] {
  const text = String(value || '')
  const result: string[] = []
  for (const match of text.matchAll(/(?:размеры?|sizes?)\s*[:：-]\s*([A-Z0-9.,/|•·\s-]{1,100})/gi)) {
    result.push(...String(match[1] || '').split(/[^A-Z0-9.]+/i).filter((item) => (
      /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-6]XL)$/i.test(item)
    )))
  }
  return result
}

function extractExplicitNumericClothingSizes(value: unknown): string[] {
  const text = String(value || '')
  const result: string[] = []
  for (const match of text.matchAll(/(?:размеры?|sizes?)\s*[:：-]\s*([0-9.,/|•·\s–—-]{1,100})/gi)) {
    const raw = String(match[1] || '').trim()
    const range = raw.match(/^(\d{1,3}(?:[.,]5)?)\s*[-–—]\s*(\d{1,3}(?:[.,]5)?)$/)
    if (range) {
      const from = Number(range[1].replace(',', '.'))
      const to = Number(range[2].replace(',', '.'))
      const step = Number.isInteger(from) && Number.isInteger(to) ? 1 : 0.5
      const count = Math.floor((to - from) / step) + 1
      if (to >= from && count <= 20) {
        result.push(...Array.from({ length: count }, (_, index) => {
          const size = from + index * step
          return Number.isInteger(size) ? String(size) : size.toFixed(1)
        }))
      }
      continue
    }
    result.push(...raw.split(/[^0-9.,]+/).map((item) => item.replace(',', '.')).filter((item) => (
      /^\d{1,3}(?:\.5)?$/.test(item)
    )))
  }
  return result
}

function canonicalClothingSize(value: unknown) {
  const size = String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(',', '.')
  const numericXl = size.match(/^([2-6])XL$/)
  if (numericXl) return `${'X'.repeat(Number(numericXl[1]))}L`
  return size
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
  bag_width: 'bag_width_cm',
  bag_height: 'bag_height_cm',
  hardware: 'hardware_color',
  hardware_colour: 'hardware_color',
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

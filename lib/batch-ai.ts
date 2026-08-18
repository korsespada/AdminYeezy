import sharp from 'sharp'
import { openRouterChatCompletion } from '@/lib/openrouter'
import { byesuChatCompletion } from '@/lib/byesu'
import { anthropicMessagesCompletion } from '@/lib/anthropic'
import { providerProtocol } from '@/lib/ai-providers'
import { extractExplicitShoeAttributes, inferExplicitShoeGender, inferShoeGender } from '@/lib/product-attributes'
import {
  canonicalShoeSubcategoryName,
  inferGenericShoeSubcategoryName,
  inferShoeSlingbackSubcategoryName,
  isGenericShoeSubcategory,
} from '@/lib/shoe-taxonomy'
import {
  canonicalClothingSubcategoryName,
  inferClothingSubcategoryName,
  isLegacyClothingSubcategory,
} from '@/lib/clothing-taxonomy'
import { batchAiCategoryRuleForRules, normalizeBatchAiCategoryRules, type BatchAiCategoryRule } from '@/lib/batch-ai-category-rules'
import { normalizeRetainedPhotoAlts } from '@/lib/product-media-seo'
import { normalizeSupplierPublishedOn, supplierPublishedOnFromAttributes } from '@/lib/supplier-publication'
import { normalizeMeasurementTable, normalizeProductMeasurements, productMeasurementSizes, type MeasurementTable } from '@/lib/measurement-templates'

export type BatchAiProvider = 'openrouter' | 'byesu' | 'cockpit'

export type BatchAiProcessingOptions = {
  colorFamilyByArticle: boolean
  colorFamilyBySequence?: boolean
  articleExample: string
  splitAlbumColors: boolean
  reorderFirstPhoto: boolean
  skipModelOnlyAlbum: boolean
  suggestSubcategories?: boolean
  suggestAttributes?: boolean
}

export const DEFAULT_BATCH_AI_PROCESSING_OPTIONS: BatchAiProcessingOptions = {
  colorFamilyByArticle: false,
  colorFamilyBySequence: false,
  articleExample: '',
  splitAlbumColors: false,
  reorderFirstPhoto: false,
  skipModelOnlyAlbum: false,
  suggestSubcategories: false,
  suggestAttributes: false,
}

export function normalizeBatchAiProcessingOptions(value: unknown): BatchAiProcessingOptions {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    colorFamilyByArticle: source.colorFamilyByArticle === true,
    colorFamilyBySequence: source.colorFamilyBySequence === true,
    articleExample: String(source.articleExample || '').trim().slice(0, 500),
    splitAlbumColors: source.splitAlbumColors === true,
    reorderFirstPhoto: source.reorderFirstPhoto === true,
    skipModelOnlyAlbum: source.skipModelOnlyAlbum === true,
    // Таксономия каталога закрыта: AI выбирает только значения из справочников.
    suggestSubcategories: false,
    suggestAttributes: false,
  }
}

export type BatchAiSettings = {
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
  categoryRules: BatchAiCategoryRule[]
  processingOptions?: BatchAiProcessingOptions
}

export function restoreRetryProductsFromSnapshots(products: any[], sourceRows: Array<{ product_id?: number; source_product?: unknown }>) {
  const sources = new Map(
    sourceRows
      .map((row) => [Number(row.product_id), row.source_product] as const)
      .filter(([productId, source]) => Number.isInteger(productId) && source && typeof source === 'object'),
  )
  return products.map((product) => {
    const source = sources.get(Number(product?.id))
    if (!source || typeof source !== 'object') return product
    return {
      ...(source as Record<string, unknown>),
      id: product.id,
      batch_id: product.batch_id,
    }
  })
}

function anthropicImageContent(url: string) {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/i)
  if (match) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    }
  }
  return { type: 'image', source: { type: 'url', url } }
}

function toAnthropicContent(content: any[]) {
  return content.flatMap((item): any[] => {
    if (item?.type === 'text') return [{ type: 'text', text: String(item.text || '') }]
    if (item?.type === 'image_url' && item.image_url?.url) return [anthropicImageContent(String(item.image_url.url))]
    return []
  })
}

function anthropicResponseText(payload: Record<string, any>) {
  return Array.isArray(payload?.content)
    ? payload.content.filter((block: any) => block?.type === 'text').map((block: any) => String(block.text || '')).join('\n').trim()
    : ''
}

export type BatchAiLookup = { id: string; name: string; parent_id?: string | null }
export type BatchAiChromoffCategory = BatchAiLookup & { slug?: string; path?: string }

const LEGACY_SUBCATEGORY_NAMES_HIDDEN_FROM_AI = new Set(['туфли', 'сумки', 'кофты'])

export function filterLegacySubcategoriesForAi<T extends { id: string; name: string }>(subcategories: T[]) {
  return subcategories.filter((subcategory) => {
    const normalizedName = String(subcategory.name || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    return !LEGACY_SUBCATEGORY_NAMES_HIDDEN_FROM_AI.has(normalizedName)
  })
}

export const CHROMOFF_AUTO_SUPPLIER_IDS = new Set([
  '_Z4krSCEyDqn5hvTYMJDEp4rykS4WwC0I',
  '_d_MrS1r4uCqp1cjuoVnfj6jJ42_p9R9NgeH-vag',
  '_Z6wrSBWbbi48HUyk59lk5c4PXN9NKqUQ',
])
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

export type BatchAiModelReference = {
  model_key: string
  model_name: string
  aliases?: string[]
  visual_hint?: string | null
  reference_images?: string[]
  reference_photo_numbers?: number[]
}

type SupplierPriceFormula = {
  source_price?: 'max' | 'min'
  multiplier?: number
  secondary_multiplier?: number
  round_to?: number
  rounding?: 'nearest' | 'up' | 'down'
}

export type BatchAiFamilyDefinitionSource = 'internal_code' | 'visual_comparison'

export type BatchAiFamilyDefinition = {
  source: BatchAiFamilyDefinitionSource
  grouping_fields: string[]
  text_evidence_fields: string[]
  photo_decision_fields: string[]
  output_fields: string[]
  rules: string[]
}

export function buildBatchAiFamilyDefinition(source: BatchAiFamilyDefinitionSource): BatchAiFamilyDefinition {
  const byInternalCode = source === 'internal_code'
  return {
    source,
    grouping_fields: byInternalCode
      ? ['attributes.model_code', 'brand', 'category', 'subcategory']
      : ['brand', 'category', 'subcategory', 'photos[0]'],
    text_evidence_fields: ['external_id', 'name', 'brand', 'category', 'subcategory', 'attributes.model_code', 'attributes.model_name', 'attributes.materials', 'attributes.colors'],
    photo_decision_fields: ['model_name', 'color', 'base_color', 'construction', 'material', 'duplicate_of_index'],
    output_fields: ['family_label', 'model_name', 'color', 'base_color', 'matching_evidence', 'confidence', 'duplicate_of_index'],
    rules: byInternalCode
      ? [
          'attributes.model_code используется как первичный ключ одной модели, но сам по себе не доказывает одинаковый цвет.',
          'Модель, конструкцию, материал и цвет уточняй по фотографиям.',
          'Обувные размеры — варианты внутри цвета и не разделяют семейство.',
        ]
      : [
          'Объединяй только одну физическую модель, совпадающую по фото; общий бренд и название недостаточны.',
          'Модель, конструкцию, материал и цвет определяй по фотографиям.',
          'Не объединяй товары при сомнении или при различии конструкции/материала.',
        ],
  }
}

export const DEFAULT_BATCH_AI_SYSTEM_PROMPT = `Ты — редактор каталога премиальных товаров. Обрабатывай сырой китайский товар только по предоставленному тексту и фотографиям.

Если фотографии предоставлены, главный источник фактов — фотографии, затем исходный текст; соотноси сведения между всеми contact sheet одного товара. Исходный текст может по ошибке относиться к соседней карточке или другой модели. Сначала определи, какой товар стабильно показан на фотографиях, и проверь, согласуется ли с ним текст. При конфликте доверяй согласованной серии фотографий: модель, тип товара, цвет, материал, фурнитуру, категорию, подкатегорию и публичные тексты определяй по фотографиям, а противоречащие сведения из текста игнорируй. Если фотографий нет, работай только по тексту и не делай визуальных выводов. Не выдумывай модель, материал, размеры или характеристики.

Требования:
- Пиши по-русски, без китайских иероглифов, эмодзи, рекламных обещаний и упоминаний реплики.
- brand выбирай только из справочника и возвращай отдельным полем.
- name: видимый заголовок товара без бренда и артикула, но с точным цветом. Например: «Чёрная сумка 22 Mini из стёганой кожи».
- photo_alts: если переданы фотографии, верни ровно один короткий alt на каждую исходную фотографию в исходном порядке, включая кадры, которые предлагаешь исключить. Целевая длина 60–120 символов, жёсткий максимум 160 символов. Пиши по-русски: товар, ракурс и 1–2 видимые детали, без рекламных обещаний и неподтверждённых свойств.
- description: содержательное описание обычно 350–700 знаков. Сохраняй подтверждённые детали дизайна, формы, цвета, отделки, застёжек, материалов и размеров; разделяй смысловые части не более чем двумя одиночными переносами.
- Точно переноси из исходника конкретные факты о материале и фурнитуре: например, 羊皮 означает овечью/натуральную кожу, а 925制银 — серебряную фурнитуру 925 пробы. Не заменяй явно указанный материал на «хлопковый трикотаж» и не добавляй конструкцию, которой нет в тексте или на фото (карманы, пуллеры, нашивки, застёжки и т. п.).
- Не выбрасывай подтверждённые технические детали исходника при сокращении описания. Рекламные обещания, себестоимость, наличие и заявления о «полном соответствии оригиналу» можно не переносить, но материал, фурнитуру, способ отделки, упаковку и размерный ряд сохраняй, если они явно указаны или видны.
- Не возвращай h1, seo_title или seo_description: сервер запишет h1 равным name, а Rails сформирует SEO-поля из бренда, name и цены после сохранения товара.
- Не сообщай покупателю, что факт неизвестен или не удалось определить: просто не упоминай его.
- Не начинай текст словами «на фото видно», «на фотографиях представлено», «исходный текст» и подобными служебными фразами.
- Не используй слова «оригинал», «официальный», «лучший», «премиальный» или «трендовый» и не делай заявлений о подлинности.
- Внутренние артикулы не являются моделью и не должны попадать в публичные тексты.
- Каждый подтверждённый материал перенеси и в description, и в подходящий атрибут.
- Бренд и категорию выбирай только из справочника. Не предлагай новые бренды или верхнеуровневые категории.
- model_name — свободное каноничное название конкретной линейки/модели. При низкой уверенности оставь пустым.
- Не записывай в атрибуты служебные заглушки «не определён», «не указано», «unknown» и подобные: неизвестное значение оставляй пустым.
- Используй только существующие коды атрибутов, бренды, категории и подкатегории. Не предлагай и не создавай новые значения.
- Определи size_class как small, medium или large по фото и тексту наиболее вероятным образом.
- Для сумок запиши числовые bag_width_cm и bag_height_cm, если размеры явно указаны в тексте или уверенно читаются на таблице/фото. Не угадывай точные сантиметры только по внешнему виду.
- Если переданы ценовые правила, выбери price_rule_key только при уверенном совпадении модели, размеров или визуального эталона. Цена в этих правилах не должна попадать в тексты товара.
- Исключай только рекламные, нерелевантные, дублирующиеся кадры и фото таблиц размеров/замеров. Если основной товар лежит рядом с упаковкой или другим товаром, но сам хорошо виден и остаётся главным объектом кадра, не исключай его. Исключай упаковку или другой товар только когда они доминируют в кадре либо делают продаваемый товар неясным. Исключай кадры с крупным наложенным текстом поверх фото: цена, акция, призыв, рекламная надпись на китайском, английском или любом другом языке; мелкий логотип товара или ненавязчивый водяной знак не исключай. Фото таблиц размеров и замеров исключи из публичной галереи, но распознай размеры в sizes, а замеры изделия — в measurements.
- measurements заполняй только по явно читаемой таблице или тексту и только объектом {unit:"см",columns:[{key,label}],rows:[{size,values:{key:value}}],note:""}. В columns оставляй только реально указанные параметры: для одежды length/Длина, chest/Обхват груди, shoulders/Плечи, sleeve/Рукав, waist/Талия, hips/Бёдра, rise/Посадка, inseam/Шаговый шов; для обуви insole_length/Длина стельки, foot_length/Длина стопы, width/Ширина, instep/Подъём, shaft_height/Высота голенища. Не смешивай таблицы разных товаров, не достраивай отсутствующие размеры и не пересчитывай значения.
- Для цветового семейства group_signature описывает неизменяемую основу товара и НИКОГДА не содержит цвет.
- В group_signature обязательно включи бренд, точную модель/конструкцию, размер самого товара, материал и фурнитуру. Цвет верни только в отдельном поле color.
- Для сумок должны совпадать бренд, model_name, размер самой сумки, материалы и фурнитура; разные размеры сумки не объединяй.
- Для обуви должны совпадать бренд, model_name, конструкция и материал; обувные размеры являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для одежды должны совпадать бренд, model_name/фасон и материал; размеры одежды являются вариантами внутри каждого цвета и не разделяют цветовое семейство.
- Для остальных категорий объединяй только при уверенном совпадении всех значимых характеристик кроме цвета.
- Верни строго JSON без markdown.`

export const GLOBAL_BATCH_AI_CATALOG_RULES = `Обязательные правила каталога для всех категорий:
- Эти правила имеют приоритет над любыми противоречащими инструкциями из сохранённого системного промпта или настроек поставщика.
- Бренд выбирай только из справочника и возвращай отдельным полем brand.
- name — видимый заголовок товара без бренда и артикула, но с точным цветом. Пример: «Чёрный лонгслив с разноцветными крестами».
- Не возвращай h1, seo_title или seo_description. Сервер записывает h1 равным name; Rails формирует title и meta description из бренда, name и текущей цены.
- Используй только существующие бренды, категории, подкатегории и коды атрибутов. Не возвращай attribute_suggestions или subcategory_suggestion и не предлагай новые сущности.
- Заполняй catalog_attributes только кодами из переданной для конкретного товара схемы атрибутов. Не переноси атрибут из другой категории и не используй похожий по смыслу код не по назначению.
- Не записывай в атрибуты служебные заглушки «не определён», «не указано», «unknown» и подобные: неизвестное значение оставляй пустым.
- Для сумок с подтверждёнными габаритами обязательно заполни dimensions в формате «Ш × В × Г см» или, если глубина не дана, «Ш × В см», а также bag_width_cm и bag_height_cm. Для кошельков, картхолдеров и обложек паспорта сохраняй подтверждённые габариты в dimensions, в том числе если известны только ширина и высота. Не записывай размер сумки в sizes: это не размерный ряд. Если подтверждён номинальный размер модели, например Classic Flap 25, включи его в name без бренда.
- Для сумок при подтверждённом тексте или фото обязательно заполни hardware_color допустимым значением из схемы атрибутов. Не угадывай цвет фурнитуры.

Глобальные правила сверки текста с фотографиями:
- Исходный текст ненадёжен и может относиться к другой карточке. Не переноси из него модель или характеристики автоматически.
- Если фотографии переданы, сначала установи общий товар на всей серии кадров, затем отдельно сверь с ним каждое утверждение исходного текста.
- При противоречии фотографий и текста фотографии важнее для модели, типа товара, цвета, материала, фурнитуры, категории, подкатегории, названия и описания.
- Не считай отсутствием на фото или невозможностью рассмотреть деталь противоречие тексту: если фотография не позволяет проверить материал или фурнитуру, сохраняй явно указанный в исходнике факт. Игнорируй текст только при прямом визуальном конфликте, например на фото явно тканевое изделие, а текст утверждает, что оно кожаное.
- Для китайских технических описаний сохраняй конкретные факты: 羊皮 — натуральная овечья кожа, 真皮 — натуральная кожа, 925制银/纯银 — серебро 925 пробы, 拉链 — молния, 刺绣 — вышивка, 进口高精密绣花 — импортная высокоточная вышивка. Не заменяй эти факты общим материалом и не придумывай карманы, пуллеры, нашивки или застёжки, если они не указаны или не видны.
- Если по визуальным признакам уверенно определяется более конкретная модель, используй её вместо общего или ошибочного названия из текста.
- Если фотографии переданы, description должен дополнять скудный исходный текст подтверждёнными визуальными деталями, а не просто пересказывать его. Опиши не менее четырёх информативных признаков, когда они различимы: тип и силуэт, форму, фактуру и цвет, конструкцию, застёжку или шнуровку, подошву и каблук, фурнитуру и декор. Для обуви отдельно учитывай форму мыска, высоту голенища, тип подошвы/каблука и способ фиксации. Не выдумывай скрытые свойства и точный состав материала.
- При наличии нескольких информативных фотографий делай description содержательным, обычно 350–700 знаков. Не сокращай его до одной общей фразы, даже если исходное китайское описание короткое.
- Не добавляй рекламные и неподтверждённые фразы вроде «идеальный выбор», «обеспечивает комфорт», «гарантирует устойчивость», «универсальное дополнение» или «купить».
- Для одежды подкатегорию определяй по фактически видимому основному изделию: мини, миди и макси-платья, платья-поло и платья-футболки относятся к «Платья»; комбинезоны и ромперы также относятся к «Платья»; юбки — к «Юбки»; джинсы — к «Джинсы»; джинсовые шорты — к «Шорты».
- Не назначай «Комплекты» только из-за слов «комплект», «套装» или из-за двух цветовых вариантов одной вещи. «Комплекты» допустимы только когда на фотографиях видны два разных предмета одежды, продаваемых вместе. Если на фотографиях виден только один предмет, игнорируй противоречащее ему описание комплекта и выбери категорию этого предмета.
- Не смешивай признаки разных товаров. Если основной товар лежит рядом с упаковкой или другим товаром, но явно является главным объектом, оставь кадр и описывай только его. Исключи кадр через media.discard_indexes, только если другой товар, упаковка или реклама доминируют и делают основной товар неясным; также исключай изображения с крупным наложенным рекламным/информационным текстом, ценой, акцией или призывом на любом языке. Не исключай из-за небольшого логотипа или водяного знака.
- Сначала сопоставь каждую таблицу замеров с видимым товаром. Если таблица не относится ни к основному товару, ни к подтверждённой части комплекта, добавь её фото в media.discard_indexes: не записывай её в sizes или measurements и не добавляй в media.size_chart_indexes.
- Для одного товара сохраняй только одну наиболее подходящую читаемую таблицу в catalog_attributes.measurements как {unit:"см",columns:[{key,label}],rows:[{size,values:{key:value}}],note:""}. Одна строка соответствует одному размеру; один параметр — одной колонке. Если в альбоме несколько таблиц, но это не подтверждённый комплект с разными вещами, выбери только таблицу основного товара; остальные неподходящие таблицы исключи через media.discard_indexes.
- Только для подтверждённого комплекта из двух или более разных вещей, когда для каждой вещи есть явно соответствующая ей читаемая таблица, верни measurements.tabs: [{label:"Майка",unit:"см",columns:[...],rows:[...],note:""},{label:"Джемпер",unit:"см",columns:[...],rows:[...],note:""}]. label — точное название вещи, одно русское слово, без цвета, размера, цифр и повторов. Не возвращай measurements.tabs, если подходящая таблица только одна.
- При противоречии текста и фотографий или плохо читаемой таблице запроси через inspect_full_size_indexes до трёх наиболее информативных оригиналов, если они помогут уточнить модель, логотип, конструкцию или замеры.`

export function buildBatchAiUserPrompt(input: {
  product: any
  supplierInstructions?: string | null
  brands: BatchAiLookup[]
  categories: BatchAiLookup[]
  subcategories: BatchAiLookup[]
  attributes: BatchAiAttributeDefinition[]
  priceRules?: BatchAiPriceRuleHint[]
  priceAiInstructions?: string | null
  modelReferences?: BatchAiModelReference[]
  chromoffMode?: boolean
  chromoffCategories?: BatchAiChromoffCategory[]
  categoryRules?: BatchAiCategoryRule[]
  processingOptions?: BatchAiProcessingOptions
}) {
  const { product, supplierInstructions, brands, categories, subcategories, attributes, priceRules = [], priceAiInstructions, modelReferences = [], chromoffMode = false, chromoffCategories = [], processingOptions = DEFAULT_BATCH_AI_PROCESSING_OPTIONS } = input
  const configuredCategoryRules = normalizeBatchAiCategoryRules(input.categoryRules)
  const selectedCategory = categories.find((category) => String(category.id) === String(product.category))
    || (() => {
      const selectedSubcategory = subcategories.find((subcategory) => String(subcategory.id) === String(product.subcategory))
      return categories.find((category) => String(category.id) === String(selectedSubcategory?.parent_id))
    })()
    || (categories.length === 1 ? categories[0] : null)
  const matchingCategoryRule = batchAiCategoryRuleForRules(selectedCategory?.name, configuredCategoryRules)
  const categoryRules = selectedCategory
    ? (matchingCategoryRule ? [matchingCategoryRule] : [])
    : configuredCategoryRules
  const categoryRulePrompt = categoryRules.length > 0
    ? categoryRules.map((rule) => `Автоматические правила категории «${rule.categoryName}». Они важнее особенностей поставщика:\n${rule.rules}`).join('\n\n')
    : 'Для категории товара дополнительные автоматические правила пока не заданы.'
  let referenceOffset = 0
  const priceRulePrompt = priceRules.map((rule) => {
    const references = (rule.reference_images || []).map((_, index) => referenceOffset + index + 1)
    referenceOffset += references.length
    return {
      rule_key: rule.rule_key,
      name: rule.name,
      conditions: rule.conditions,
      price: rule.price,
      visual_hint: rule.visual_hint || '',
      reference_photo_numbers: references,
    }
  })
  let modelReferenceOffset = 0
  const modelReferencePrompt = modelReferences.map((reference) => {
    const references = (reference.reference_images || []).map((_, index) => modelReferenceOffset + index + 1)
    modelReferenceOffset += references.length
    return {
      model_key: reference.model_key,
      model_name: reference.model_name,
      aliases: reference.aliases || [],
      visual_hint: reference.visual_hint || '',
      reference_photo_numbers: references,
    }
  })
  return [
    'Верни объект следующей формы:',
    JSON.stringify({
      product: {
        name: '', description: '',
        brand: 'existing-id-or-empty', category: 'existing-id', subcategory: 'existing-id-or-original',
        gender: 'male|female|unisex|null', catalog_attributes: { model_reference_key: '' }, price_rule_key: '', price: null, confidence: 0,
      },
      chromoff_category: chromoffMode ? { id: 'existing-chromoff-category-id-or-empty', confidence: 0, reason: '' } : null,
      photo_alts: [],
      media: { discard_indexes: [], size_chart_indexes: [] },
      inspect_full_size_indexes: [],
      color_family: null,
      ai_processing: {
        skip_product: false,
        cover_photo_index: null,
        article_key: '',
      },
    }),
    'Индексы фотографий начинаются с 1 и подписаны на contact sheet.',
    'inspect_full_size_indexes: не более 3 номеров фото, которые нужно запросить в оригинальном размере для уточнения плохо читаемого бренда, модели, логотипа, таблицы замеров или конфликта между исходным текстом и фотографиями.',
    'До заполнения product сначала внутренне проверь согласованность текста и всей серии фотографий. Исходный текст может принадлежать другой карточке; противоречащие фотографиям сведения не используй.',
    `Особенности поставщика: ${supplierInstructions || 'нет'}`,
    categoryRules.length > 1
      ? `Автоматические правила категорий. Выбери правило после определения верхней категории; эти правила важнее особенностей поставщика:\n${categoryRulePrompt}`
      : categoryRulePrompt,
    `Товар: ${JSON.stringify(product)}`,
    `Бренды: ${JSON.stringify(brands)}`,
    `Категории: ${JSON.stringify(categories)}`,
    `Подкатегории: ${JSON.stringify(subcategories)}`,
    ...(chromoffMode ? [
      'Это режим Chromoff для поставщика из списка Chromoff. Выбери chromoff_category только из отдельного справочника ниже. Не заменяй её общей категорией YeezyUnique.',
      'Выбирай наиболее конкретную подкатегорию из справочника; родительскую категорию выбирай только если у неё нет подходящей дочерней категории.',
      'Если товар нельзя уверенно отнести к одной категории Chromoff, верни пустой id и confidence ниже 0.75. Товар останется скрытым для ручной проверки.',
      `Категории Chromoff: ${JSON.stringify(chromoffCategories)}`,
    ] : []),
    `Схема атрибутов: ${JSON.stringify(attributes)}`,
    `Ценовые правила поставщика: ${JSON.stringify(priceRulePrompt)}`,
    `Общая инструкция поставщика по ценам: ${priceAiInstructions || 'нет'}`,
    `Визуальный справочник моделей Chanel: ${JSON.stringify(modelReferencePrompt)}`,
    'После contact sheet товара приложен отдельный лист «Эталоны моделей Chanel». Сопоставляй текущий товар с этими эталонами прежде всего по силуэту, конструкции, клапану, ручкам, цепи, застёжке и пропорциям. Китайские aliases и visual_hint — только подсказка, не доказательство. Если уверенно совпал эталон, верни его model_key в catalog_attributes.model_reference_key; затем используй каноническое model_name этого эталона. Если совпадения нет, оставь model_reference_key пустым и выбери точный тип товара по фотографиям. Не переноси модель только из текста.',
    'Номера визуальных эталонов относятся к отдельному листу «Эталоны цен», а не к фотографиям товара. Выбирай price_rule_key только по условиям правила. Для правила с price_formula следуй price_instruction и найди в исходном описании нужную цену или диапазон, но не вычисляй итоговую цену сам: сервер применит формулу и округление. Цена будет применена сервером после ответа AI; если заполнена общая инструкция поставщика по ценам, верни в product.price только явно указанную этой инструкцией цену для текущего товара, иначе оставь product.price равным null. Не помещай цену в тексты товара.',
    'Общую инструкцию поставщика по ценам используй как дополнительную подсказку для выбора price_rule_key. Она может содержать несколько товаров и цен; сопоставляй товар по смыслу, но не выдумывай цену и не помещай её в публичные поля.',
    'Не возвращай attribute_suggestions или subcategory_suggestion: новые атрибуты и подкатегории не предлагаются.',
    'color_family: {group_signature,category_kind,model_name,bag_size,materials,hardware,color,matching_evidence,confidence} или null.',
    ...(processingOptions.colorFamilyByArticle ? [
      `Определи цветовое семейство по артикулу/коду модели. Пример пользователя: «${processingOptions.articleExample || 'SP001 blue'}». Если в таких артикулах цвет идёт после общей основы (например, SP001 blue и SP001 green), в color_family.group_signature и ai_processing.article_key оставь только общую основу SP001, а цвет запиши отдельно в color. Не объединяй разные модели только из-за похожего артикула.`,
    ] : []),
    ...(processingOptions.reorderFirstPhoto ? [
      'Подбери лучший продающий кадр и верни его исходный номер в ai_processing.cover_photo_index. Разрешено менять только первое фото, остальные оставь в исходном порядке.',
    ] : []),
    ...(processingOptions.skipModelOnlyAlbum ? [
      'Если весь альбом состоит только из фотографий моделей/людей и на них нельзя уверенно оценить сам товар, верни ai_processing.skip_product=true. Это исключит весь товар из текущей версии, а не отдельные фотографии. Если товар показан хотя бы на одном информативном кадре, skip_product=false.',
    ] : []),
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

export function buildBatchAiVisualFamilyPrompt(
  products: any[],
  familyDefinition = buildBatchAiFamilyDefinition('visual_comparison'),
) {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    id: product.id,
    external_id: product.external_id || '',
    model_code: product.attributes?.model_code || '',
    name: product.name,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    color: product.attributes?.colors || [],
    model_name: product.attributes?.model_name || '',
    materials: product.attributes?.materials || [],
  }))
  return [
    `Определение семейства: ${JSON.stringify(familyDefinition)}`,
    'Сравни товары между собой по первым фотографиям. Номер товара совпадает с номером фотографии на contact sheet.',
    'Создай цветовую семью только когда это одна и та же физическая модель и конструкция, отличающаяся цветом.',
    'Сверяй силуэт, рисунок и плотность вязки, воротник, края, швы, фурнитуру, пропорции и расположение деталей.',
    'Одинаковый бренд и общее название товара сами по себе недостаточны.',
    'Включай все варианты одной модели. Если общее название цвета одинаковое, но оттенки на фото различаются, дай им разные точные русские названия, например «Светло-серый» и «Графитовый».',
    'base_color — общий цвет для фильтра каталога. duplicate_of_index указывай только для действительно повторной публикации визуально одинакового оттенка; разные оттенки дублями не являются.',
    'Не включай семьи с одним товаром или уверенностью ниже 0.9. При сомнении не объединяй.',
    'Верни строго JSON вида {"families":[{"label":"","variants":[{"product_index":1,"color":"Графитовый","base_color":"Серый","duplicate_of_index":null,"confidence":0.95}],"matching_evidence":"","confidence":0.95}]}.',
    `Кандидаты: ${JSON.stringify(candidates)}`,
  ].join('\n\n')
}

export function buildBatchAiColorSplitPrompt(input: {
  product: any
  supplierInstructions?: string | null
  brands: BatchAiLookup[]
  categories: BatchAiLookup[]
  subcategories: BatchAiLookup[]
  attributes: BatchAiAttributeDefinition[]
  priceRules?: BatchAiPriceRuleHint[]
  priceAiInstructions?: string | null
  chromoffMode?: boolean
  chromoffCategories?: BatchAiChromoffCategory[]
  processingOptions?: BatchAiProcessingOptions
  allowSingleVariant?: boolean
  videoPreviewAvailable?: boolean
}) {
  const { product, supplierInstructions, brands, categories, subcategories, attributes, priceRules = [], priceAiInstructions, chromoffMode = false, chromoffCategories = [], processingOptions = DEFAULT_BATCH_AI_PROCESSING_OPTIONS, allowSingleVariant = false, videoPreviewAvailable = false } = input
  return [
    'Один исходный альбом содержит несколько отдельно продаваемых цветовых вариантов одной физической модели.',
    'За один ответ раздели фотографии по цветам и полностью обработай каждый получившийся товар. Второго AI-прохода не будет.',
    'Не разделяй один многоцветный дизайн. Создай варианты только когда на фотографиях показаны отдельные экземпляры одной модели разных цветов.',
    'Каждый номер фотографии разрешено включить максимум в один вариант. Общие кадры, где одновременно показаны разные цвета, рекламные кадры и таблицы не включай ни в один вариант.',
    `Нужно вернуть от ${allowSingleVariant ? '1' : '2'} до 8 вариантов. Для каждого варианта обязательно укажи непустой уникальный color_key на русском и минимум одну фотографию.${allowSingleVariant ? ' Если отдельные цвета не найдены, верни один обычный вариант со всеми информативными фотографиями.' : ''}`,
    ...(processingOptions.skipModelOnlyAlbum ? [
      'Если весь альбом состоит только из фотографий моделей/людей и сам товар не имеет товарной ценности, верни skip_product=true и пустой variants. Если товар есть хотя бы на одном информативном кадре, skip_product=false.',
    ] : []),
    ...(processingOptions.reorderFirstPhoto ? [
      'Для каждого варианта укажи cover_photo_index — исходный номер лучшего продающего кадра из его photo_indexes. Разрешено менять только первое фото варианта.',
    ] : []),
    ...(processingOptions.colorFamilyByArticle ? [
      `При определении общей семьи используй пример артикула «${processingOptions.articleExample || 'SP001 blue'}»: SP001 blue и SP001 green имеют общую основу SP001, цвет не включай в family_name/group_signature.`,
    ] : []),
    ...(videoPreviewAvailable ? [
      'После contact sheet приложен отдельный кадр-превью исходного видео. Он не является фотографией товара, не включай его в photo_indexes. Верни video_color_key: точный color_key одного варианта, если по этому кадру цвет виден однозначно; иначе пустую строку. Если на видео несколько цветов, тоже верни пустую строку.',
    ] : []),
    'У каждого варианта должно быть собственное name без бренда, но с его точным цветом; например, «Чёрная сумка 22 Mini» и «Белая сумка 22 Mini». color_key и attributes.colors дублируют цвет как структурированные данные. family_name содержит общую основу без бренда и цвета. Каждый product должен содержать название, описание, классификацию, пол, атрибуты, ценовое правило и confidence. H1 и SEO не возвращай: сервер и Rails формируют их после сохранения.',
    'Верни строго JSON без markdown следующей формы:',
    JSON.stringify({
      family_name: '',
      video_color_key: '',
      skip_product: false,
      variants: [{
        color_key: '',
        photo_indexes: [],
        product: {
          name: '', description: '',
          brand: 'existing-id-or-empty', category: 'existing-id', subcategory: 'existing-id-or-original',
          gender: 'male|female|unisex|null', catalog_attributes: {}, price_rule_key: '', price: null, confidence: 0,
        },
        chromoff_category: chromoffMode ? { id: 'existing-chromoff-category-id-or-empty', confidence: 0, reason: '' } : null,
        photo_alts: [],
        cover_photo_index: null,
        media: { discard_indexes: [], size_chart_indexes: [] },
      }],
    }),
    'photo_indexes и номера фотографий начинаются с 1 и подписаны на contact sheet. photo_alts верни в том же порядке и количестве, что photo_indexes.',
    `Особенности поставщика: ${supplierInstructions || 'нет'}`,
    `Исходный товар: ${JSON.stringify(product)}`,
    `Бренды: ${JSON.stringify(brands)}`,
    `Категории: ${JSON.stringify(categories)}`,
    `Подкатегории: ${JSON.stringify(subcategories)}`,
    ...(chromoffMode ? [
      'Это режим Chromoff для поставщика из списка Chromoff. Выбери chromoff_category только из отдельного справочника ниже. Не заменяй её общей категорией YeezyUnique.',
      'Выбирай наиболее конкретную подкатегорию из справочника; родительскую категорию выбирай только если у неё нет подходящей дочерней категории.',
      'Если товар нельзя уверенно отнести к одной категории Chromoff, верни пустой id и confidence ниже 0.75. Товар останется скрытым для ручной проверки.',
      `Категории Chromoff: ${JSON.stringify(chromoffCategories)}`,
    ] : []),
    `Схема атрибутов: ${JSON.stringify(attributes)}`,
    `Ценовые правила поставщика: ${JSON.stringify(priceRules)}`,
    `Общая инструкция поставщика по ценам: ${priceAiInstructions || 'нет'}`,
    'Если заполнена общая инструкция поставщика по ценам, верни в каждом product.price только явно указанную этой инструкцией цену для текущего варианта; иначе оставь product.price равным null. Не помещай цену в тексты товаров.',
  ].join('\n\n')
}

export function buildBatchAiShadePrompt(
  products: any[],
  familyDefinition = buildBatchAiFamilyDefinition('internal_code'),
) {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    id: product.id,
    external_id: product.external_id || '',
    model_code: product.attributes?.model_code || '',
    current_color: product.attributes?.colors || [],
    name: product.name,
  }))
  return [
    `Определение семейства: ${JSON.stringify(familyDefinition)}`,
    'Это один товар с одинаковым внутренним артикулом. Сравни только его цветовые варианты по первым фотографиям.',
    'Номер товара совпадает с номером фотографии на contact sheet.',
    'Поле color — публичное точное название конкретного оттенка и обязано быть уникальным для каждого НЕ дубля. Нельзя повторять «Серый», «Белый», «Чёрный» или другое общее слово у визуально разных товаров.',
    'Если два товара имеют одинаковое общее название цвета, но визуально отличаются оттенком, сохрани оба и дай им разные точные русские названия: например «Светло-серый», «Серый», «Графитовый»; «Белый», «Молочный», «Айвори»; «Синий», «Темно-синий», «Чернильно-синий»; «Бежевый», «Песочный», «Тауп»; «Коричневый», «Шоколадный».',
    'Для обуви учитывай реальный подтон и светлоту: холодный/тёплый, серо-синий/фиолетово-синий, молочно-белый/чисто-белый, серо-бежевый/песочный. Не придумывай оттенок, если различие не видно.',
    'base_color — общий цвет для фильтра каталога: «Серый», «Бежевый», «Синий» и т. п.',
    'duplicate_of_index указывай только если фотографии показывают визуально одинаковую пару или один и тот же снимок повторно. Разные оттенки дублями не являются.',
    'Если различие оттенков неуверенное, оставь duplicate_of_index пустым и дай разные осторожные описательные названия: система покажет их человеку. Никогда не объявляй товар дублем только из-за одинакового общего цвета.',
    'Верни каждый переданный товар ровно один раз.',
    'Верни строго JSON вида {"variants":[{"product_index":1,"color":"Графитовый","base_color":"Серый","duplicate_of_index":null,"confidence":0.95}]}.',
    `Товары: ${JSON.stringify(candidates)}`,
  ].join('\n\n')
}

export function buildBatchAiShadeRepairPrompt(products: any[], variants: any[]) {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    id: product.id,
    external_id: product.external_id || '',
    model_code: product.attributes?.model_code || '',
    current_color: product.attributes?.colors || [],
    preliminary_color: variants.find((variant) => Number(variant.product?.id) === Number(product.id))?.color || '',
  }))
  return [
    'Это автоматическое уточнение цветовой семьи обуви. Пользователь не будет переименовывать товары вручную.',
    'Снова сравни все пары на contact sheet. Предварительный ответ мог дать одинаковые общие слова, например «Серый», «Синий», «Белый».',
    'Для визуально разных НЕ дублей обязательно придумай разные короткие естественные русские названия оттенков: учитывай светлоту и подтон. Используй «Светло-серый», «Серый», «Графитовый»; «Синий», «Темно-синий», «Чернильно-синий»; «Белый», «Молочный», «Айвори»; «Бежевый», «Песочный», «Тауп».',
    'Не используй номера, слова «вариант», «оттенок 1» и не оставляй одинаковые color у визуально разных товаров.',
    'duplicate_of_index указывай только для визуально одинаковой пары или повторной публикации одного цвета. Разные оттенки дублями не являются.',
    'Верни каждый товар ровно один раз, сохрани product_index и верни строго JSON вида {"variants":[{"product_index":1,"color":"Графитовый","base_color":"Серый","duplicate_of_index":null,"confidence":0.95}]}.',
    `Товары и предварительные названия: ${JSON.stringify(candidates)}`,
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
  modelReferenceSheets?: string[]
  extraImages?: Array<{ label: string; url: string; detail?: 'low' | 'high' | 'auto' }>
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
  ;(input.modelReferenceSheets || []).forEach((url, index) => {
    content.push({ type: 'text', text: `Эталоны моделей Chanel ${index + 1}. Это отдельный лист справочника, не фотографии текущего товара.` })
    content.push({ type: 'image_url', image_url: { url } })
  })
  ;(input.extraImages || []).forEach((image) => {
    if (!image?.url) return
    content.push({ type: 'text', text: image.label })
    content.push({ type: 'image_url', image_url: { url: image.url, ...(image.detail ? { detail: image.detail } : {}) } })
  })
  const protocol = providerProtocol(input.settings.providerBaseUrl || '')
  const model = input.settings.provider === 'byesu' ? input.settings.byesuModel : input.settings.openrouterModel
  const completion = input.settings.provider === 'byesu'
    ? (body: Record<string, any>) => byesuChatCompletion(body, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      })
    : (body: Record<string, any>) => openRouterChatCompletion(body, {}, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      })
  const payload = protocol === 'anthropic'
    ? await withBatchAiRetry(() => anthropicMessagesCompletion({
        model,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: toAnthropicContent(content) }],
        temperature: input.settings.temperature,
        max_tokens: input.settings.maxTokens,
      }, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      }), 'AI batch')
    : await withBatchAiRetry(() => completion({
        model,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content },
        ],
        temperature: input.settings.temperature,
        max_tokens: input.settings.maxTokens,
        response_format: { type: 'json_object' },
      }), 'AI batch')
  const text = protocol === 'anthropic'
    ? anthropicResponseText(payload)
    : aiMessageContentText(payload?.choices?.[0]?.message?.content)
  if (!text) throw new Error('ИИ вернул пустой ответ')
  return parseBatchAiJson(text)
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
  const protocol = providerProtocol(input.settings.providerBaseUrl || '')
  const model = input.settings.provider === 'byesu' ? input.settings.byesuModel : input.settings.openrouterModel
  const completion = input.settings.provider === 'byesu'
    ? (body: Record<string, any>) => byesuChatCompletion(body, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      })
    : (body: Record<string, any>) => openRouterChatCompletion(body, {}, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      })
  const payload = protocol === 'anthropic'
    ? await withBatchAiRetry(() => anthropicMessagesCompletion({
        model,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: toAnthropicContent(content) }],
        temperature: input.settings.temperature,
        max_tokens: input.settings.maxTokens,
      }, {
        baseUrl: input.settings.providerBaseUrl,
        apiKey: input.settings.providerApiKey,
      }), 'AI refinement')
    : await withBatchAiRetry(() => completion({
        model,
        messages: [{ role: 'system', content: input.systemPrompt }, { role: 'user', content }],
        temperature: input.settings.temperature,
        max_tokens: input.settings.maxTokens,
        response_format: { type: 'json_object' },
      }), 'AI refinement')
  const text = protocol === 'anthropic'
    ? anthropicResponseText(payload)
    : aiMessageContentText(payload?.choices?.[0]?.message?.content)
  if (!text) throw new Error('ИИ вернул пустой ответ при уточнении оригинала')
  return parseBatchAiJson(text)
}

async function withBatchAiRetry<T>(operation: () => Promise<T>, label: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const message = String((error as Error)?.message || error || '').toLowerCase()
      const retryable = /temporarily unavailable|rate limit|retry later|upstream|\b429\b|\b5\d\d\b|timeout|timed out|econn|socket|fetch failed|connection/.test(message)
      if (!retryable || attempt === 5) throw error
      const waitMs = Math.min(30_000, 1_000 * (2 ** (attempt - 1)))
      console.warn(`${label}: временная ошибка, повтор ${attempt + 1}/5 через ${waitMs} мс: ${message}`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  throw lastError
}

function aiMessageContentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const item = part as Record<string, unknown>
      return typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : ''
    }).join('')
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (typeof item.text === 'string') return item.text
    if (typeof item.content === 'string') return item.content
  }
  return ''
}

function balancedJsonFragment(text: string, start: number): string | null {
  const opening = text[start]
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : ''
  if (!closing) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === opening) depth += 1
    else if (character === closing) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function repairJsonText(value: string): string {
  const normalized = value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  let result = ''
  let inString = false
  let escaped = false
  for (const character of normalized) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      else if (character === '\n') {
        result += '\\n'
        continue
      } else if (character === '\r') {
        result += '\\r'
        continue
      } else if (character === '\t') {
        result += '\\t'
        continue
      }
    } else if (character === '"') {
      inString = true
    }
    result += character
  }
  return result.replace(/,\s*([}\]])/g, '$1')
}

export function parseBatchAiJson(text: string) {
  const clean = String(text || '').trim()
  const fenced = [...clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim())
  const sources = [...fenced, clean]
  const candidates = new Set<string>()

  for (const source of sources) {
    if (source) candidates.add(source)
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== '{' && source[index] !== '[') continue
      const fragment = balancedJsonFragment(source, index)
      if (fragment) candidates.add(fragment)
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      try {
        return JSON.parse(repairJsonText(candidate))
      } catch {
        // Provider/model wrappers may prepend or append explanatory text.
      }
    }
  }

  throw new Error('ИИ вернул невалидный JSON')
}

function nameWithoutLeadingBrand(value: string, brand?: string) {
  const name = String(value || '').trim()
  const brandName = String(brand || '').trim()
  if (!name || !brandName) return name

  const escapedBrand = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return name.replace(new RegExp(`^${escapedBrand}[\\s\\-–—_:,]*`, 'iu'), '').trim() || name
}

type ParsedDimensions = { width: number; height: number; depth?: number; value: string }

function dimensionNumber(value: string) {
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) && number > 0 && number <= 300 ? number : null
}

function displayDimension(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}

function explicitDimensions(values: unknown[]): ParsedDimensions | null {
  for (const value of values) {
    const text = String(value || '')
    // Без слова «размер»/«尺寸» сохраняем только габариты с единицей измерения:
    // это не позволяет принять номер модели вроде CF25 за габарит.
    const match = text.match(/(?:(?:размер(?:ы)?|габариты|dimensions?|尺寸)\s*[:：]?\s*)?(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх×*]\s*(\d+(?:[.,]\d+)?))?(?:\s*(?:см|cm))?/iu)
    if (!match) continue
    const labelled = /(размер(?:ы)?|габариты|dimensions?|尺寸)/iu.test(text.slice(0, match.index! + match[0].length))
    const hasUnit = /(?:см|cm)\b/iu.test(match[0])
    if (!labelled && !hasUnit) continue
    const width = dimensionNumber(match[1])
    const height = dimensionNumber(match[2])
    const depth = match[3] ? dimensionNumber(match[3]) : undefined
    if (width === null || height === null || depth === null) continue
    return {
      width,
      height,
      depth,
      value: `${displayDimension(width)} × ${displayDimension(height)}${depth === undefined ? '' : ` × ${displayDimension(depth)}`} см`,
    }
  }
  return null
}

function hardwareColorFromConfirmedText(values: unknown[]) {
  const text = values.map((value) => String(value || '')).join('\n').toLowerCase()
  const hasHardwareContext = /(фурнитур|замок|цепочк|металл|五金|金扣|银扣|链条|(?:米白|黑|红|粉|蓝|绿|棕)金(?:扣)?)/iu.test(text)
  if (!hasHardwareContext) return ''
  if (/(паллади|palladium)/iu.test(text)) return 'Палладиевая'
  if (/(розов(?:ое|ая) золот|rose gold)/iu.test(text)) return 'Розовое золото'
  if (/(графит|gunmetal)/iu.test(text)) return 'Графитовая'
  if (/(бронз|bronze)/iu.test(text)) return 'Бронзовая'
  if (/(золотист|золот(?:ая|ое)|浅金|金色五金|金扣|(?:米白|黑|红|粉|蓝|绿|棕)金(?:扣)?|gold(?:-tone)? hardware)/iu.test(text)) return 'Золотистая'
  if (/(серебрист|серебр(?:яная|ое)|银扣|银色五金|silver(?:-tone)? hardware)/iu.test(text)) return 'Серебристая'
  if (/(чёрн(?:ая|ое) фурнитур|черн(?:ая|ое) фурнитур|black hardware)/iu.test(text)) return 'Чёрная'
  return ''
}

function nominalBagSize(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  const size = values
    .map((item) => String(item || '').trim())
    .find((item) => /^(?:1[7-9]|2[0-9]|3[0-2])$/u.test(item))
  return size || ''
}

function appendNominalBagSize(name: string, size: string) {
  if (!name || !size || new RegExp(`(?:^|\\D)${size}(?:\\D|$)`, 'u').test(name)) return name
  return `${name} ${size}`.trim()
}

export function normalizeBatchAiOutput(raw: any, input: {
  product: any
  brandIds: Set<string>
  brandNames?: Map<string, string>
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
  priceAiInstructions?: string | null
  modelReferences?: BatchAiModelReference[]
  chromoffMode?: boolean
  chromoffCategories?: BatchAiChromoffCategory[]
  processingOptions?: BatchAiProcessingOptions
}) {
  const processingOptions = normalizeBatchAiProcessingOptions(input.processingOptions)
  const proposed = raw?.product || {}
  const original = input.product
  const supplierPublishedOn = normalizeSupplierPublishedOn(original.supplier_published_on)
    || supplierPublishedOnFromAttributes(original.attributes)
    || null
  const choose = (value: unknown, allowed: Set<string>, fallback: unknown) => {
    const candidate = String(value || '')
    if (allowed.has(candidate)) return candidate
    const previous = String(fallback || '')
    return allowed.has(previous) ? previous : ''
  }
  const attributes: Record<string, unknown> = {}
  for (const [code, value] of Object.entries(original.attributes || {})) {
    const canonicalCode = canonicalBatchSuggestionKey(code, 'attribute')
    if (
      input.attributeCodes.has(canonicalCode)
      || canonicalCode.startsWith('chromoff_')
      || canonicalCode.startsWith('szwego_')
      || canonicalCode.startsWith('hosted_video_')
      || canonicalCode.startsWith('manual_video_')
      || canonicalCode === 'video_transfer_error'
      || canonicalCode === 'video_url'
      || canonicalCode === 'video_poster_url'
      || canonicalCode === 'source_parent_external_id'
    ) attributes[canonicalCode] = value
  }
  const resolvedBrand = choose(proposed.brand, input.brandIds, original.brand)
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
    } else if (processingOptions.suggestAttributes && !input.knownAttributeCodes?.has(code)) {
      suggestions.push({ ...suggestion, code: code || suggestion?.code })
    }
  }
  for (const [code, value] of Object.entries(proposed.catalog_attributes || {})) {
    const canonicalCode = canonicalBatchSuggestionKey(code, 'attribute')
    if (canonicalCode === 'model_reference_key') continue
    if (canonicalCode === 'materials') attributes[canonicalCode] = normalizeMaterials(resolveDictionaryValue(canonicalCode, value))
    else if (input.attributeCodes.has(canonicalCode)) attributes[canonicalCode] = resolveDictionaryValue(canonicalCode, value)
    else if (processingOptions.suggestAttributes && !input.knownAttributeCodes?.has(canonicalCode)) {
      suggestions.push({ code: canonicalCode || code, label: code, value, reason: 'Новый код из результата AI' })
    }
  }
  if (attributes.materials !== undefined) attributes.materials = normalizeMaterials(attributes.materials)
  const normalizedProductMeasurements = attributes.measurements !== undefined
    ? normalizeProductMeasurements(attributes.measurements)
    : null
  if (attributes.measurements !== undefined) {
    const normalizedMeasurements = normalizeMeasurementTable(attributes.measurements)
    attributes.measurements = normalizeMeasurementRowSizes(normalizedMeasurements || attributes.measurements)
  }
  if (input.attributeCodes.has('sizes')) {
    const sizeSourceText = [original.description, proposed.description].filter(Boolean).join('\n')
    const categoryId = [proposed.category, original.category]
      .map((value) => String(value || ''))
      .find((value) => input.categoryIds.has(value)) || ''
    const isClothing = String(input.categoryNames?.get(categoryId) || '')
      .trim().toLowerCase().replace(/ё/g, 'е') === 'одежда'
    const isShoe = String(input.categoryNames?.get(categoryId) || '')
      .trim().toLowerCase().replace(/ё/g, 'е') === 'обувь'
    const shoeSizeGroups = isShoe ? extractShoeSizeGroups(attributes.sizes) : []
    const sizeValues = [
      ...extractExplicitClothingSizes(sizeSourceText),
      ...(isClothing ? extractExplicitNumericClothingSizes(sizeSourceText) : []),
      ...attributeSizeValues(attributes.sizes),
      ...measurementRowSizes(attributes.measurements),
    ].map(canonicalClothingSize).filter(Boolean)
    if (sizeValues.length > 0) {
      const normalizedSizes = [...new Set(sizeValues)]
      attributes.sizes = shoeSizeGroups.length
        ? {
            values: normalizedSizes,
            groups: shoeSizeGroups.map((group) => ({
              ...group,
              values: group.values.map(canonicalClothingSize),
            })),
          }
        : normalizedSizes
    }
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
  if (input.attributeCodes.has('sizes')) {
    const explicit = extractExplicitShoeAttributes([
      original.name,
      original.description,
      proposed.name,
      proposed.description,
      proposed.h1,
      proposed.seo_description,
    ].filter(Boolean).join('\n'))
    if (Array.isArray(explicit.sizes) && explicit.sizes.length > 0) {
      // Explicit source sizes are more reliable than an empty, partial or
      // hallucinated AI attribute. This also recovers Chinese labels such as
      // 码数：38-46 with notes after the range.
      attributes.sizes = explicit.sizes
    }
    if (!attributes.size_system && explicit.size_system && input.attributeCodes.has('size_system')) {
      attributes.size_system = explicit.size_system
    }
  }
  const rawDiscard = new Set<number>((raw?.media?.discard_indexes || []).map(Number).filter((value: number) => value > 0))
  const rawSizeCharts = new Set<number>((raw?.media?.size_chart_indexes || []).map(Number).filter((value: number) => value > 0))
  // Never lose the only evidence needed for manual recovery. A chart may be
  // excluded from the public gallery only after a valid structured table was
  // actually normalized from the AI response.
  const sizeCharts = normalizedProductMeasurements ? rawSizeCharts : new Set<number>()
  const discard = normalizedProductMeasurements
    ? rawDiscard
    : new Set([...rawDiscard].filter((index) => !rawSizeCharts.has(index)))
  const originalPhotos = Array.isArray(original.photos) ? original.photos : []
  const retainedIndexes = originalPhotos
    .map((_: string, index: number) => index + 1)
    .filter((index: number) => !discard.has(index) && !sizeCharts.has(index))
  let photos = retainedIndexes.map((index: number) => originalPhotos[index - 1])
  let photoAlts = normalizeRetainedPhotoAlts(
    raw?.photo_alts || proposed.photo_alts,
    originalPhotos.length,
    discard,
    sizeCharts,
    String(proposed.name || original.name || '').trim(),
  )
  const rawProcessing = raw?.ai_processing && typeof raw.ai_processing === 'object' ? raw.ai_processing : {}
  const requestedCoverIndex = Number(rawProcessing.cover_photo_index)
  const coverPosition = processingOptions.reorderFirstPhoto
    ? retainedIndexes.indexOf(requestedCoverIndex)
    : -1
  if (coverPosition > 0) {
    const [coverPhoto] = photos.splice(coverPosition, 1)
    photos.unshift(coverPhoto)
    const [coverAlt] = photoAlts.splice(coverPosition, 1)
    photoAlts.unshift(coverAlt)
  }
  const requestedModelReferenceKey = String(proposed.catalog_attributes?.model_reference_key || '').trim()
  const matchedModelReference = (input.modelReferences || []).find((reference) => reference.model_key === requestedModelReferenceKey)
  if (matchedModelReference) {
    attributes.model_name = matchedModelReference.model_name
  }
  let subcategory = choose(proposed.subcategory, input.subcategoryIds, original.subcategory)
  const proposedCategory = choose(proposed.category, input.categoryIds, original.category)
  const parentCategory = subcategory ? input.subcategoryParents?.get(subcategory) : undefined
  const category = parentCategory && input.categoryIds.has(parentCategory) ? parentCategory : proposedCategory
  const normalizedName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/ё/g, 'е')
  const categoryAndSubcategoryName = [
    input.categoryNames?.get(category),
    input.subcategoryNames?.get(subcategory),
  ].map(normalizedName).join(' ')

  const chromoffCategoryOptions = input.chromoffCategories || []
  const chromoffCategoryById = new Map(chromoffCategoryOptions.map((item) => [String(item.id), item]))
  const rawChromoffCategory = raw?.chromoff_category && typeof raw.chromoff_category === 'object'
    ? raw.chromoff_category
    : {}
  const chromoffCategoryId = chromoffCategoryById.has(String(rawChromoffCategory.id || ''))
    ? String(rawChromoffCategory.id)
    : ''
  const chromoffConfidenceValue = Number(rawChromoffCategory.confidence)
  const chromoffConfidence = Number.isFinite(chromoffConfidenceValue)
    ? Math.max(0, Math.min(1, chromoffConfidenceValue > 1 && chromoffConfidenceValue <= 100 ? chromoffConfidenceValue / 100 : chromoffConfidenceValue))
    : 0
  const chromoffCategory = input.chromoffMode
    ? {
        id: chromoffCategoryId,
        name: chromoffCategoryById.get(chromoffCategoryId)?.name || '',
        confidence: chromoffConfidence,
        reason: String(rawChromoffCategory.reason || '').trim().slice(0, 500),
        status: chromoffCategoryId && chromoffConfidence >= 0.75 ? 'ai_assigned' : 'needs_review',
      }
    : null
  if (input.chromoffMode) {
    attributes.chromoff_category_id = chromoffCategory?.id || ''
    attributes.chromoff_category_name = chromoffCategory?.name || ''
    attributes.chromoff_category_confidence = chromoffCategory?.confidence || 0
    attributes.chromoff_category_status = chromoffCategory?.status || 'needs_review'
    attributes.chromoff_category_reason = chromoffCategory?.reason || ''
  }
  if (attributes.stones !== undefined && !/(ювелир|бижутер)/i.test(categoryAndSubcategoryName)) {
    delete attributes.stones
    for (let index = suggestions.length - 1; index >= 0; index -= 1) {
      if (canonicalBatchSuggestionKey(suggestions[index]?.code || suggestions[index]?.label, 'attribute') === 'stones') {
        suggestions.splice(index, 1)
      }
    }
  }
  const categoryName = normalizedName(input.categoryNames?.get(category))
  const canWriteAttribute = (code: string) => (
    input.attributeCodes.has(code) || input.knownAttributeCodes?.has(code) === true
  )
  const dimensions = explicitDimensions([
    attributes.dimensions,
    proposed.catalog_attributes?.dimensions,
    original.description,
    proposed.description,
  ])
  if (['сумки', 'аксессуары'].includes(categoryName) && dimensions && canWriteAttribute('dimensions')) {
    attributes.dimensions = dimensions.value
  }

  if (categoryName === 'сумки') {
    // Сырые товары нередко поступают без категории, поэтому их initial schema
    // содержит только общие поля. После того как AI выбрал «Сумки», разрешаем
    // зарегистрированные bag-поля из ответа — иначе они безвозвратно теряются
    // до детерминированного разбора габаритов и подбора цены.
    const bagAttributeCodes = ['dimensions', 'bag_width_cm', 'bag_height_cm', 'size_class', 'strap_length', 'capacity', 'hardware_color']
    const canWriteBagAttribute = canWriteAttribute
    for (const code of bagAttributeCodes) {
      if (!canWriteBagAttribute(code) || attributes[code] !== undefined) continue
      const value = proposed.catalog_attributes?.[code]
      if (value !== undefined && value !== null) attributes[code] = resolveDictionaryValue(code, value)
    }

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
      'сумки с верхней ручкой', 'сумка с верхней ручкой',
      'сумки с ручкой', 'сумка с ручкой',
    ].includes(selectedName) && shoulderBags) {
      subcategory = shoulderBags[0]
    }
    if (!subcategory || normalizedName(input.subcategoryNames?.get(subcategory)) === 'сумки') {
      throw new Error('Для категории «Сумки» требуется конкретная подкатегория вместо «Сумки»')
    }

    if (dimensions) {
      if (canWriteBagAttribute('dimensions')) attributes.dimensions = dimensions.value
      if (canWriteBagAttribute('bag_width_cm') && !attributes.bag_width_cm) attributes.bag_width_cm = dimensions.width
      if (canWriteBagAttribute('bag_height_cm') && !attributes.bag_height_cm) attributes.bag_height_cm = dimensions.height
    }

    if (canWriteBagAttribute('hardware_color') && !attributes.hardware_color) {
      const hardwareColor = hardwareColorFromConfirmedText([
        original.description,
        proposed.description,
        ...Object.values(proposed.catalog_attributes || {}),
      ])
      if (hardwareColor) attributes.hardware_color = hardwareColor
    }
  }

  let subcategorySuggestion = typeof raw?.subcategory_suggestion === 'string'
    ? { name: raw.subcategory_suggestion }
    : raw?.subcategory_suggestion || null
  if (normalizedName(input.categoryNames?.get(category)) === 'одежда') {
    const currentClothingSubcategoryIsLegacy = isLegacyClothingSubcategory(input.subcategoryNames?.get(subcategory))
    const inferredAiName = [proposed.name, proposed.h1]
      .map(inferClothingSubcategoryName)
      .find(Boolean)
      || inferClothingSubcategoryName([
        proposed.description,
        proposed.seo_title,
        proposed.seo_description,
      ].filter(Boolean).join('\n'))
    const inferredSourceName = inferClothingSubcategoryName(original.name)
      || inferClothingSubcategoryName(original.description)
    // The model's generated name/description are its visual interpretation of
    // the complete photo series. Prefer that evidence over a contradictory ID
    // (for example, a jacket returned with the pants ID). Fall back to source
    // text only when the generated fields do not identify a garment type.
    const canonicalName = inferredAiName
      || inferredSourceName
      || canonicalClothingSubcategoryName(subcategorySuggestion?.name)
      || (currentClothingSubcategoryIsLegacy ? '' : canonicalClothingSubcategoryName(input.subcategoryNames?.get(subcategory)))
    const canonicalEntry = canonicalName
      ? [...(input.subcategoryNames?.entries() || [])].find(([id, name]) => (
        canonicalClothingSubcategoryName(name) === canonicalName
        && (!input.subcategoryParents?.get(id) || input.subcategoryParents.get(id) === category)
      ))
      : undefined
    if (canonicalEntry) {
      subcategory = canonicalEntry[0]
    } else if (currentClothingSubcategoryIsLegacy) {
      subcategory = ''
    }
    // Таксономия одежды закрыта: известные синонимы нормализованы выше,
    // неизвестные типы остаются без подкатегории для ручной классификации.
    subcategorySuggestion = null
  }
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
    const shoeConstructionText = [
      original.name,
      original.description,
      proposed.name,
      proposed.description,
      proposed.h1,
      proposed.seo_title,
      proposed.catalog_attributes?.model_name,
    ].filter(Boolean).join(' ')
    const slingbackName = inferShoeSlingbackSubcategoryName(shoeConstructionText)
    if (slingbackName) canonicalName = slingbackName

    const explicitlyMules = /(мюл(?:и|ей|ям|ями|ях)?|\bmules?\b|穆勒鞋)/i.test(proposedShoeText)
    if (!slingbackName && explicitlyMules && ['Туфли на каблуке', 'Туфли на плоской подошве'].includes(canonicalName)) {
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
    if (processingOptions.suggestSubcategories && subcategorySuggestion && !canonicalFromSuggestion) {
      throw new Error('Для категории «Обувь» нельзя создавать новую подкатегорию: выберите существующий тип конструкции')
    }
  }

  const rawConfidence = Number(proposed.confidence || 0)
  const normalizedConfidence = rawConfidence > 1 && rawConfidence <= 100
    ? rawConfidence / 100
    : rawConfidence

  const isShoeCategory = normalizedName(input.categoryNames?.get(category)) === 'обувь'
  const aiGender = ['male', 'female', 'unisex'].includes(String(proposed.gender))
    ? String(proposed.gender)
    : ''
  const genderEvidenceText = [
    original.name,
    original.description,
    proposed.name,
    proposed.description,
    proposed.h1,
    proposed.seo_description,
  ].filter(Boolean).join('\n')
  const explicitGender = isShoeCategory ? inferExplicitShoeGender(genderEvidenceText) : null
  const sizeFallbackGender = isShoeCategory ? inferShoeGender(genderEvidenceText, attributes.sizes) : null
  const resolvedGender = isShoeCategory
    ? (explicitGender || aiGender || sizeFallbackGender || original.gender)
    : (aiGender || original.gender)

  const rawColorFamily = raw?.color_family && typeof raw.color_family === 'object'
    ? { ...raw.color_family }
    : null
  const articleKey = String(rawProcessing.article_key || '').trim().slice(0, 250)
  if (processingOptions.colorFamilyByArticle && rawColorFamily && articleKey) {
    rawColorFamily.group_signature = articleKey
  }
  let productName = nameWithoutLeadingBrand(
    String(proposed.name || original.name || ''),
    input.brandNames?.get(resolvedBrand),
  )
  if (normalizedName(input.categoryNames?.get(category)) === 'сумки') {
    const size = nominalBagSize(attributes.sizes)
    if (size) {
      productName = appendNominalBagSize(productName, size)
      delete attributes.sizes
    }
  }
  const proposedPrice = String(input.priceAiInstructions || '').trim() && Number.isFinite(Number(proposed.price)) && Number(proposed.price) >= 0
    ? Math.round(Number(proposed.price))
    : null
  return {
    product: {
      ...original,
      supplier_published_on: supplierPublishedOn,
      name: productName.slice(0, 250),
      description: String(proposed.description || original.description || '').trim().slice(0, 8000),
      // H1 всегда повторяет видимое имя; SEO-поля создаёт Rails из фактов товара.
      h1: productName.slice(0, 250),
      seo_title: '',
      seo_description: '',
      brand: resolvedBrand,
      category,
      subcategory,
      gender: resolvedGender,
      ...(proposedPrice !== null ? { price: proposedPrice, price_source: 'ai_instruction' } : {}),
      photos: photos.length > 0 ? photos : original.photos,
      photo_alts: photoAlts,
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
      variant_group_name: original.variant_group_name || null,
    },
    suggestions,
    subcategorySuggestion: null,
    colorFamily: rawColorFamily,
    chromoffCategory,
    mediaDecision: { discard: [...discard], sizeCharts: [...sizeCharts] },
    skipProduct: processingOptions.skipModelOnlyAlbum && rawProcessing.skip_product === true,
    coverPhotoIndex: coverPosition >= 0 ? requestedCoverIndex : null,
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

function extractShoeSizeGroups(value: unknown): Array<Record<string, unknown> & { values: string[] }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const groups = (value as Record<string, unknown>).groups
  if (!Array.isArray(groups)) return []
  return groups.flatMap((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return []
    const source = group as Record<string, unknown>
    const values = attributeSizeValues(source.values)
      .map(canonicalClothingSize)
      .filter(Boolean)
    if (values.length === 0) return []
    const audience = String(source.audience || '').trim().toLowerCase()
    return [{
      ...(Number.isFinite(Number(source.min)) ? { min: Number(source.min) } : {}),
      ...(Number.isFinite(Number(source.max)) ? { max: Number(source.max) } : {}),
      ...(source.system ? { system: String(source.system).toUpperCase() } : {}),
      ...(['male', 'female', 'unisex'].includes(audience) ? { audience } : {}),
      values,
    }]
  })
}

function measurementRowSizes(value: unknown): string[] {
  return productMeasurementSizes(value)
}

function normalizeMeasurementRowSizes(value: unknown) {
  const normalized = normalizeProductMeasurements(value)
  if (!normalized) return value
  if ('tabs' in normalized) {
    return {
      tabs: normalized.tabs.map(({ label, ...table }) => ({
        label,
        ...normalizeSingleMeasurementRowSizes(table),
      })),
    }
  }
  return normalizeSingleMeasurementRowSizes(normalized)
}

function normalizeSingleMeasurementRowSizes(table: MeasurementTable) {
  const rows = table.rows.map((row) => ({ ...row, size: canonicalClothingSize(row.size) }))
  const columns = table.columns.filter((column) => {
      const key = column.key.trim().toLowerCase()
      const label = column.label.trim().toLowerCase().replace(/ё/g, 'е')
      const isSizeColumn = key === 'size' || key === 'sizes' || label === 'размер' || label === 'размеры' || label === 'size' || label === 'sizes'
      if (!isSizeColumn) return true
      return rows.some((row) => String(row.values[column.key] ?? '').trim() !== '')
    })
  const columnKeys = new Set(columns.map((column) => column.key))
  const cleanedRows = rows.map((row) => ({
    ...row,
    values: Object.fromEntries(Object.entries(row.values).filter(([key]) => columnKeys.has(key))),
  }))
  return {
    ...table,
    columns,
    rows: cleanedRows,
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

type PriceRuleCatalogMapping = {
  entity_type: string
  legacy_id?: string | null
  canonical_id?: string | null
  name?: string | null
}

function normalizePriceRuleCatalogValue(value: unknown, entityType: 'brand' | 'category' | 'subcategory', mappings: PriceRuleCatalogMapping[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePriceRuleCatalogValue(item, entityType, mappings))
  }
  const raw = String(value || '').trim()
  if (!raw) return value
  const normalized = raw.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ')
  const mapping = mappings.find((item) => item.entity_type === entityType && (
    String(item.legacy_id || '') === raw
    || String(item.canonical_id || '') === raw
    || String(item.name || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ') === normalized
  ))
  return mapping?.canonical_id ? String(mapping.canonical_id) : value
}

/**
 * Price rules are configured through Rails catalog IDs, while old suppliers
 * may still contain legacy IDs or human-readable names. Resolve all catalog
 * conditions to the current canonical ID before matching a product.
 */
export function normalizePriceRulesCatalogReferences<T extends { conditions?: Record<string, unknown> }>(
  rules: T[],
  mappings: PriceRuleCatalogMapping[],
) {
  return rules.map((rule) => ({
    ...rule,
    conditions: Object.fromEntries(Object.entries(rule.conditions || {}).map(([key, value]) => {
      const entityType = key === 'brand' || key === 'category' || key === 'subcategory' ? key : null
      return [key, entityType ? normalizePriceRuleCatalogValue(value, entityType, mappings) : value]
    })),
  }))
}

export function shouldPreserveExistingPrice(product: any) {
  const source = String(product?.price_source || '').trim().toLowerCase()
  return source === 'manual' || Number(product?.price) > 0
}

export function matchingPriceRule(product: any, rules: any[]) {
  const candidates = rules.filter((rule) => {
    if (!rule.enabled) return false
    const conditions = rule.conditions || {}
    return Object.entries(conditions).every(([key, expected]) => {
      if (key === 'price_formula' || key === 'price_instruction' || key === 'ai_instruction') return true
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
    const score = (rule: any) => Object.keys(rule.conditions || {}).filter((key) => !['price_formula', 'price_instruction', 'ai_instruction'].includes(key)).length
      + (rule.conditions?.price_rule_key ? 1000 : 0)
    const specificity = score(right) - score(left)
    return specificity || Number(right.priority || 0) - Number(left.priority || 0)
  })[0] || null
}

export function calculatePriceRulePrice(rule: any, sourceText: unknown): number | null {
  const formula = rule?.conditions?.price_formula as SupplierPriceFormula | undefined
  if (!formula || typeof formula !== 'object') {
    const fixed = Number(rule?.price)
    return Number.isFinite(fixed) ? fixed : null
  }

  const amounts = extractSourcePriceAmounts(sourceText)
  if (amounts.length === 0) return null
  const sourcePrice = formula.source_price === 'min' ? Math.min(...amounts) : Math.max(...amounts)
  const multiplier = finitePriceFormulaNumber(formula.multiplier, 1)
  const secondaryMultiplier = finitePriceFormulaNumber(formula.secondary_multiplier, 1)
  const raw = sourcePrice * multiplier * secondaryMultiplier
  const roundTo = finitePriceFormulaNumber(formula.round_to, 1000)
  if (!Number.isFinite(raw) || !Number.isFinite(roundTo) || roundTo <= 0) return null
  const ratio = raw / roundTo
  const rounded = formula.rounding === 'up'
    ? Math.ceil(ratio) * roundTo
    : formula.rounding === 'down'
    ? Math.floor(ratio) * roundTo
    : Math.round(ratio) * roundTo
  return Number.isFinite(rounded) && rounded >= 0 ? Math.round(rounded) : null
}

/**
 * Applies the simple supplier price list when AI did not return a price rule.
 * The list is intentionally matched against the normalized product text, not
 * against the supplier's Chinese purchase prices.
 */
export function priceFromAiInstructions(instructions: unknown, sourceText: unknown): number | null {
  const source = normalizePriceInstructionText(sourceText)
  if (!source) return null

  for (const line of String(instructions || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?)\s*[-–—:]\s*([\d\s]+(?:[.,]\d+)?)\s*(?:₽|руб(?:лей|ля)?|р\.)?\s*$/iu)
    if (!match) continue
    const price = Number(String(match[2]).replace(/\s+/g, '').replace(',', '.'))
    if (!Number.isFinite(price) || price < 0) continue

    const terms = match[1]
      .split(/\s*(?:[,;/]|\bи\b)\s*/iu)
      .map((term) => normalizePriceInstructionText(term))
      .filter(Boolean)
    if (terms.some((term) => priceInstructionTermMatches(term, source))) return Math.round(price)
  }
  return null
}

function normalizePriceInstructionText(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .trim()
}

function priceInstructionTermMatches(term: string, source: string) {
  if (source.includes(term)) return true
  return term.split(/\s+/u).some((word) => {
    if (word.length < 3) return false
    const stem = /[аяыиэоеё]$/u.test(word) ? word.slice(0, -1) : word
    return source.includes(stem)
  })
}

function finitePriceFormulaNumber(value: unknown, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function extractSourcePriceAmounts(value: unknown): number[] {
  const text = String(value || '')
  const amounts: number[] = []
  const add = (first: string, second?: string) => {
    const values = [first, second].filter(Boolean).map((item) => Number(String(item).replace(',', '.')))
    amounts.push(...values.filter((item) => Number.isFinite(item) && item >= 10))
  }
  const prefix = /(?:💰\s*(?:[^0-9]{0,30})?|(?:¥|￥|rmb|人民币|元|价格|售价|price)\s*[:：]?\s*)(\d{2,7}(?:[.,]\d+)?)\s*(?:[—–-]\s*(\d{2,7}(?:[.,]\d+)?))?/giu
  for (const match of text.matchAll(prefix)) add(match[1], match[2])
  const suffix = /(\d{2,7}(?:[.,]\d+)?)\s*(?:[—–-]\s*(\d{2,7}(?:[.,]\d+)?))?\s*(?:元|¥|￥|rmb|人民币)\b/giu
  for (const match of text.matchAll(suffix)) add(match[1], match[2])
  return amounts
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

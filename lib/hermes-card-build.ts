import { type HardwareKind } from '@/lib/video-match-fields'
import { parseHermesCardFacts, materialsFromText, type HermesCardFacts } from '@/lib/hermes-card-facts'
import { buildHermesSlugFromFacts } from '@/lib/hermes-card-slug'

/**
 * Сборка карточки поставщика Hermes по правилам выгрузки из фактов, которые уже
 * есть в опубликованном товаре.
 *
 * Контракт:
 * - название — модель + размер + цвет Hermes: «Birkin 25 89/Noir», «Kelly 30 18/Etoupe»;
 *   у обуви размер в название не пишется (там размерный ряд), только модель и цвет;
 * - `model_name` — модель без размера: «Birkin», «Jet», «Kelly Mini 2»;
 * - `hardware_color` — значение из справочника («Серебристая», «Золотистая»);
 *   легаси-ключ `hardware` со значениями gold/silver переливается и удаляется;
 * - для сумок `dimensions` в формате «25 × 20 × 13 см» плюс `bag_width_cm` и `bag_height_cm`;
 * - цвета, материалы, размерный ряд обуви и остальные характеристики сохраняются как есть;
 * - альты фото до ИИ заполняются названием товара (потом их заменяет vision-проход).
 */

export type HermesCardKind = 'bag' | 'shoe' | 'auto'

export interface HermesCardInput {
  name?: string | null
  description?: string | null
  attributes?: Record<string, unknown> | null
  /** Сколько фото у товара: нужно, чтобы вернуть массив альтов той же длины. */
  mediaCount?: number
  kind?: HermesCardKind
  /** Категория каталога: из неё берётся тип изделия для названия. */
  categoryName?: string | null
  /** Пол товара: нужен для размерной сетки обуви. */
  gender?: string | null
  /** Slug бренда каталога: «hermes». */
  brandSlug?: string | null
  /** Внутренний SEO-артикул товара: «HER-46911». */
  article?: string | null
  /** Текущий адрес товара — нужен, чтобы показать «сейчас / станет». */
  currentSlug?: string | null
}

export interface HermesCardProposal {
  facts: HermesCardFacts
  kind: 'bag' | 'shoe'
  modelName: string | null
  sizeToken: string | null
  /** Тип изделия, попавший в название: «Сумка», «Кошелёк», «Кроссовки». */
  typeWord: string | null
  name: string
  /** Предлагаемый адрес: hermes-{модель}-{размер}-{цвет}-{фурнитура}-{материал}-{артикул}. */
  slug: string
  slugParts: Record<string, string | null>
  /** Только новые или изменённые коды характеристик — для показа «сейчас / станет». */
  attributePatch: Record<string, unknown>
  /** Полный объект характеристик для PATCH: существующие значения плюс патч. */
  attributes: Record<string, unknown>
  /** Черновик описания из фактов; заменяется ИИ-текстом. */
  description: string
  photoAlts: string[]
  warnings: string[]
}

/** Тип изделия для названия: берётся из категории каталога. */
const CATEGORY_TYPES: Array<[RegExp, string]> = [
  [/поясн/i, 'Поясная сумка'],
  [/кошел|картхолдер/i, 'Кошелёк'],
  [/косметич/i, 'Косметичка'],
  [/чемодан/i, 'Чемодан'],
  [/рюкзак/i, 'Рюкзак'],
  [/клатч/i, 'Клатч'],
  [/сумк/i, 'Сумка'],
  [/кроссовк|кеды/i, 'Кроссовки'],
  [/шлепанц|шлёпанц|тапочк|сандал/i, 'Сандалии'],
  [/мюли|сабо/i, 'Мюли'],
  [/лофер|мокасин/i, 'Лоферы'],
  [/ботинк|полуботинк/i, 'Ботинки'],
  [/сапог/i, 'Сапоги'],
  [/балетк/i, 'Балетки'],
  [/туфл/i, 'Туфли'],
]

/** Род и число нужны, чтобы русское название цвета согласовалось с типом. */
const TYPE_GENDER: Record<string, 'feminine' | 'masculine' | 'plural'> = {
  'Сумка': 'feminine',
  'Поясная сумка': 'feminine',
  'Косметичка': 'feminine',
  'Кошелёк': 'masculine',
  'Чемодан': 'masculine',
  'Рюкзак': 'masculine',
  'Клатч': 'masculine',
  'Кроссовки': 'plural',
  'Сандалии': 'plural',
  'Мюли': 'plural',
  'Лоферы': 'plural',
  'Ботинки': 'plural',
  'Сапоги': 'plural',
  'Балетки': 'plural',
  'Туфли': 'plural',
}

export function typeWordForCategory(categoryName: string | null | undefined): string | null {
  const source = String(categoryName || '')
  for (const [pattern, word] of CATEGORY_TYPES) {
    if (pattern.test(source)) return word
  }
  return null
}

/**
 * Согласует русское однословное название цвета с типом изделия:
 * «Кроссовки Bouncing Черный» → «Кроссовки Bouncing чёрные».
 * Коды и латинские имена Hermes («18/Etoupe») не трогаем.
 */
export function agreeColourWithType(colour: string | null, typeWord: string | null): string | null {
  const value = tidy(colour)
  if (!value || !typeWord) return value || null
  if (!/^[А-Яа-яЁё-]+$/.test(value)) return value
  const gender = TYPE_GENDER[typeWord]
  if (!gender) return value

  const lower = value.toLowerCase()
  const endings: Array<[RegExp, Record<'feminine' | 'masculine' | 'plural', string>]> = [
    [/ый$/, { feminine: 'ая', masculine: 'ый', plural: 'ые' }],
    [/ий$/, { feminine: 'яя', masculine: 'ий', plural: 'ие' }],
    [/ой$/, { feminine: 'ая', masculine: 'ой', plural: 'ые' }],
  ]
  for (const [pattern, forms] of endings) {
    if (pattern.test(lower)) return lower.replace(pattern, forms[gender])
  }
  // Прилагательное без узнаваемого окончания («Эбен») оставляем как есть.
  return lower
}

/** Слова-типы изделия, которые не являются моделью. */const TYPE_WORDS = new Set([
  'сумка', 'сумки', 'сумку', 'сумочка', 'сумка-мешок', 'мешок', 'кроссовки', 'кеды', 'босоножки',
  'тапочки', 'шлёпанцы', 'шлепанцы', 'сандалии', 'сандали', 'мюли', 'сабо', 'туфли', 'лоферы',
  'мокасины', 'ботинки', 'полуботинки', 'сапоги', 'полусапоги', 'рюкзак', 'клатч', 'косметичка',
  'чемодан', 'кошелёк', 'картхолдер', 'обложка', 'ремень', 'балетки', 'слайдеры', 'слайды',
])

/** Приставки размерного ряда модели, после которых число относится к модели, а не к размеру. */
const MODEL_NUMBER_WORDS = new Set(['mini', 'micro', 'nano', 'pico', 'ii', 'iii'])

const HARDWARE_VALUES: Record<Exclude<HardwareKind, 'other'>, string> = {
  silver: 'Серебристая',
  gold: 'Золотистая',
  rose: 'Розовое золото',
  black: 'Чёрная',
}

/** Легаси-ключ с фурнитурой: `{ value: 'gold' }` или строка. */
export function legacyHardwareKind(value: unknown): HardwareKind | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'object' && value !== null
    ? String((value as Record<string, unknown>).value ?? (value as Record<string, unknown>).display_value ?? '')
    : String(value)
  const text = raw.trim().toLowerCase()
  if (!text) return null
  if (/rose|розов/.test(text)) return 'rose'
  if (/silver|серебр|pallad|паллад/.test(text)) return 'silver'
  if (/black|чёрн|черн/.test(text)) return 'black'
  if (/gold|золот/.test(text)) return 'gold'
  return 'other'
}

export function hardwareColourValue(kind: HardwareKind | null): string | null {
  if (!kind || kind === 'other') return null
  return HARDWARE_VALUES[kind]
}

function tidy(value: unknown) {
  return String(value ?? '')
    .replace(/[\u200b\u200e\u200f\ufeff\ufffd]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:：,;."'«»]+|[\s\-–—:：,;."'«»]+$/g, '')
    .trim()
}

function firstValue(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return firstValue(record.value ?? record.display_value ?? record.name ?? record.names)
  }
  const list = Array.isArray(value) ? value : [value]
  return tidy(list.find((item) => tidy(item)))
}

/** Модель без размера и без русских слов-типов изделия. */
export function extractHermesModel(value: unknown): string | null {
  const initial = tidy(value)
  if (!initial) return null

  // Если в значении есть латинская модель, русские слова — это тип изделия
  // («Высокие босоножки-слайдеры Oasis»), их в модель не берём. Числовые
  // и составные части модели («24/24», «625 Bouncing») сохраняем.
  const hasLatin = /[a-z]/i.test(initial)
  let model = initial
    .split(' ')
    .filter((token) => {
      const lower = token.toLowerCase().replace(/[«»"'.,]/g, '')
      if (TYPE_WORDS.has(lower)) return false
      if (!hasLatin) return true
      return /[a-z0-9]/i.test(token)
    })
    .join(' ')
    .trim()
  if (!model) return null

  // Ведущие числа-артикулы поставщика («625 Bouncing») не часть модели.
  model = model.replace(/^(?:\d+(?:[.,]\d+)?\s+)+/, '')

  // Хвостовые габариты и единицы: «Kelly Mini 19*12*5.5», «Birkin 25cm».
  const tail = model.match(/[\s,]*(\d+(?:[.,]\d+)?(?:\s*[*x×]\s*\d+(?:[.,]\d+)?)*)\s*(?:cm|см|мм)?$/i)
  if (tail) {
    const before = model.slice(0, tail.index).trim()
    const lastWord = before.split(' ').pop()?.toLowerCase().replace(/[«»"']/g, '') || ''
    // «24/24» и «Kelly Mini 2» — число часть модели, а не размер.
    const attached = /[/\-–—]$/.test(before)
    const isModelNumber = !/[*x×]/i.test(tail[1])
      && Number(tail[1].replace(',', '.')) < 10
      && MODEL_NUMBER_WORDS.has(lastWord)
    if (!attached && !isModelNumber) model = before
  }

  model = model.replace(/[,\-–—]+$/g, '').trim()
  if (/[a-z]/i.test(model)) return model
  // Модель без латиницы: «24/24» — это модель, а одинокое число — размер.
  if (/^\d+(?:[.,]\d+)?$/.test(model)) return null
  return /[\d/]/.test(model) ? model : null
}

/** Кожи Hermes, которые поставщик пишет с опечатками. */
const LEATHER_TYPO_FORMS: Array<[RegExp, string]> = [
  [/\bevecolor\b/i, 'Evercolor'],
  [/\beposm\b/i, 'Epsom'],
]

/** Русские названия экзотических кож: в каталоге пишем «Кожа <кого>». */
const EXOTIC_LEATHER_FORMS: Array<[RegExp, string]> = [
  [/ал+и?гатор/i, 'Кожа аллигатора'],
  [/alligator/i, 'Кожа аллигатора'],
  [/ящериц/i, 'Кожа ящерицы'],
  [/\blizard\b/i, 'Кожа ящерицы'],
  [/крокодил/i, 'Кожа крокодила'],
  [/\bcrocodile\b/i, 'Кожа крокодила'],
  [/страус|ostrich/i, 'Кожа страуса'],
  [/питон|\bpython\b/i, 'Кожа питона'],
  [/нилот|niloticus/i, 'Кожа нильского крокодила'],
]

/**
 * Материал в характеристику: короткое подтверждённое значение вместо абзаца
 * («Верх из кожи ящерицы. Кожа ящерицы импортирована из Франции» → «Кожа ящерицы»).
 *
 * Поставщик добавляет к коже страну происхождения и свои опечатки, поэтому
 * значение чистится от «from France», «импортированная… родом из» и приводится
 * к каталогу: «Evecolor» → «Evercolor», «Аллгатор» → «Кожа аллигатора».
 */
export function tidyHermesMaterial(value: string | null | undefined): string | null {
  let text = tidy(value)
  if (!text) return null
  text = text.split(/[.;]/)[0]
  text = text.replace(/^(?:верх|подкладка|материал)\s*(?:из|:)?\s*/i, '').replace(/^из\s+/i, '')
  // Страна происхождения и служебные слова поставщика в названии не нужны.
  text = text
    .replace(/\b(?:from|form)\s+france\b/gi, ' ')
    .replace(/(?:^|\s)из\s+франции/gi, ' ')
    .replace(/французск[а-яё]*/gi, ' ')
    .replace(/\bimported\b[^,]*/gi, ' ')
    .replace(/\bwhich\s+originally\s+from\b[^,]*/gi, ' ')
    .replace(/импортированн[а-яё]*/gi, ' ')
    .replace(/родом\s+из[^,]*/gi, ' ')
  text = text.replace(/^[\s\-–—:]+/, '').replace(/[,\s]+$/, '')
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  for (const [pattern, replacement] of EXOTIC_LEATHER_FORMS) {
    if (pattern.test(text)) return replacement
  }
  for (const [pattern, replacement] of LEATHER_TYPO_FORMS) {
    text = text.replace(pattern, replacement)
  }
  text = text.replace(/^кож[аи]\s+/i, 'Кожа ').replace(/^замш[аи]\s+/i, 'Замша ')
  text = text.replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > 60) {
    const cut = text.slice(0, 60)
    text = (cut.lastIndexOf(' ') >= 30 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim()
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Подошва, подкладка и высота каблука — только когда прямо названы в тексте. */
const MATERIAL_FORMS: Record<string, string> = {
  кожи: 'Кожа',
  кожа: 'Кожа',
  резины: 'Резина',
  резина: 'Резина',
  замши: 'Замша',
  замша: 'Замша',
  текстиля: 'Текстиль',
  текстиль: 'Текстиль',
  каучука: 'Каучук',
  каучук: 'Каучук',
  полиуретана: 'Полиуретан',
  полиуретан: 'Полиуретан',
  овчины: 'Овчина',
  меха: 'Мех',
  мех: 'Мех',
}

function materialForm(value: string) {
  return MATERIAL_FORMS[value.toLowerCase()] || value.charAt(0).toUpperCase() + value.slice(1)
}

/** Материалы подошвы: кожа подошвой не бывает — в тексте это стелька. */
const SOLE_MATERIAL_RE = /подошв[а-яё]*[^.;]{0,40}?(резин[а-яё]*|каучук[а-яё]*|полиуретан[а-яё]*|\bПУ\b|\bTPR\b|нейлон[а-яё]*|пластик[а-яё]*|\bЭВА\b|\bEVA\b)/i
const SOLE_FORM_FORMS: Record<string, string> = {
  резина: 'Резина', резины: 'Резина', резиновый: 'Резина', резиновая: 'Резина',
  каучук: 'Каучук', каучука: 'Каучук',
  полиуретан: 'Полиуретан', полиуретана: 'Полиуретан',
  нейлон: 'Нейлон', нейлона: 'Нейлон',
  пластик: 'Пластик', пластика: 'Пластик',
}
const INSOLE_RE = /внутренн[а-яё]*\s+подошв/i

export function parseHermesShoeDetails(text: string | null | undefined) {
  const source = tidy(text)
  const details: { sole_material?: string; lining_material?: string; heel_height?: number } = {}
  if (!source) return details

  // «Внутренняя подошва … из кожи» — это стелька, материалом подошвы не является.
  if (!INSOLE_RE.test(source)) {
    const sole = source.match(SOLE_MATERIAL_RE)
    if (sole) {
      const word = String(sole[1]).toLowerCase()
      details.sole_material = SOLE_FORM_FORMS[word] || word.charAt(0).toUpperCase() + word.slice(1)
    }
  }

  const lining = source.match(/подкладк[а-яё]*[^.;]{0,40}?(кож[а-яё]*|текстил[а-яё]*|овеч[а-яё]*|мех[а-яё]*)/i)
  if (lining) details.lining_material = materialForm(lining[1])

  const heel = source.match(/(?:высота\s+каблука|каблук)\D{0,20}?(\d+(?:[.,]\d+)?)\s*(?:см|cm)/i)
  if (heel) {
    const value = Number(heel[1].replace(',', '.'))
    if (Number.isFinite(value) && value > 0 && value <= 20) details.heel_height = value
  }
  return details
}

/**
 * Размер для названия: первое число после модели. Если в исходном названии
 * размера не было, размер не подставляем — такая карточка подразумевает один
 * размер, и придуманное число (например, ширина габаритов) вводило бы в
 * заблуждение. Модель из названия вырезается заранее, поэтому «24/24» не
 * превращается в размер.
 */
export function extractHermesSizeToken(
  name: string | null | undefined,
  _facts: HermesCardFacts,
  modelName?: string | null,
): string | null {
  let remainder = tidy(name)
  const model = tidy(modelName)
  if (model) {
    const index = remainder.toLowerCase().indexOf(model.toLowerCase())
    if (index >= 0) remainder = `${remainder.slice(0, index)} ${remainder.slice(index + model.length)}`
  }
  const numbers = remainder.match(/\d+(?:[.,]\d+)?/g) || []
  const first = numbers[0]
  if (first) return String(Number(first.replace(',', '.')))
  return null
}

/** Базовые слова материалов: длинные формулировки в название не переносим. */
const MATERIAL_BASE_WORDS: Array<[RegExp, string]> = [
  [/кож/i, 'кожа'],
  [/замш/i, 'замша'],
  [/нубук/i, 'нубук'],
  [/текстил/i, 'текстиль'],
  [/шерст|шёрст/i, 'шерсть'],
  [/кашемир/i, 'кашемир'],
  [/лён|лен/i, 'лён'],
  [/хлопок/i, 'хлопок'],
  [/деним/i, 'деним'],
  [/нейлон/i, 'нейлон'],
  [/мех/i, 'мех'],
]

/**
 * Материал для названия: латинские кожи Hermes («Swift», «Togo», «Clémence») и
 * короткие базовые слова («кожа», «замша»). Длинные формулировки вроде
 * «Натуральная кожа ягненка» сворачиваются до базового слова.
 */
export function materialNameToken(material: string | null | undefined) {
  const value = tidyHermesMaterial(material)
  if (!value) return null
  const leather = value.match(/^Кожа\s+([A-Za-zÀ-ÿ][\wÀ-ÿ-]*(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ-]*){0,2})$/)
  if (leather) return leather[1].length <= 22 ? leather[1].replace(/\s+and\s+/gi, ' и ') : null
  // Латинские названия кож (Clemence, Taurillon Regate) сохраняют исходный регистр.
  if (/^[A-Za-zÀ-ÿ][\wÀ-ÿ\s-]*$/.test(value)) {
    return value.length <= 22 ? value.replace(/\s+and\s+/gi, ' и ') : null
  }
  for (const [pattern, word] of MATERIAL_BASE_WORDS) {
    if (pattern.test(value)) return word
  }
  const token = value.charAt(0).toLowerCase() + value.slice(1)
  return token.length <= 22 ? token : null
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
}

/** Размерный ряд обуви числами: «34-41» → ['34' … '41']. */
export function sizeRangeValues(range: { from: number; to: number } | null, limit = 40) {
  if (!range) return [] as string[]
  const values: string[] = []
  for (let size = range.from; size <= range.to && values.length < limit; size += 1) {
    values.push(String(size))
  }
  return values
}

/** Пол обуви для размерной сетки: у поставщика он есть у части карточек. */
export function genderAudience(gender: string | null | undefined) {
  const value = String(gender || '').toLowerCase()
  if (value.includes('жен') || value === 'female') return 'female'
  if (value.includes('муж') || value === 'male') return 'male'
  return 'unisex'
}

/**
 * Черновик описания из подтверждённых фактов карточки. Это не финальный
 * публичный текст: ИИ-проход заменяет его полным описанием, а черновик
 * остаётся запасным вариантом, если ИИ не отработал.
 */
export function buildHermesDraftDescription(input: {
  kind: 'bag' | 'shoe'
  name: string
  facts: HermesCardFacts
  hardwareValue?: string | null
  dimensions?: string | null
}): string {
  const items: string[] = []
  if (input.facts.material) items.push(`материал ${input.facts.material}`)
  if (input.facts.colourDisplay) items.push(`цвет ${input.facts.colourDisplay}`)
  if (input.hardwareValue) items.push(`фурнитура ${input.hardwareValue.toLowerCase()}`)
  if (input.kind === 'bag' && input.dimensions) items.push(`габариты ${input.dimensions}`)
  if (input.kind === 'shoe' && input.facts.sizeRange) {
    items.push(`размеры ${input.facts.sizeRange.from}–${input.facts.sizeRange.to}`)
  }
  const head = input.kind === 'bag' ? 'Сумка' : 'Модель'
  return items.length ? `${head} ${input.name}: ${items.join(', ')}.` : `${head} ${input.name}.`
}

/** Собирает предложение по карточке: название, характеристики, альты, предупреждения. */
export function buildHermesCardProposal(input: HermesCardInput): HermesCardProposal {
  const facts = parseHermesCardFacts(input.description)
  const existing = input.attributes && typeof input.attributes === 'object' ? { ...input.attributes } : {}
  const warnings: string[] = []

  const explicitKind = input.kind && input.kind !== 'auto' ? input.kind : null
  const kind: 'bag' | 'shoe' = explicitKind
    || (facts.sizeKind === 'range' || facts.sizeRange ? 'shoe' : 'bag')

  // Источник модели: видимое название товара, затем характеристика, затем «Стиль».
  // Название надёжнее: в `model_name` у части карточек записан размер
  // («Kelly Mini 19*12*5.5»), а «Стиль» иногда содержит только тип изделия.
  const modelName = extractHermesModel(input.name)
    || extractHermesModel(firstValue(existing.model_name))
    || extractHermesModel(facts.style)
  if (!modelName) warnings.push('модель не распознана: нужен ручной ввод или ИИ')

  const sizeToken = extractHermesSizeToken(input.name, facts, modelName)
  const typeWord = typeWordForCategory(input.categoryName)
  if (!typeWord) warnings.push('тип товара не определён по категории: в название не добавлен')
  const agreedColour = agreeColourWithType(facts.colourDisplay, typeWord)
  // Размер в названии — в сантиметрах, иначе после него идёт цвет и получаются
  // две цифры подряд («Birkin 25 см 89/Noir»).
  const sizePart = kind === 'bag' && sizeToken ? `${sizeToken} см` : null
  const materialToken = materialNameToken(facts.material || materialsFromText(`${facts.body || ''} ${input.description || ''}`)[0] || null)
  if (!facts.colourDisplay) warnings.push('цвет в карточке не указан')
  if (facts.hardwareConflict) warnings.push('в тексте упомянуты и золото, и серебро: фурнитуру выбирает оператор')
  if (!facts.hasFieldBlock) warnings.push('блока характеристик в описании нет')
  if (!facts.body) warnings.push('текста описания нет')

  const nameParts = kind === 'bag'
    ? [typeWord, modelName, sizePart, materialToken, agreedColour]
    : [typeWord, modelName, materialToken, agreedColour]
  const name = nameParts.filter(Boolean).join(' ').trim()
  const finalName = name || tidy(input.name)
  if (!name) warnings.push('название собрать не удалось: оставлено текущее')

  const attributePatch: Record<string, unknown> = {}
  if (modelName) attributePatch.model_name = modelName

  // Цвет изделия в характеристики: обычный цвет — имя без кода («Noir»,
  // «Черный»), а форма Hermes («18/Etoupe», «ck89/Noir») идёт в отдельный
  // атрибут «Цвет поставщика».
  if (!existing.colors && facts.colourPlain) {
    attributePatch.colors = [facts.colourPlain]
  }
  if (!existing.supplier_color && facts.colourDisplay) {
    attributePatch.supplier_color = facts.colourDisplay
  }

  let hardwareKind = facts.hardwareKind
  if (!hardwareKind) {
    const legacy = legacyHardwareKind(existing.hardware)
    if (legacy && legacy !== 'other') {
      hardwareKind = legacy
      warnings.push('фурнитура взята из старого поля hardware')
    }
  }
  const hardwareValue = hardwareColourValue(hardwareKind)
  if (hardwareValue && firstValue(existing.hardware_color) !== hardwareValue) {
    attributePatch.hardware_color = hardwareValue
  }

  if (kind === 'bag' && facts.sizeNumbers.length >= 2) {
    const [width, height, depth] = facts.sizeNumbers
    const dimensions = [width, height, depth].filter((value) => value !== undefined).map(formatNumber).join(' × ') + ' см'
    if (String(existing.dimensions || '') !== dimensions) attributePatch.dimensions = dimensions
    if (Number(existing.bag_width_cm) !== width) attributePatch.bag_width_cm = width
    if (Number(existing.bag_height_cm) !== height) attributePatch.bag_height_cm = height
  }
  const materialText = `${facts.body || ''} ${input.description || ''}`
  let slugMaterial: string | null = facts.material || null
  if (kind === 'shoe') {
    const material = tidyHermesMaterial(facts.material) || materialsFromText(materialText)[0] || null
    if (material && !firstValue(existing.upper_material)) attributePatch.upper_material = material
    // Общая характеристика «Материалы» тоже заполняется: она видна в карточке
    // каталога, а у обуви раньше оставалась пустой.
    if (material && !firstValue(existing.materials)) attributePatch.materials = [material]
    slugMaterial = material
    const details = parseHermesShoeDetails(`${facts.body || ''} ${facts.material || ''}`)
    if (details.sole_material && !firstValue(existing.sole_material)) attributePatch.sole_material = details.sole_material
    if (details.lining_material && !firstValue(existing.lining_material)) attributePatch.lining_material = details.lining_material
    if (details.heel_height && !Number(existing.heel_height)) attributePatch.heel_height = details.heel_height
    // Размерный ряд обуви: если в характеристиках его нет, пишем из описания.
    if (facts.sizeRange && !existing.sizes) {
      const values = sizeRangeValues(facts.sizeRange)
      if (values.length > 1) {
        attributePatch.sizes = {
          groups: [{ system: 'EU', values, audience: genderAudience(input.gender) }],
          values,
        }
        if (!firstValue(existing.size_system)) attributePatch.size_system = 'EU'
      }
    } else if (!facts.sizeRange && !existing.sizes) {
      warnings.push('размерный ряд не указан: sizes не заполнены')
    }
  } else {
    // Материал: сначала блок «Материал:», иначе собираем из текста описания.
    const fromField = tidyHermesMaterial(facts.material)
    const fromText = materialsFromText(materialText).map((value) => tidyHermesMaterial(value)).filter(Boolean) as string[]
    const materialList = fromField ? [fromField] : fromText
    slugMaterial = fromField || materialList[0] || null
    if (!firstValue(existing.materials) && materialList.length > 0) {
      attributePatch.materials = materialList
      if (!fromField) warnings.push('материал собран из текста описания')
    }
  }

  const attributes: Record<string, unknown> = { ...existing, ...attributePatch }
  // Легаси-ключ фурнитуры больше не публикуем: его значение перенесено в hardware_color.
  delete attributes.hardware

  const mediaCount = Number(input.mediaCount || 0)
  const photoAlts = mediaCount > 0 ? Array.from({ length: mediaCount }, () => finalName) : []

  const slug = buildHermesSlugFromFacts(facts, {
    brandSlug: input.brandSlug || 'hermes',
    article: input.article,
    modelName,
    sizeToken,
    kind,
    material: slugMaterial,
  })
  warnings.push(...slug.warnings)

  return {
    facts,
    kind,
    modelName,
    sizeToken,
    typeWord,
    name: finalName,
    slug: slug.slug,
    slugParts: slug.parts,
    attributePatch,
    attributes,
    description: buildHermesDraftDescription({
      kind,
      name: finalName,
      facts,
      hardwareValue: hardwareValue || null,
      dimensions: typeof attributePatch.dimensions === 'string' ? attributePatch.dimensions : null,
    }),
    photoAlts,
    warnings,
  }
}

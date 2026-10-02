import { parseCatalogFields, type HardwareKind } from '@/lib/video-match-fields'

/**
 * Разбор уже опубликованной карточки товара поставщика Hermes на факты.
 *
 * Карточка каталога у этого поставщика устроена одинаково — блок характеристик
 * плюс текст описания:
 *
 *   Стиль: Birkin
 *   Цвет: 89/Noir
 *   Материал: Swift
 *   Размер: 25*20*13cm
 *   Описание: Из Франции. Фурнитура: серебро. Платина 25см, чёрный, …
 *
 * Часть карточек хранит блок в одну строку и пишет фурнитуру не отдельным
 * ключом, а внутри текста («с золотой фурнитурой», «серебряная пряжка»),
 * поэтому разбор идёт по ключам, а затем по подтверждающим упоминаниям в тексте.
 * Разбор ничего не меняет: он только собирает факты для дальнейшей сборки
 * названия, характеристик и описания по правилам выгрузки.
 */

export interface HermesCardFacts {
  /** Значение ключа «Стиль» как есть: может быть и моделью, и типом изделия. */
  style: string | null
  /** Цвет строкой как в карточке: «18/etoupe», «89/Noir», «Etoupe», «Абрикосовый». */
  colourRaw: string | null
  /** Код цвета Hermes, если он есть: «18», «89», «0V», «i2». */
  colourCode: string | null
  /** Имя цвета Hermes без кода: «Etoupe», «Noir», «Pebble Beige». */
  colourName: string | null
  /** Нормализованное представление для названия: «18/Etoupe» или «Noir». */
  colourDisplay: string | null
  /** Цвет без кода Hermes: «Черный», «Etoupe» — это значение идёт в характеристику. */
  colourPrimary: string | null
  /** Обычный цвет для атрибута «Цвет»: имя без кода — «Noir», «Черный», «Etoupe». */
  colourPlain: string | null
  /** Перевод названия цвета из скобок, если он был в исходнике. */
  colourGloss: string | null
  /** Материал из «Материал:» или «Кожа:». */
  material: string | null
  /** Размер строкой как в карточке. */
  sizeRaw: string | null
  /** Числа размера по порядку: «25*20*13cm» → [25, 20, 13]. */
  sizeNumbers: number[]
  /** Размерный ряд обуви: «34-41», «от 34 до 41» → { from: 34, to: 41 }. */
  sizeRange: { from: number; to: number } | null
  /** Тип размера: габариты изделия, размерный ряд, одно число или неизвестно. */
  sizeKind: 'dimensions' | 'range' | 'single' | 'unknown'
  /** Есть ли в карточке блок характеристик вообще. */
  hasFieldBlock: boolean
  /** Фурнитура строкой: из ключа «Фурнитура:» или из подтверждающего упоминания. */
  hardwareRaw: string | null
  hardwareKind: HardwareKind | null
  /** В тексте одновременно упомянуты золото и серебро — решает оператор или ИИ. */
  hardwareConflict: boolean
  /** Текст описания после «Описание:» (или «Особенности:»/«Материалы:»). */
  body: string | null
}

const FIELD_KEYS = ['Стиль', 'Цвет', 'Материал', 'Кожа', 'Размер', 'Фурнитура'] as const

function tidy(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/[\u200b\u200e\u200f\ufeff\ufffd]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:：,;.]+|[\s\-–—:：,;.]+$/g, '')
    .trim()
}

/** Значение ключа блока: строка до конца строки, иначе до следующего ключа. */
function fieldValue(source: string, key: string) {
  const pattern = new RegExp(`${key}\\s*[:：]\\s*([^\\n\\r]*)`, 'i')
  const match = source.match(pattern)
  return match ? tidy(cutAtFieldKey(match[1])) || null : null
}

/**
 * В части карточек весь блок идёт одной строкой, поэтому значение первого ключа
 * утаскивает следующие: «Цвет: Red Материал: Кожа Размер: …». Обрезаем значение
 * по встроенному ключу, иначе мусор уезжает в название и адрес.
 */
const FIELD_KEY_RE = /(?:^|\s)(?:Стиль|Цвет|Материал|Материалы|Кожа|Размер|Фурнитура|Описание|Особенности)\s*:/i

export function cutAtFieldKey(value: string | null | undefined) {
  const source = String(value ?? '')
  const match = source.match(FIELD_KEY_RE)
  return match && match.index !== undefined ? source.slice(0, match.index) : source
}

/** Цвет с переводом в скобках: «Черный (ck89/noir)», «Raisin (виноградный фиолетовый)». */
function splitColourGloss(value: string | null | undefined) {
  const text = tidy(value)
  if (!text) return { primary: null as string | null, gloss: null as string | null }
  const match = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  if (!match) return { primary: text, gloss: null as string | null }
  return { primary: tidy(match[1]) || null, gloss: tidy(match[2]) || null }
}

/**
 * Внутренний цвет Hermes из пары «русское название + код/имя в скобках»:
 * «Черный (ck89/Noir)» → ck89/Noir, «Натуральный (Naturel)» → Naturel,
 * «Raisin (виноградный фиолетовый)» → Raisin (перевод отбрасывается).
 * Скобка только с артикулом («Золотисто-коричневый (CK37)») остаётся частью
 * названия цвета: без имени внутри она ничего не уточняет.
 */
export function pickHermesColour(value: string | null | undefined) {
  const { primary, gloss } = splitColourGloss(value)
  if (!gloss) return { display: primary, raw: primary, primary, gloss: null as string | null }
  const glossHasLatin = /[a-z]/i.test(gloss)
  // Артикул цвета без имени: «CK37», «89», «0V» — цифра есть, пробелов нет.
  const glossIsCodeOnly = /\d/.test(gloss) && !/\s/.test(gloss) && gloss.length <= 6 && !gloss.includes('/')
  if (glossIsCodeOnly) {
    // «Blue izmir (7W)» — латинское имя и код: собираем в форму каталога «7W/Blue Izmir».
    // «Золотисто-коричневый (CK37)» — русского имени код не заменяет.
    const primaryHasLatin = /[a-z]/i.test(primary || '')
    return primaryHasLatin
      ? { display: `${gloss}/${primary}`, raw: `${gloss}/${primary}`, primary, gloss: null as string | null }
      : { display: `${primary} (${gloss})`, raw: primary, primary, gloss: null as string | null }
  }
  // Русский перевод в скобках нужен описанию, в название и адрес идёт Hermes-форма.
  if (glossHasLatin) return { display: gloss, raw: gloss, primary, gloss: primary }
  return { display: primary, raw: primary, primary, gloss }
}

/** Текст описания: после «Описание:» либо собранный из «Материалы:» и «Особенности:». */
function descriptionBody(source: string) {
  const explicit = source.match(/(?:Описание|描述)\s*[:：]([\s\S]*)$/i)
  if (explicit) {
    const value = tidy(explicit[1])
    if (value) return value
  }
  const parts = [fieldValue(source, 'Материалы'), fieldValue(source, 'Особенности')].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/** Код цвета Hermes: левая часть до «/» либо короткое значение с цифрой («0V», «i2», «89»). */
export function parseHermesColour(raw: string | null | undefined): { code: string | null; name: string | null } {
  const value = tidy(raw)
  if (!value) return { code: null, name: null }

  const segments = value.split('/').map((part) => part.trim()).filter(Boolean)
  if (segments.length > 1) {
    const code = segments[0]
    const name = segments.slice(1).join(' ')
    return { code: code || null, name: name || null }
  }

  const single = segments[0]
  if (/^[0-9a-z]{1,4}$/i.test(single) && /\d/.test(single)) return { code: single, name: null }
  return { code: null, name: single }
}

function titleCase(value: string) {
  return value
    .split(' ')
    .map((word) => (word.length > 1 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase()))
    .join(' ')
}

/**
 * Цвет для названия и описания: «18/Etoupe», «0V/Gris Ciment», «Noir».
 * Код сохраняется как в карточке (регистр Hermes), имя приводится к заглавным.
 */
export function hermesColourDisplay(code: string | null, name: string | null): string | null {
  const cleanCode = tidy(code)
  const cleanName = tidy(name)
  if (cleanCode && cleanName) return `${cleanCode}/${titleCase(cleanName)}`
  if (cleanCode) return cleanCode
  if (cleanName) return titleCase(cleanName)
  return null
}

function parseSize(raw: string | null) {
  const value = tidy(raw)
  if (!value) return { numbers: [] as number[], range: null as { from: number; to: number } | null }
  const numbers = (value.replace(/,/g, '.').match(/\d+(?:\.\d+)?/g) || [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
  const rangeMatch = value.match(/(\d+)\s*(?:[-–—]|до)\s*(\d+)/i)
  const range = rangeMatch ? { from: Number(rangeMatch[1]), to: Number(rangeMatch[2]) } : null
  return { numbers, range }
}

const SILVER_RE = /silver|sliver|серебр|steel|стальн|pallad|паллад|白金/i
const GOLD_RE = /gold|золот|золоч/i
const ROSE_RE = /rose gold|розов(?:ое|ая)\s*золот|розовое золото/i
const BLACK_RE = /чёрн(?:ая|ый)\s*фурнитур|черн(?:ая|ый)\s*фурнитур|black hardware/i

/**
 * Фурнитура: сначала явный ключ, затем упоминание в тексте. Если в тексте есть и
 * золото, и серебро, значение не угадывается — ставится флаг конфликта.
 */
function resolveHardware(blockHardware: string | null, body: string | null) {
  const explicit = tidy(String(blockHardware ?? '').split(/[.!?\n\r]/)[0])
  // Значение ключа годится, только если это короткая характеристика: у части
  // карточек «Фурнитура:» встречается внутри текста описания и утаскивает за
  // собой весь абзац.
  if (explicit && explicit.split(' ').length <= 5) {
    return { raw: explicit, kind: hardwareKindFromText(explicit), conflict: false }
  }
  const text = tidy(body)
  if (!text) return { raw: null, kind: null as HardwareKind | null, conflict: false }

  const labelled = text.match(/Фурнитура\s*[:：]\s*([^.\n\r]{1,60})/i)
  if (labelled) {
    const value = tidy(labelled[1])
    if (value) return { raw: value, kind: hardwareKindFromText(value), conflict: false }
  }

  const silver = SILVER_RE.test(text)
  const gold = GOLD_RE.test(text) && !ROSE_RE.test(text)
  if (silver && gold) return { raw: null, kind: null as HardwareKind | null, conflict: true }
  if (silver) return { raw: 'серебро (из текста)', kind: 'silver' as HardwareKind, conflict: false }
  if (ROSE_RE.test(text)) return { raw: 'розовое золото (из текста)', kind: 'rose' as HardwareKind, conflict: false }
  if (gold) return { raw: 'золото (из текста)', kind: 'gold' as HardwareKind, conflict: false }
  if (BLACK_RE.test(text)) return { raw: 'чёрная фурнитура (из текста)', kind: 'black' as HardwareKind, conflict: false }
  return { raw: null, kind: null as HardwareKind | null, conflict: false }
}

function hardwareKindFromText(value: string): HardwareKind | null {
  const text = String(value || '').toLowerCase()
  if (!text.trim()) return null
  if (ROSE_RE.test(text)) return 'rose'
  if (SILVER_RE.test(text)) return 'silver'
  if (BLACK_RE.test(text)) return 'black'
  if (GOLD_RE.test(text)) return 'gold'
  return 'other'
}

/** Материалы из свободного текста, когда блока «Материал:» нет. */
const MATERIAL_WORD_FORMS: Record<string, string> = {
  кожа: 'Кожа', кожи: 'Кожа', кожу: 'Кожа', кожей: 'Кожа', коже: 'Кожа',
  холст: 'Холст', холста: 'Холст', холсте: 'Холст',
  канвас: 'Канвас', канваса: 'Канвас',
  замша: 'Замша', замши: 'Замша', замшу: 'Замша',
  нубук: 'Нубук', нубука: 'Нубук',
  текстиль: 'Текстиль', текстиля: 'Текстиль',
  кашемир: 'Кашемир', кашемира: 'Кашемир',
  шерсть: 'Шерсть', шерсти: 'Шерсть',
  шёлк: 'Шёлк', шелк: 'Шёлк', шёлка: 'Шёлк', шелка: 'Шёлк',
  хлопок: 'Хлопок', хлопка: 'Хлопок',
  деним: 'Деним', денима: 'Деним',
  нейлон: 'Нейлон', нейлона: 'Нейлон',
  мех: 'Мех', меха: 'Мех',
  лён: 'Лён', лен: 'Лён', льна: 'Лён',
}

const MATERIAL_TEXT_RE = /(кож[а-яё]+|холст[а-яё]*|канвас[а-яё]*|замш[а-яё]*|нубук[а-яё]*|текстил[а-яё]*|кашемир[а-яё]*|шерст[а-яё]*|шёлк[а-яё]*|шелк[а-яё]*|хлоп[а-яё]+|деним[а-яё]*|нейлон[а-яё]*|мех[а-яё]*|лён|лен|льна)(?:\s+([A-Za-zÀ-ÿ][\wÀ-ÿ-]*(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ-]*){0,2}))?/gi

/**
 * Собирает материалы из текста описания: «сочетает кожу taurillon Regate и холст
 * H canvas» → [«Кожа Taurillon Regate», «Холст H canvas»]. Нужно для карточек без
 * блока «Материал:», иначе материал вообще не попадает в характеристики.
 */
export function materialsFromText(text: string | null | undefined) {
  const source = String(text || '')
  if (!source.trim()) return [] as string[]
  const found: string[] = []
  for (const match of source.matchAll(MATERIAL_TEXT_RE)) {
    const base = MATERIAL_WORD_FORMS[String(match[1]).toLowerCase()]
    if (!base) continue
    const rawQualifier = tidy(match[2])
    const qualifier = rawQualifier ? rawQualifier.charAt(0).toUpperCase() + rawQualifier.slice(1) : ''
    const value = qualifier ? `${base} ${qualifier}` : base
    if (!found.some((item) => item.toLowerCase() === value.toLowerCase())) found.push(value)
    if (found.length >= 3) break
  }
  return found
}

/**
 * Обычный цвет для атрибута «Цвет»: у формы Hermes «18/Etoupe» берём имя после
 * слэша, у русского названия с переводом в скобках — русское название.
 * Код Hermes уходит в отдельный атрибут «Цвет поставщика».
 */
export function plainColourName(display: string | null, primary: string | null) {
  const value = tidy(display)
  if (!value) return null
  const primaryValue = tidy(primary)
  // Русское название цвета («Черный» при внутреннем «ck89/Noir») важнее кода.
  if (primaryValue && /[А-Яа-яЁё]/.test(primaryValue)) return primaryValue
  const codeAndName = value.match(/^\S+\/(.+)$/)
  if (codeAndName) return capitalise(tidy(codeAndName[1]))
  return primaryValue || value
}

/** Имя цвета Hermes с заглавной буквы: «18/etoupe» → «18/Etoupe». */
export function capitaliseColourName(value: string | null | undefined) {
  const source = tidy(value)
  if (!source) return null
  const parts = source.match(/^(\S+)\/(.+)$/)
  if (parts) return `${parts[1]}/${capitalise(parts[2])}`
  return capitalise(source)
}

function capitalise(value: string) {
  const source = tidy(value)
  if (!source) return ''
  return source.charAt(0).toUpperCase() + source.slice(1)
}

/**
 * Цвет из свободного текста, когда поля «Цвет:» нет:
 * «выполнена в бордовом цвете» → «Бордовый», «в сером цвете» → «Серый».
 * Сложные случаи («в зелёно-бежевой гамме») не угадываются — их закрывает ИИ.
 */
export function colourFromText(text: string | null | undefined) {
  const source = tidy(text)
  if (!source) return null
  // \b не работает с кириллицей в JS (\w — только латиница), поэтому граница слова задана явно.
  const inColour = source.match(/(?:^|\s)в\s+([а-яё-]+?)(ом|ем|ой|ей)\s+цвете/iu)
  if (inColour) {
    const word = `${inColour[1]}ый`
    return word.charAt(0).toUpperCase() + word.slice(1)
  }
  const label = source.match(/цвет[а-яё]*\s*[-—:]\s*([а-яё][а-яё-]+)/iu)
  if (label) {
    const word = tidy(label[1])
    return word.charAt(0).toUpperCase() + word.slice(1)
  }
  return null
}

/** Разбирает описание опубликованной карточки Hermes на подтверждённые факты. */
export function parseHermesCardFacts(description: string | null | undefined): HermesCardFacts {
  const source = String(description ?? '')
  const parsed = parseCatalogFields(source)

  const colourRaw = cutAtFieldKey(parsed.colour) || colourFromText(descriptionBody(source) || source)
  const colour = pickHermesColour(colourRaw)
  const { code, name } = parseHermesColour(colour.raw)
  const colourDisplay = capitaliseColourName(
    colour.display && colour.display !== colour.raw
      ? colour.display
      : (hermesColourDisplay(code, name) || colour.display),
  )
  const material = fieldValue(source, 'Материал') || cutAtFieldKey(parsed.leather)
  const sizeRaw = cutAtFieldKey(parsed.size)
  const { numbers, range } = parseSize(sizeRaw)
  const body = descriptionBody(source)
  const hardware = resolveHardware(cutAtFieldKey(parsed.hardware), body)

  const hasFieldBlock = FIELD_KEYS.some((key) => new RegExp(`${key}\\s*[:：]`, 'i').test(source))
  const sizeKind: HermesCardFacts['sizeKind'] = range && numbers.length >= 2
    ? 'range'
    : numbers.length >= 2
      ? 'dimensions'
      : numbers.length === 1
        ? 'single'
        : 'unknown'

  return {
    style: cutAtFieldKey(parsed.style),
    colourRaw: colourRaw ? tidy(colourRaw) : null,
    colourCode: code,
    colourName: name,
    colourDisplay,
    colourPrimary: colour.primary ? tidy(colour.primary) : null,
    colourPlain: plainColourName(colourDisplay, colour.primary),
    colourGloss: colour.gloss,
    material: material ? tidy(material) : null,
    sizeRaw: sizeRaw ? tidy(sizeRaw) : null,
    sizeNumbers: numbers,
    sizeRange: range,
    sizeKind,
    hasFieldBlock,
    hardwareRaw: hardware.raw,
    hardwareKind: hardware.kind,
    hardwareConflict: hardware.conflict,
    body,
  }
}

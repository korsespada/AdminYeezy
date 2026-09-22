/**
 * Сопоставление старых колец Chromoff с моделями David Studio.
 *
 * Модуль намеренно чистый: здесь нет ни обращений к Rails, ни к ИИ, ни к БД.
 * Поэтому правила отбора кандидатов и разбор ответа модели проверяются
 * unit-тестами на реальных названиях, а не только на живом прогоне.
 *
 * Порядок работы:
 *   1. `rankRingCandidates` — дешёвый детерминированный отбор: общие токены
 *      названия, артикула, атрибута model_name и slug с названием и handle
 *      кандидата. Редкие токены весят больше, поэтому «Dagger Heart» решает,
 *      а «кольцо из серебра» — почти нет.
 *   2. `buildRingMatchPrompt` — промпт с раскладкой плиток contact sheet'ов.
 *   3. `parseRingMatchVerdict` — разбор ответа строго по индексу кандидата.
 *      Модель никогда не возвращает ID: индексы код превращает в handle сам.
 */

export interface RingAnchor {
  listingId: string
  productId: string
  slug: string
  name: string
  priceCents: number
  photos: string[]
  modelName: string
  seoArticle: string
  /** Металл и проба из характеристик карточки: материал обязан совпасть с моделью David. */
  metal: string
}

export interface RingCandidate {
  handle: string
  externalId: string
  title: string
  productId: string | null
  listingId: string | null
  slug: string | null
  photos: string[]
  created: boolean
  priceCents: number | null
  /** `chromoff` — очищенные фото из карточки, `mirror` — копия фото выгрузки на нашем S3. */
  photoSource: 'chromoff' | 'mirror' | 'catalog'
}

export interface RankedRingCandidate {
  candidate: RingCandidate
  score: number
  shared: string[]
}

/**
 * Слова, которые есть почти в каждом кольце и потому не различают модели.
 * Записи прогоняются через ту же канонизацию, что и токены: иначе «chrome»
 * остался бы в словаре, а из названия пришёл бы уже усечённый «chrom».
 */
const RING_TOKEN_STOPWORDS = new Set([
  'кольц', 'колец', 'kolts', 'koltc', 'сереб', 'sereb', 'chrome', 'ring', 'rings',
  'silver', 'sterling', 'with', 'and', 'the', 'для', 'из', 'мм', 'size', 'пробы',
].map((word) => canonicalRingToken(word)))

/**
 * Слова моделей (heart, dagger, fleur, matty, spinner) остаются токенами: у
 * Chrome Hearts они и есть название модели, и именно они различают пары вида
 * «Dagger Heart» / «Dagger Spacer» / «Double Dagger».
 */

/**
 * Канонизация токена: нижний регистр, ё → е, отсечение латинского
 * множественного «s» и усечение до 5 символов.
 *
 * Усечение — дешёвая замена стеммингу: «крестами» и «кресты» сходятся в
 * «крест», «спиннер» и «спиннером» — в «спинн», «diamonds» и «diamond» — в
 * «diamo». Для названий колец этого достаточно, а лишних зависимостей не надо.
 */
export function canonicalRingToken(raw: string): string {
  let token = String(raw || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim()
  if (!token) return ''
  if (/^[a-z]+$/.test(token) && token.length > 3 && token.endsWith('s')) {
    token = token.slice(0, -1)
  }
  return token.length > 5 ? token.slice(0, 5) : token
}

export function ringTokens(...values: Array<string | null | undefined>): string[] {
  const tokens = new Set<string>()
  for (const value of values) {
    for (const raw of String(value || '').split(/[^0-9A-Za-zА-Яа-яЁё]+/)) {
      if (/^\d+$/.test(raw)) continue
      const token = canonicalRingToken(raw)
      if (token.length < 3) continue
      if (RING_TOKEN_STOPWORDS.has(token)) continue
      tokens.add(token)
    }
  }
  return [...tokens]
}

/**
 * Токены «якоря» — старого товара. Артикул и slug вторичны: slug это та же
 * транслитерация названия, а артикул вообще не пересекается с David. Атрибут
 * `model_name` наоборот первичен — у старых карточек именно там лежит
 * латинская модель.
 */
export function anchorRingTokens(anchor: Pick<RingAnchor, 'name' | 'modelName' | 'seoArticle' | 'slug'>): string[] {
  return ringTokens(anchor.name, anchor.modelName, anchor.seoArticle, anchor.slug)
}

export function candidateRingTokens(candidate: Pick<RingCandidate, 'title' | 'handle'>): string[] {
  return ringTokens(candidate.title, candidate.handle)
}

/**
 * Вес токена внутри своей стороны. Название несёт смысл, slug и handle —
 * в основном служебные слова: «chrome-hearts-*-ring» есть у каждого
 * кандидата, и без понижения веса оно бы размывало разницу между моделями.
 */
const ANCHOR_NAME_WEIGHT = 1
const ANCHOR_SLUG_WEIGHT = 0.4
const CANDIDATE_TITLE_WEIGHT = 1
const CANDIDATE_HANDLE_WEIGHT = 0.5

function tokenWeights(primary: string[], secondary: string[]): Map<string, number> {
  const weights = new Map<string, number>()
  for (const token of secondary) weights.set(token, Math.max(weights.get(token) || 0, ANCHOR_SLUG_WEIGHT))
  for (const token of primary) weights.set(token, Math.max(weights.get(token) || 0, ANCHOR_NAME_WEIGHT))
  return weights
}

/**
 * Отбор кандидатов. Итоговый вес общего токена = IDF × вес у якоря × вес у
 * кандидата, поэтому пара «Dagger Heart / Dagger Heart» обходит «Dagger
 * Heart / Dagger Spacer», хотя handle'ы у обоих содержат chrome-hearts.
 *
 * Пара без единого общего токена не возвращается вовсе: такие якоря честнее
 * показать человеку как «кандидатов нет», чем гнать модель по случайным кольцам.
 */
export function rankRingCandidates(
  anchor: Pick<RingAnchor, 'name' | 'modelName' | 'seoArticle' | 'slug'>,
  candidates: RingCandidate[],
  options: { limit?: number } = {},
): RankedRingCandidate[] {
  const limit = Math.max(1, Number(options.limit || 6))
  const anchorWeights = tokenWeights(
    ringTokens(anchor.name, anchor.modelName),
    ringTokens(anchor.seoArticle, anchor.slug),
  )
  if (!anchorWeights.size || !candidates.length) return []

  const documentFrequency = new Map<string, number>()
  const candidateWeights = candidates.map((candidate) => {
    const weights = new Map<string, number>()
    for (const token of ringTokens(candidate.handle)) {
      weights.set(token, Math.max(weights.get(token) || 0, CANDIDATE_HANDLE_WEIGHT))
    }
    for (const token of ringTokens(candidate.title)) {
      weights.set(token, Math.max(weights.get(token) || 0, CANDIDATE_TITLE_WEIGHT))
    }
    for (const token of weights.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
    }
    return weights
  })

  const idf = (token: string) => 1 / (1 + Math.log(1 + (documentFrequency.get(token) || 0)))

  return candidates
    .map((candidate, index) => {
      const shared: string[] = []
      let score = 0
      for (const [token, candidateWeight] of candidateWeights[index]) {
        const anchorWeight = anchorWeights.get(token)
        if (!anchorWeight) continue
        shared.push(token)
        score += idf(token) * anchorWeight * candidateWeight
      }
      return { candidate, score: Number(score.toFixed(4)), shared: shared.sort() }
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => (
      right.score - left.score ||
      right.shared.length - left.shared.length ||
      left.candidate.handle.localeCompare(right.candidate.handle)
    ))
    .slice(0, limit)
}

export const RING_MATCH_SYSTEM_PROMPT = [
  'Ты сверяешь ювелирные кольца по фотографиям. Ответ — только JSON, без пояснений вокруг.',
  'Товар на первом листе — уже опубликованная карточка Chromoff. Дальше идут листы эталонов:',
  'каждый эталон это отдельная модель Chrome Hearts из каталога поставщика David Studio.',
  'Нужно решить, какая из моделей эталонов — то же самое изделие, что и товар.',
  '',
  'Правила:',
  '1. Совпадением считается только та же самая модель: совпадают форма, motif, ширина, расположение крестов, камней и гравировки.',
  '2. МАТЕРИАЛ ОБЯЗАН СОВПАСТЬ. Жёлтое золото, белое золото, розовое золото и серебро — это разные позиции, даже когда модель одна и та же. Если материал товара и эталона различается, верни match_index null и same_model false; в evidence напиши, какой материал у товара и какой у эталона.',
  '3. Камни и покрытие внутри одного материала совпадению не мешают: другой цвет или количество камней у той же модели — это та же модель с confidence не выше 0.8 и описанием разницы.',
  '4. Другая модель, даже похожая по motif или по общему слову в названии (например спиннер со Scroll против спиннера с крестом), — это НЕ совпадение.',
  '5. Если ни один эталон не подходит, верни match_index null и same_model false. Угадывать нельзя.',
  '6. Опирайся на фотографии. Названия — подсказка, а не доказательство: одинаковые названия бывают у разных моделей.',
  '',
  'Верни строго JSON вида {"match_index":2,"same_model":true,"confidence":0.93,"evidence":"что именно совпало и чем отличается"}.',
  'match_index — номер эталона из списка ниже; null, если совпадения нет.',
].join('\n')

/**
 * Промпт сравнения. Раскладку плиток задаёт вызывающий код, и он же её
 * описывает: первый лист — товар (плитки 1..anchorTileCount), далее эталоны,
 * где i-й эталон занимает плитки (i-1)*tilesPerCandidate+1 .. i*tilesPerCandidate.
 */
export function buildRingMatchPrompt(input: {
  anchor: Pick<RingAnchor, 'name' | 'priceCents' | 'modelName' | 'metal'>
  ranked: RankedRingCandidate[]
  anchorTileCount: number
  tilesPerCandidate: number
}): string {
  const lines = [
    `Товар: «${input.anchor.name}».`,
    input.anchor.modelName ? `Модель из характеристик карточки: ${input.anchor.modelName}.` : '',
    input.anchor.metal ? `Материал карточки: ${input.anchor.metal}. Он должен совпасть с материалом эталона.` : '',
    `На листе с фотографиями товара — плитки 1–${input.anchorTileCount}.`,
    'На следующих листах — эталоны моделей David Studio, плитки нумеруются заново в каждом листе и идут подряд по всем листам эталонов.',
    `Эталон i занимает плитки ${formatTileRange(1, input.tilesPerCandidate)}, затем ${formatTileRange(input.tilesPerCandidate + 1, input.tilesPerCandidate * 2)} и так далее.`,
    '',
    'Эталоны:',
  ]

  input.ranked.forEach((row, index) => {
    const first = index * input.tilesPerCandidate + 1
    const last = first + input.tilesPerCandidate - 1
    const shared = row.shared.length ? ` (общие слова с карточкой: ${row.shared.join(', ')})` : ''
    lines.push(`${index + 1}. ${row.candidate.title} — handle ${row.candidate.handle}${shared}; плитки ${first}–${last}.`)
  })

  lines.push('', `Ответь JSON: какой из ${input.ranked.length} эталонов — тот же товар.`)
  return lines.filter((line) => line !== '').join('\n')
}

function formatTileRange(first: number, last: number) {
  return `${first}–${last}`
}

export interface RingMatchVerdict {
  matchIndex: number | null
  handle: string | null
  confidence: number
  evidence: string
  sameModel: boolean
  invalidIndex: boolean
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Разбор ответа модели. Индекс вне списка кандидатов не превращается в
 * совпадение: это ошибка модели, и она честно возвращается флагом
 * `invalidIndex`, чтобы экран ревью показал её как проблему, а не как пару.
 */
export function parseRingMatchVerdict(raw: unknown, candidates: RingCandidate[]): RingMatchVerdict {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const sameModel = source.same_model !== false
  const hasIndex = source.match_index !== null && source.match_index !== undefined && source.match_index !== ''
  const rawIndex = hasIndex ? readNumber(source.match_index) : null
  const evidence = String(source.evidence || '').trim().slice(0, 600)
  const confidence = Math.min(1, Math.max(0, readNumber(source.confidence) ?? 0))

  if (!hasIndex) {
    return { matchIndex: null, handle: null, confidence, evidence, sameModel: false, invalidIndex: false }
  }
  // Индекс есть, но нечитаемый или вне списка: это ошибка модели, и она должна
  // быть видна на экране ревью, а не выглядеть как честное «совпадений нет».
  if (rawIndex === null || !Number.isInteger(rawIndex) || rawIndex < 1 || rawIndex > candidates.length) {
    return { matchIndex: null, handle: null, confidence: 0, evidence, sameModel: false, invalidIndex: true }
  }
  if (!sameModel) {
    return { matchIndex: null, handle: null, confidence, evidence, sameModel: false, invalidIndex: false }
  }

  return {
    matchIndex: rawIndex,
    handle: candidates[rawIndex - 1].handle,
    confidence,
    evidence,
    sameModel: true,
    invalidIndex: false,
  }
}

/** Порог, с которого пара уходит оператору как уверенное совпадение. */
export const RING_MATCH_CONFIDENT = 0.9
/** Ниже этого порога пара остаётся только подсказкой для ручного ревью. */
export const RING_MATCH_REVIEW = 0.6

/** Сколько моделей модель может назвать в черновом проходе по всему каталогу. */
export const RING_SWEEP_MAX = 5
/** Сколько фото одной модели показываем в подробном сравнении. */
export const RING_SWEEP_PHOTOS_PER_CANDIDATE = 3
/**
 * Размер пачки каталога в одном запросе чернового прохода.
 *
 * 27 плиток = три листа. Один большой запрос на весь каталог (105 плиток,
 * 12 листов) BYESU роняет с «system cpu overloaded», поэтому каталог идёт
 * пачками: запрос меньше, повторов меньше, прогресс виден.
 */
export const RING_SWEEP_CHUNK = 27

/** Режет каталог на пачки для запросов чернового прохода. */
export function chunkRingCandidates(candidates: RingCandidate[], size: number = RING_SWEEP_CHUNK): RingCandidate[][] {
  const chunkSize = Math.max(1, Math.floor(size) || 1)
  const chunks: RingCandidate[][] = []
  for (let index = 0; index < candidates.length; index += chunkSize) {
    chunks.push(candidates.slice(index, index + chunkSize))
  }
  return chunks
}

/**
 * Черновой проход по всему каталогу David.
 *
 * Нужен там, где отбор по названию не сработал: у старых колец вроде «Кольцо K&T»
 * или «Серебряное кольцо с камнями» нет модели в названии, и короткий список
 * кандидатов выходит пустым. Тогда модель смотрит по одной плитке на каждую
 * модель каталога и называет те, что вообще могут быть тем же изделием. Дальше
 * эти несколько кандидатов сравниваются подробно, по три фото на модель.
 */
export const RING_SWEEP_SYSTEM_PROMPT = [
  'Ты просматриваешь каталог ювелирных колец и ищешь то же изделие, что на фотографиях товара.',
  'Первый лист — фотографии товара Chrome Hearts. Следующие листы — каталог моделей David Studio,',
  'по одной плитке на модель; плитки пронумерованы подряд по всем листам каталога.',
  '',
  'Правила:',
  '1. Назови до ' + RING_SWEEP_MAX + ' плиток, которые МОГУТ быть тем же изделием. Это черновой отбор: лучше назвать лишнее, чем пропустить.',
  '2. Смотри на форму, motif (крест, кинжал, лилия, череп, звезда, бабочка), ширину и расположение камней.',
  '3. Материал должен совпадать: жёлтое золото, белое золото и серебро — разные позиции. Эталоны другого материала не называй.',
  '4. Другой цвет камня внутри того же материала — это всё ещё та же модель, называй её.',
  '5. Если ни одна плитка не похожа, верни пустой список: угадывать нельзя.',
  '',
  'Верни строго JSON вида {"candidates":[12,47,88],"confidence":0.4}.',
  'candidates — номера плиток каталога, максимум ' + RING_SWEEP_MAX + '.',
].join('\n')

export function buildRingSweepPrompt(input: {
  anchor: Pick<RingAnchor, 'name' | 'modelName' | 'metal'>
  candidates: RingCandidate[]
  anchorTileCount: number
}): string {
  const lines = [
    `Товар: «${input.anchor.name}».`,
    input.anchor.modelName ? `Модель из характеристик карточки: ${input.anchor.modelName}.` : '',
    input.anchor.metal ? `Материал карточки: ${input.anchor.metal}. Он должен совпасть с материалом эталона.` : '',
    `Фотографии товара — плитки 1–${input.anchorTileCount} на первом листе.`,
    `Каталог David Studio — плитки 1–${input.candidates.length} на следующих листах, по одной модели на плитку:`,
  ]
  input.candidates.forEach((candidate, index) => {
    lines.push(`${index + 1}. ${candidate.title} (${candidate.handle})`)
  })
  lines.push('', `Назови до ${RING_SWEEP_MAX} плиток каталога, которые могут быть тем же изделием.`)
  return lines.filter(Boolean).join('\n')
}

export function parseRingSweepVerdict(raw: unknown, candidates: RingCandidate[]): {
  handles: string[]
  confidence: number
  invalidIndexes: number[]
} {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const list = Array.isArray(source.candidates) ? source.candidates : []
  const confidence = Math.min(1, Math.max(0, readNumber(source.confidence) ?? 0))
  const handles: string[] = []
  const invalidIndexes: number[] = []

  for (const value of list) {
    const index = readNumber(value)
    if (index === null || !Number.isInteger(index) || index < 1 || index > candidates.length) {
      if (index !== null) invalidIndexes.push(index)
      continue
    }
    const handle = candidates[index - 1].handle
    if (!handles.includes(handle)) handles.push(handle)
    if (handles.length >= RING_SWEEP_MAX) break
  }

  return { handles, confidence, invalidIndexes }
}

export interface RingMergeResult {
  /** Патч товара для Rails: контент David, поверх старой карточки. */
  patch: Record<string, unknown>
  copied: {
    name: boolean
    description: boolean
    h1: boolean
    seoDescription: boolean
    attributes: string[]
    photos: number
  }
}

/**
 * Что именно переезжает в старую карточку.
 *
 * Правила, которые здесь закреплены:
 *   - название, h1, описание и SEO-описание берутся у David (это и был запрос);
 *   - характеристики сливаются: характеристики David перекрывают старые;
 *   - фото David идут первыми (они чистые и их больше), старые остаются следом
 *     без дублей по адресу — ни один снимок не теряется;
 *   - цена, варианты и статус не трогаются: у David цена нулевая, а смысл
 *     операции — сохранить живую карточку с ценой;
 *   - канон помечается индексируемым, иначе после удаления дубля страница
 *     исчезнет из поиска совсем.
 */
export function buildRingMergePatch(anchorProduct: any, davidProduct: any): RingMergeResult {
  const anchorMedia = Array.isArray(anchorProduct?.media) ? anchorProduct.media : []
  const davidMedia = Array.isArray(davidProduct?.media) ? davidProduct.media : []
  const davidUrls = new Set(davidMedia.map((medium: any) => String(medium?.original_url || '')))
  const keptAnchorMedia = anchorMedia.filter((medium: any) => !davidUrls.has(String(medium?.original_url || '')))

  const patch: Record<string, unknown> = {
    name: String(davidProduct?.name || anchorProduct?.name || ''),
    h1: String(davidProduct?.h1 || davidProduct?.name || anchorProduct?.h1 || ''),
    description: String(davidProduct?.description || anchorProduct?.description || ''),
    catalog_attributes: {
      ...(anchorProduct?.catalog_attributes && typeof anchorProduct.catalog_attributes === 'object' ? anchorProduct.catalog_attributes : {}),
      ...(davidProduct?.catalog_attributes && typeof davidProduct.catalog_attributes === 'object' ? davidProduct.catalog_attributes : {}),
    },
    media: [...davidMedia, ...keptAnchorMedia].map((medium: any, index: number) => ({
      original_url: medium?.original_url,
      thumb_url: medium?.thumb_url || medium?.original_url,
      preview_url: medium?.preview_url || medium?.original_url,
      og_image_url: medium?.og_image_url || medium?.original_url,
      alt_text: medium?.alt_text || davidProduct?.name || anchorProduct?.name || '',
      sort_order: index,
      processing_status: medium?.processing_status || 'processed',
    })),
  }

  const seoDescription = String(davidProduct?.seo_description || '')
  if (seoDescription) patch.seo_description = seoDescription
  if (String(anchorProduct?.indexing_status || '') !== 'indexable') patch.indexing_status = 'indexable'

  const davidAttributes = davidProduct?.catalog_attributes && typeof davidProduct.catalog_attributes === 'object'
    ? davidProduct.catalog_attributes
    : {}

  return {
    patch,
    copied: {
      name: Boolean(davidProduct?.name),
      description: Boolean(davidProduct?.description),
      h1: Boolean(davidProduct?.h1),
      seoDescription: Boolean(seoDescription),
      attributes: Object.keys(davidAttributes),
      photos: davidMedia.length,
    },
  }
}

import crypto from 'crypto'
import { canonicalBatchSuggestionKey, type BatchAiFamilyDefinition } from '@/lib/batch-ai'
import { canonicalClothingSubcategoryName } from '@/lib/clothing-taxonomy'

type QueryClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

const SUBCATEGORY_TOKEN_ALIASES: Record<string, string> = {
  сумки: 'сумка',
  сумок: 'сумка',
  ручками: 'ручка',
  ручкой: 'ручка',
  ручки: 'ручка',
  верхней: '',
  верхняя: '',
  верхние: '',
  косметички: 'косметичка',
  кейсы: 'кейс',
  клапаном: 'клапан',
  мини: 'мини',
  багет: 'багет',
  боулинг: 'боулинг',
  пляжные: 'пляжная',
}

export function subcategoryFamilyKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token && !['с', 'со'].includes(token))
    .map((token) => SUBCATEGORY_TOKEN_ALIASES[token] ?? token)
    .filter(Boolean)
    .sort()
    .join('_')
}

export function sameSubcategoryFamily(left: unknown, right: unknown) {
  const leftTokens = subcategoryFamilyKey(left).split('_').filter(Boolean)
  const rightTokens = subcategoryFamilyKey(right).split('_').filter(Boolean)
  if (!leftTokens.length || !rightTokens.length) return false
  if (leftTokens.join('_') === rightTokens.join('_')) return true
  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)
  const shared = leftTokens.filter((token) => rightSet.has(token)).length
  const shorter = Math.min(leftSet.size, rightSet.size)
  return shared >= 2 && shared === shorter
}

function redirectsToShoulderBags(value: unknown) {
  return [
    'косметичка_сумка',
    'кейс_сумка',
    'клапан_сумка',
    'багет_сумка',
    'мини_сумка',
    'боулинг_сумка',
    'пляжная_сумка',
    'ручка_сумка',
  ].includes(subcategoryFamilyKey(value))
}

function isGenericBagsSubcategory(value: unknown) {
  return subcategoryFamilyKey(value) === 'сумка'
}

function shoulderBagsMapping(rows: any[]) {
  return rows.find((row) => String(row.name || '').trim().toLowerCase().replace(/ё/g, 'е') === 'сумки на плечо')
}

function normalizedTokens(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => String(item || '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(Boolean)
}

const COLOR_TOKEN_ALIASES: Record<string, string> = {
  white: 'белый',
  black: 'черный',
  beige: 'бежевый',
  pink: 'розовый',
  blue: 'синий',
  red: 'красный',
  green: 'зеленый',
  grey: 'серый',
  gray: 'серый',
  brown: 'коричневый',
  yellow: 'желтый',
  orange: 'оранжевый',
  purple: 'фиолетовый',
  gold: 'золотой',
  silver: 'серебристый',
}

function normalizedColorTokens(value: unknown) {
  return normalizedTokens(value).map((token) => COLOR_TOKEN_ALIASES[token] || token)
}

export function normalizedColorFamilyValue(value: unknown) {
  return [...new Set(normalizedColorTokens(value))].sort().join(' ')
}

const BASE_COLOR_PATTERNS: Array<[RegExp, string]> = [
  [/(графит|сер|silver|grey|gray)/i, 'Серый'],
  [/(молоч|крем|айвори|слонов|бел|white|ivory)/i, 'Белый'],
  [/(песоч|карамел|беж|beige|camel)/i, 'Бежевый'],
  [/(голуб|лазур|бирюз|син|navy|blue)/i, 'Синий'],
  [/(черн|black)/i, 'Чёрный'],
  [/(корич|шоколад|кофе|brown)/i, 'Коричневый'],
  [/(бордов|винн|красн|red|burgundy)/i, 'Красный'],
  [/(хаки|олив|зелен|зелён|green)/i, 'Зелёный'],
  [/(розов|pink)/i, 'Розовый'],
  [/(фиолет|сирен|purple)/i, 'Фиолетовый'],
  [/(желт|жёлт|yellow)/i, 'Жёлтый'],
  [/(оранж|orange)/i, 'Оранжевый'],
]

export function inferBaseColor(value: unknown) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '')
  return BASE_COLOR_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] || text.trim()
}

const AUTO_SHADE_LABELS: Record<string, string[]> = {
  серый: ['Светло-серый', 'Серый', 'Графитовый', 'Антрацитовый', 'Серо-коричневый', 'Серо-синий'],
  белый: ['Белый', 'Молочный', 'Айвори', 'Кремовый', 'Слоновая кость'],
  бежевый: ['Светло-бежевый', 'Бежевый', 'Песочный', 'Тауп', 'Карамельный'],
  синий: ['Светло-синий', 'Синий', 'Темно-синий', 'Чернильно-синий', 'Джинсовый', 'Сине-серый'],
  черный: ['Чёрный', 'Угольный', 'Глубокий чёрный', 'Графитово-чёрный'],
  коричневый: ['Светло-коричневый', 'Коричневый', 'Шоколадный', 'Кофейный', 'Коньячный'],
  красный: ['Красный', 'Бордовый', 'Винный', 'Терракотовый'],
  зеленый: ['Светло-зелёный', 'Зелёный', 'Оливковый', 'Хаки'],
  розовый: ['Светло-розовый', 'Розовый', 'Пудровый', 'Пыльно-розовый'],
  фиолетовый: ['Светло-фиолетовый', 'Фиолетовый', 'Сливовый', 'Сиреневый'],
  желтый: ['Светло-жёлтый', 'Жёлтый', 'Горчичный', 'Золотистый'],
  оранжевый: ['Светло-оранжевый', 'Оранжевый', 'Медный', 'Терракотовый'],
  разноцветный: ['Разноцветный', 'Мультиколор', 'Контрастный мультиколор', 'Многоцветный'],
}

export function ensureUniqueFamilyColors(products: any[], suggestedColors: Record<string, { color?: string; base_color?: string; confidence?: number }> = {}) {
  const used = new Set<string>()
  const nextByBase = new Map<string, number>()
  const result: Record<string, { color: string; base_color: string; confidence: number }> = {}
  for (const product of products) {
    const productId = String(product.id)
    const suggestion = suggestedColors[productId] || {}
    const current = Array.isArray(product.attributes?.colors) ? String(product.attributes.colors[0] || '') : ''
    const baseColor = String(suggestion.base_color || inferBaseColor(suggestion.color || current)).trim().slice(0, 80)
    let color = String(suggestion.color || current).trim().slice(0, 80)
    const normalized = normalizedColorFamilyValue(color)
    const baseKey = String(baseColor || inferBaseColor(color)).trim().toLowerCase().replace(/ё/g, 'е')
    if (!color || (normalized && !used.has(normalized))) {
      if (normalized) used.add(normalized)
    } else {
      const labels = AUTO_SHADE_LABELS[baseKey] || [`${baseColor} светлый`, baseColor, `${baseColor} тёмный`, `${baseColor} глубокий`]
      let cursor = nextByBase.get(baseKey) || 0
      let candidate = ''
      while (cursor < labels.length) {
        const next = labels[cursor++]
        if (!used.has(normalizedColorFamilyValue(next))) {
          candidate = next
          break
        }
      }
      if (!candidate) {
        let suffix = 2
        do { candidate = `${baseColor} ${suffix++}` } while (used.has(normalizedColorFamilyValue(candidate)))
      }
      nextByBase.set(baseKey, cursor)
      color = candidate
      used.add(normalizedColorFamilyValue(color))
    }
    if (color) {
      result[productId] = {
        color,
        base_color: baseColor || inferBaseColor(color),
        confidence: Number(suggestion.confidence || 0),
      }
    }
  }
  return result
}

const MATERIAL_CONSTRUCTION_TOKENS = new Set([
  'трикотаж', 'трикотажный', 'трикотажная', 'трикотажное', 'вязка', 'вязаный', 'вязаная',
  'knit', 'knitted', 'jersey',
])

function normalizedMaterialTokens(value: unknown) {
  return normalizedTokens(value).filter((token) => !MATERIAL_CONSTRUCTION_TOKENS.has(token))
}

export function sourceVariantCode(product: any) {
  const modelCode = String(product?.attributes?.model_code || '').trim()
  if (modelCode) return modelCode
  const variantKey = String(product?.variant_group_key || '').trim()
  // Одобренные семейства получают технический sha256-ключ. Он не является
  // артикулом поставщика и не должен мешать повторной визуальной пересборке.
  return /^[0-9a-f]{32}$/i.test(variantKey) ? '' : variantKey
}

export function canonicalColorFamilyKey(suggestion: any) {
  const signatureTokens = normalizedTokens(suggestion?.group_signature || suggestion?.code)
  const colorTokens = new Set([
    ...normalizedTokens(suggestion?.color),
    ...normalizedColorTokens(suggestion?.color),
  ])
  const withoutColor = signatureTokens.filter((token) => !colorTokens.has(token) && !colorTokens.has(COLOR_TOKEN_ALIASES[token] || token))
  return [...new Set(withoutColor)].join('_')
}

function stableField(value: unknown) {
  return [...new Set(normalizedTokens(value))].sort().join('_')
}

function stableDimensions(value: unknown) {
  const text = Array.isArray(value) ? value.join(' × ') : String(value || '')
  const numbers = text
    .replace(/,/g, '.')
    .match(/\d+(?:\.\d+)?/g)
    ?.map((number) => String(Number(number)))
    .filter(Boolean)
  return numbers?.length ? numbers.join('x') : stableField(value)
}

export function canonicalProductColorFamilyKey(product: any, suggestion: any = {}) {
  const attributes = product?.attributes || {}
  const colorTokens = new Set([
    ...normalizedColorTokens(attributes.colors),
    ...normalizedColorTokens(suggestion?.color),
  ])
  const name = normalizedTokens(product?.name)
    .filter((token) => !colorTokens.has(COLOR_TOKEN_ALIASES[token] || token))
    .join('_')
  const dimensions = attributes.dimensions
    || ([attributes.bag_width_cm, attributes.bag_height_cm].filter(Boolean).join('x'))
    || suggestion?.bag_size
  const sourceCode = sourceVariantCode(product)
  if (sourceCode) {
    return [
      'source',
      stableField(product?.brand),
      stableField(product?.category),
      normalizedProductName(product),
      stableField(sourceCode),
    ].join('|')
  }
  return [
    stableField(product?.brand),
    stableField(product?.category),
    stableField(product?.subcategory),
    name,
    stableField(attributes.model_name || suggestion?.model_name),
    stableDimensions(dimensions),
    [...new Set(normalizedMaterialTokens(attributes.materials || suggestion?.materials))].sort().join('_'),
    stableField(attributes.hardware_color || suggestion?.hardware),
  ].join('|')
}

function normalizedProductName(product: any) {
  const colors = new Set(normalizedColorTokens(product?.attributes?.colors))
  return normalizedTokens(product?.name)
    .filter((token) => !colors.has(COLOR_TOKEN_ALIASES[token] || token))
    .join('_')
}

export function colorFamilyRebuildPlan(products: any[], options: { includeSequentialCandidates?: boolean } = {}) {
  const coded = new Map<string, any[]>()
  const visual = new Map<string, any[]>()
  for (const product of products) {
    const sourceCode = sourceVariantCode(product)
    if (sourceCode) {
      const key = canonicalProductColorFamilyKey(product)
      coded.set(key, [...(coded.get(key) || []), product])
      continue
    }
    const key = [
      stableField(product?.brand),
      stableField(product?.category),
      stableField(product?.subcategory),
      normalizedProductName(product),
      stableField(product?.attributes?.model_name),
      [...new Set(normalizedMaterialTokens(product?.attributes?.materials))].sort().join('_'),
    ].join('|')
    if (!normalizedProductName(product)) continue
    visual.set(key, [...(visual.get(key) || []), product])
  }

  const deterministicFamilies = [...coded.entries()].flatMap(([identityKey, family]) => {
    const byColor = new Map<string, any[]>()
    for (const product of family) {
      const color = normalizedColorTokens(product?.attributes?.colors).join(' ')
      if (!color) continue
      byColor.set(color, [...(byColor.get(color) || []), product])
    }
    if (family.length < 2) return []
    return [{
      identityKey,
      sourceCode: sourceVariantCode(family[0]),
      products: family,
      duplicateProducts: [],
      colorConflicts: [...byColor.entries()].flatMap(([color, sameColor]) => (
        sameColor.length > 1 ? [{ color, productIds: sameColor.map((product) => Number(product.id)) }] : []
      )),
      colors: [...byColor.keys()].sort(),
    }]
  })

  const shadeCandidates = deterministicFamilies.flatMap((family) => {
    if (!family.colorConflicts.length || family.products.length > 12) return []
    const products = family.products.filter((product) => Array.isArray(product?.photos) && product.photos[0])
    return products.length >= 2 ? [{
      identityKey: family.identityKey,
      sourceCode: family.sourceCode,
      products,
    }] : []
  })

  const visualCandidates = [...visual.entries()].flatMap(([candidateKey, family]) => {
    const seenPhotos = new Set<string>()
    const withPhotos = family.filter((product) => {
      const photo = Array.isArray(product?.photos) ? String(product.photos[0] || '') : ''
      if (!photo || seenPhotos.has(photo)) return false
      seenPhotos.add(photo)
      return true
    })
    const colors = new Set(withPhotos.flatMap((product) => normalizedColorTokens(product?.attributes?.colors)))
    return withPhotos.length >= 2 && withPhotos.length <= 12 && colors.size >= 1
      ? [{ candidateKey, products: withPhotos }]
      : []
  })

  const existingVisualProductIds = new Set(visualCandidates.flatMap((candidate) => candidate.products.map((product) => Number(product.id))))
  const sequentialCandidates = options.includeSequentialCandidates
    ? sequentialColorFamilyCandidates(products, existingVisualProductIds)
    : []

  return { deterministicFamilies, visualCandidates: [...visualCandidates, ...sequentialCandidates], shadeCandidates }
}

function sequentialColorFamilyCandidates(products: any[], excludedProductIds: Set<number>) {
  const ordered = [...products]
    .filter((product) => !excludedProductIds.has(Number(product?.id)))
    .sort((left, right) => Number(left?.source_position ?? Number.MAX_SAFE_INTEGER) - Number(right?.source_position ?? Number.MAX_SAFE_INTEGER)
      || Number(left?.id || 0) - Number(right?.id || 0))
  const result: Array<{ candidateKey: string; products: any[] }> = []
  let run: any[] = []
  const flush = () => {
    if (run.length >= 2) {
      result.push({ candidateKey: `sequential|${run.map((product) => Number(product.id)).join('|')}`, products: run })
    }
    run = []
  }
  for (const product of ordered) {
    if (!hasComparableFirstPhoto(product)) {
      flush()
      continue
    }
    const previous = run[run.length - 1]
    const positionsAreAdjacent = previous
      ? (() => {
          const leftPosition = Number(previous?.source_position)
          const rightPosition = Number(product?.source_position)
          return !Number.isFinite(leftPosition) || !Number.isFinite(rightPosition) || rightPosition - leftPosition <= 1
        })()
      : true
    const sameCatalogScope = !previous
      || (String(previous?.brand || '') === String(product?.brand || '') && String(previous?.category || '') === String(product?.category || ''))
    if (!positionsAreAdjacent || !sameCatalogScope || run.length >= 8) flush()
    run.push(product)
  }
  flush()
  return result
}

function hasComparableFirstPhoto(product: any) {
  return Array.isArray(product?.photos) && Boolean(product.photos[0])
}

export function normalizeShadeScanOutput(raw: any, candidates: any[]) {
  const seenIndexes = new Set<number>()
  return (Array.isArray(raw?.variants) ? raw.variants : []).flatMap((variant: any) => {
    const index = Number(variant?.product_index)
    const confidence = Number(variant?.confidence || 0)
    if (!Number.isInteger(index) || index < 1 || index > candidates.length || seenIndexes.has(index) || confidence < 0.8) return []
    seenIndexes.add(index)
    const color = String(variant?.color || '').trim()
    if (!color) return []
    const duplicateOfIndex = Number(variant?.duplicate_of_index || 0)
    return [{
      product: candidates[index - 1],
      color,
      baseColor: String(variant?.base_color || inferBaseColor(color)).trim(),
      duplicateOfProductId: confidence >= 0.9
        && Number.isInteger(duplicateOfIndex)
        && duplicateOfIndex > 0
        && duplicateOfIndex <= candidates.length
        && duplicateOfIndex !== index
        ? Number(candidates[duplicateOfIndex - 1]?.id)
        : null,
      confidence,
    }]
  })
}

export function normalizeVisualFamilyScanOutput(raw: any, candidates: any[]) {
  const used = new Set<number>()
  return (Array.isArray(raw?.families) ? raw.families : []).flatMap((family: any) => {
    const confidence = Number(family?.confidence || 0)
    if (confidence < 0.9) return []
    const variants = Array.isArray(family?.variants) ? family.variants : []
    if (variants.length) {
      const selectedIndexes: number[] = []
      const suggestedColors: Record<string, { color: string; base_color: string; confidence: number }> = {}
      const duplicateProducts: any[] = []
      const products = variants.flatMap((variant: any) => {
        const index = Number(variant?.product_index)
        if (!Number.isInteger(index) || index < 1 || index > candidates.length || used.has(index) || selectedIndexes.includes(index)) return []
        const product = candidates[index - 1]
        const color = String(variant?.color || '').trim().slice(0, 80)
        if (!color) return []
        selectedIndexes.push(index)
        suggestedColors[String(product.id)] = {
          color,
          base_color: String(variant?.base_color || inferBaseColor(color)).trim().slice(0, 80),
          confidence: Number(variant?.confidence || confidence),
        }
        const duplicateOfIndex = Number(variant?.duplicate_of_index || 0)
        if (Number.isInteger(duplicateOfIndex) && duplicateOfIndex > 0 && duplicateOfIndex <= candidates.length && duplicateOfIndex !== index) {
          duplicateProducts.push(product)
        }
        return [product]
      })
      if (products.length < 2) return []
      selectedIndexes.forEach((index) => used.add(index))
      return [{
        products,
        suggestedColors,
        duplicateProducts,
        label: String(family?.label || products[0]?.name || 'Цветовые варианты').trim(),
        confidence,
        matchingEvidence: String(family?.matching_evidence || 'Совпадение подтверждено сравнением фотографий.').trim(),
      }]
    }
    const seenColors = new Set<string>()
    const selectedIndexes: number[] = []
    const indexes = [...new Set<number>((family?.product_indexes || []).map((value: unknown) => Number(value)))]
    const products = indexes.flatMap((index: number) => {
      if (!Number.isInteger(index) || index < 1 || index > candidates.length || used.has(index)) return []
      const candidate = candidates[index - 1]
      const color = normalizedColorTokens(candidate?.attributes?.colors).join(' ')
      if (!color || seenColors.has(color)) return []
      seenColors.add(color)
      selectedIndexes.push(index)
      return [candidate]
    })
    if (products.length < 2 || seenColors.size < 2) return []
    selectedIndexes.forEach((index) => used.add(index))
    return [{
      products,
      label: String(family?.label || products[0]?.name || 'Цветовые варианты').trim(),
      confidence,
      matchingEvidence: String(family?.matching_evidence || 'Совпадение подтверждено сравнением фотографий.').trim(),
    }]
  })
}

function observedColors(payload: any, nextColor?: unknown) {
  return [...new Set([
    ...(Array.isArray(payload?.observed_colors) ? payload.observed_colors : []),
    payload?.color,
    nextColor,
  ].flatMap(normalizedColorTokens))].sort()
}

function suggestionsFromOutput(normalized: any) {
  const suggestions = [...(normalized.suggestions || [])]
  if (normalized.subcategorySuggestion?.name) {
    suggestions.push({ ...normalized.subcategorySuggestion, kind: 'subcategory', code: normalized.subcategorySuggestion.name })
  }
  if (normalized.colorFamily?.group_signature && normalized.colorFamily.confidence >= 0.75) {
    suggestions.push({ ...normalized.colorFamily, kind: 'color_family', code: normalized.colorFamily.group_signature })
  }
  return suggestions
}

async function catalogSubcategories(client: QueryClient, parentId?: string) {
  const result = await client.query(`
    SELECT canonical_id,name,canonical_parent_id
    FROM catalog_id_mappings
    WHERE entity_type='subcategory'
      AND ($1='' OR canonical_parent_id=$1)
  `, [parentId || ''])
  return result.rows
}

export async function saveBatchAiSuggestions(
  client: QueryClient,
  runId: string,
  productId: number,
  normalized: any,
) {
  const run = await client.query(`
    SELECT r.batch_id,b.supplier_id
    FROM batch_ai_runs r JOIN scraping_batches b ON b.id=r.batch_id
    WHERE r.id=$1
  `, [runId])
  const batchId = String(run.rows[0]?.batch_id || '')
  const supplierId = Number(run.rows[0]?.supplier_id || 0)
  if (batchId) await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const rejected = supplierId ? await client.query(`
    SELECT s.kind,s.canonical_key,s.payload FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    JOIN scraping_batches b ON b.id=r.batch_id
    WHERE b.supplier_id=$1 AND s.status='rejected'
  `, [supplierId]) : { rows: [] }

  for (const suggestion of suggestionsFromOutput(normalized)) {
    const kind = suggestion.kind || 'attribute'
    let key = canonicalBatchSuggestionKey(suggestion.code || suggestion.name, kind)
    if (!key) continue

    if (kind === 'subcategory') {
      const familyKey = subcategoryFamilyKey(suggestion.name || suggestion.code)
      if (!familyKey) continue
      const parentId = String(suggestion.parent_category_id || '')
      const mappings = await catalogSubcategories(client, parentId)
      if (redirectsToShoulderBags(suggestion.name || suggestion.code)) {
        const shoulderBags = shoulderBagsMapping(mappings)
        if (shoulderBags) {
          await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=$2', [
            String(shoulderBags.canonical_id),
            productId,
          ])
        }
        continue
      }
      if (isGenericBagsSubcategory(suggestion.name || suggestion.code)) continue
      if (rejected.rows.some((row) => (
        row.kind === 'subcategory'
        && sameSubcategoryFamily(row.payload?.name || row.payload?.code || row.canonical_key, suggestion.name || suggestion.code)
      ))) continue
      key = familyKey
      const existing = mappings.find((row) => sameSubcategoryFamily(row.name, suggestion.name || suggestion.code))
      if (existing) {
        await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=$2', [String(existing.canonical_id), productId])
        continue
      }

      const pending = await client.query(`
        SELECT s.id,s.payload FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id
        WHERE r.batch_id=$1 AND s.kind='subcategory' AND s.status='pending'
        ORDER BY s.created_at
      `, [batchId])
      const sameFamily = pending.rows.find((row) => {
        const payload = row.payload || {}
        return sameSubcategoryFamily(payload.name || payload.code, suggestion.name || suggestion.code)
          && (!parentId || !payload.parent_category_id || String(payload.parent_category_id) === parentId)
      })
      if (sameFamily) {
        await client.query(`
          UPDATE batch_ai_suggestions SET
            affected_product_ids=(
              SELECT jsonb_agg(DISTINCT value)
              FROM jsonb_array_elements(affected_product_ids || $2::jsonb)
            )
          WHERE id=$1
        `, [sameFamily.id, JSON.stringify([productId])])
        continue
      }
    }

    if (kind === 'color_family') {
      const identityKey = canonicalProductColorFamilyKey(normalized.product, suggestion)
      if (!identityKey) continue
      suggestion.product_identity_key = identityKey
      key = crypto.createHash('sha256').update(identityKey).digest('hex')
      if (rejected.rows.some((row) => (
        row.kind === 'color_family'
        && row.payload?.product_identity_key === identityKey
      ))) continue
      const pending = await client.query(`
        SELECT s.id,s.payload,p.name,p.brand,p.category,p.subcategory,p.attributes,p.variant_group_key
        FROM batch_ai_suggestions s
        JOIN batch_ai_runs r ON r.id=s.run_id
        LEFT JOIN products p ON p.id=(s.affected_product_ids->>0)::int
        WHERE r.batch_id=$1 AND s.kind='color_family' AND s.status='pending'
        ORDER BY s.created_at
      `, [batchId])
      const sameFamily = pending.rows.find((row) => (
        (row.payload?.product_identity_key || canonicalProductColorFamilyKey(row, row.payload)) === identityKey
      ))
      if (sameFamily) {
        const payload = {
          ...sameFamily.payload,
          observed_colors: observedColors(sameFamily.payload, suggestion.color),
        }
        await client.query(`
          UPDATE batch_ai_suggestions SET
            payload=$2::jsonb,
            affected_product_ids=(
              SELECT jsonb_agg(DISTINCT value)
              FROM jsonb_array_elements(affected_product_ids || $3::jsonb)
            )
          WHERE id=$1
        `, [sameFamily.id, JSON.stringify(payload), JSON.stringify([productId])])
        continue
      }
      suggestion.observed_colors = observedColors(suggestion)
    }

    if (kind === 'attribute' && rejected.rows.some((row) => (
      row.kind === 'attribute'
      && canonicalBatchSuggestionKey(row.payload?.code || row.canonical_key, 'attribute') === key
    ))) continue

    await client.query(`
      INSERT INTO batch_ai_suggestions(id,run_id,kind,canonical_key,payload,affected_product_ids)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
      ON CONFLICT(run_id,kind,canonical_key) DO UPDATE SET
        payload=EXCLUDED.payload,
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(batch_ai_suggestions.affected_product_ids || EXCLUDED.affected_product_ids)
        )
    `, [crypto.randomUUID(), runId, kind, key, JSON.stringify(suggestion), JSON.stringify([productId])])
  }
}

export async function savePreparedColorFamilySuggestion(
  client: QueryClient,
  runId: string,
  input: {
    identityKey: string
    products: any[]
    source: 'internal_code' | 'visual_comparison'
    sourceCode?: string
    confidence: number
    matchingEvidence: string
    duplicateProducts?: any[]
    colorConflicts?: Array<{ color: string; productIds: number[] }>
    suggestedColors?: Record<string, { color: string; base_color?: string; confidence?: number }>
    familyDefinition?: BatchAiFamilyDefinition
  },
) {
  const affectedProductIds = input.products.map((product) => Number(product.id)).filter(Number.isInteger)
  if (affectedProductIds.length < 2) return
  const suggestedColors = ensureUniqueFamilyColors(input.products, input.suggestedColors || {})
  const colors = [...new Set(input.products.flatMap((product) => {
    const suggested = suggestedColors[String(product.id)]?.color
    return normalizedColorTokens(suggested || product?.attributes?.colors)
  }))].sort()
  const byColor = new Map<string, number[]>()
  for (const product of input.products) {
    const color = normalizedColorFamilyValue(suggestedColors[String(product.id)]?.color || product?.attributes?.colors)
    if (color) byColor.set(color, [...(byColor.get(color) || []), Number(product.id)])
  }
  const colorConflicts = [...byColor.entries()].flatMap(([color, productIds]) => (
    productIds.length > 1 ? [{ color, productIds }] : []
  ))
  if (colors.length < 2 && !colorConflicts.length) return
  const canonicalKey = crypto.createHash('sha256').update(input.identityKey).digest('hex')
  const first = input.products[0]
  const payload = {
    kind: 'color_family',
    code: input.sourceCode || input.identityKey,
    group_signature: input.sourceCode || first?.attributes?.model_name || first?.name || 'Цветовые варианты',
    model_name: input.sourceCode || first?.attributes?.model_name || '',
    color: normalizedColorTokens(first?.attributes?.colors).join(' '),
    observed_colors: colors,
    matching_evidence: input.matchingEvidence,
    confidence: input.confidence,
    source: input.source,
    source_model_code: input.sourceCode || '',
    product_identity_key: input.identityKey,
    excluded_duplicate_product_ids: (input.duplicateProducts || []).map((product) => Number(product.id)).filter(Number.isInteger),
    color_conflicts: colorConflicts,
    suggested_colors: suggestedColors,
    suggested_duplicate_product_ids: (input.duplicateProducts || []).map((product) => Number(product.id)).filter(Number.isInteger),
    family_definition: input.familyDefinition || null,
  }
  await client.query(`
    INSERT INTO batch_ai_suggestions(id,run_id,kind,canonical_key,payload,affected_product_ids)
    VALUES($1,$2,'color_family',$3,$4::jsonb,$5::jsonb)
    ON CONFLICT(run_id,kind,canonical_key) DO UPDATE SET
      payload=EXCLUDED.payload,
      affected_product_ids=EXCLUDED.affected_product_ids,
      status='pending',
      reviewed_at=NULL
  `, [crypto.randomUUID(), runId, canonicalKey, JSON.stringify(payload), JSON.stringify(affectedProductIds)])
}

export async function applyShadeVariantsToSuggestion(client: QueryClient, runId: string, normalized: any) {
  const variants = Array.isArray(normalized.shadeVariants) ? normalized.shadeVariants : []
  const identityKey = String(normalized.familyIdentityKey || '')
  if (!variants.length || !identityKey) return
  const canonicalKey = crypto.createHash('sha256').update(identityKey).digest('hex')
  const suggestion = await client.query(`
    SELECT id,payload,affected_product_ids
    FROM batch_ai_suggestions
    WHERE run_id=$1 AND kind='color_family' AND canonical_key=$2
    LIMIT 1
  `, [runId, canonicalKey])
  const row = suggestion.rows[0]
  if (!row) return

  const duplicateIds = new Set<number>()
  for (const variant of variants) {
    if (variant.duplicateOfProductId) duplicateIds.add(Number(variant.product.id))
  }
  const affectedIds = (row.affected_product_ids || []).map(Number)
  const products = affectedIds.length
    ? await client.query('SELECT id,attributes FROM products WHERE id=ANY($1::int[])', [affectedIds])
    : { rows: [] }
  const variantsByProductId = new Map(variants.map((variant: any) => [Number(variant.product?.id), variant]))
  const suggestedColors: Record<string, { color: string; base_color: string; confidence: number }> = {}
  for (const product of products.rows) {
    const productId = Number(product.id)
    const variant: any = variantsByProductId.get(productId)
    const originalColor = Array.isArray(product.attributes?.colors) ? String(product.attributes.colors[0] || '') : ''
    const suggestedColor = !duplicateIds.has(productId) && variant?.color
      ? String(variant.color).trim().slice(0, 80)
      : originalColor
    const baseColor = String(variant?.baseColor || inferBaseColor(suggestedColor)).trim().slice(0, 80)
    if (suggestedColor) {
      suggestedColors[String(productId)] = {
        color: suggestedColor,
        base_color: baseColor,
        confidence: Number(variant?.confidence || 0),
      }
    }
  }
  const uniqueSuggestedColors = ensureUniqueFamilyColors(products.rows, suggestedColors)
  const payload = {
    ...(row.payload || {}),
    observed_colors: Object.values(uniqueSuggestedColors).map((item) => item.color),
    base_colors: [...new Set(Object.values(uniqueSuggestedColors).map((item) => item.base_color).filter(Boolean))].sort(),
    suggested_colors: uniqueSuggestedColors,
    color_conflicts: [...Object.entries(uniqueSuggestedColors).reduce((map, [productId, item]) => {
      const color = normalizedColorFamilyValue(item.color)
      if (color) map.set(color, [...(map.get(color) || []), Number(productId)])
      return map
    }, new Map<string, number[]>()).entries()].flatMap(([color, productIds]) => (
      productIds.length > 1 ? [{ color, productIds }] : []
    )),
    suggested_duplicate_product_ids: [...duplicateIds],
    shade_comparison: 'completed',
  }
  await client.query(`
    UPDATE batch_ai_suggestions
    SET payload=$2::jsonb,affected_product_ids=$3::jsonb
    WHERE id=$1
  `, [row.id, JSON.stringify(payload), JSON.stringify(affectedIds)])
}

export async function reconcileBatchColorFamilySuggestions(client: QueryClient, batchId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const result = await client.query(`
    SELECT s.*,p.name,p.brand,p.category,p.subcategory,p.attributes,p.variant_group_key
    FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    LEFT JOIN products p ON p.id=(s.affected_product_ids->>0)::int
    WHERE r.batch_id=$1 AND s.kind='color_family' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  const firstByFamily = new Map<string, any>()
  for (const row of result.rows) {
    const affectedIds = Array.isArray(row.affected_product_ids) ? row.affected_product_ids.map(Number) : []
    const affectedProducts = affectedIds.length
      ? await client.query(`
          SELECT id,name,brand,category,subcategory,attributes,variant_group_key
          FROM products WHERE id=ANY($1::int[])
          ORDER BY array_position($1::int[],id)
        `, [affectedIds])
      : { rows: [] }
    const firstProduct = affectedProducts.rows[0]
    if (!firstProduct) {
      await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }
    const prepared = ['internal_code', 'visual_comparison'].includes(String(row.payload?.source || ''))
    const familyKey = prepared
      ? String(row.payload?.product_identity_key || '')
      : canonicalProductColorFamilyKey(firstProduct, row.payload)
    if (!familyKey) continue
    const matchingProducts = prepared
      ? affectedProducts.rows
      : affectedProducts.rows.filter((product) => (
          canonicalProductColorFamilyKey(product, row.payload) === familyKey
        ))
    const productColors = matchingProducts.flatMap((product) => normalizedColorTokens(product.attributes?.colors))
    const cleanedPayload = {
      ...row.payload,
      product_identity_key: familyKey,
      observed_colors: [...new Set(productColors)].sort(),
    }
    await client.query(`
      UPDATE batch_ai_suggestions
      SET payload=$2::jsonb,affected_product_ids=$3::jsonb
      WHERE id=$1
    `, [row.id, JSON.stringify(cleanedPayload), JSON.stringify(matchingProducts.map((product) => product.id))])
    row.payload = cleanedPayload
    row.affected_product_ids = matchingProducts.map((product) => product.id)
    row.name = firstProduct.name
    row.brand = firstProduct.brand
    row.category = firstProduct.category
    row.subcategory = firstProduct.subcategory
    row.attributes = firstProduct.attributes
    row.variant_group_key = firstProduct.variant_group_key
    const duplicate = firstByFamily.get(familyKey)
    if (!duplicate) {
      firstByFamily.set(familyKey, row)
      continue
    }
    const payload = {
      ...duplicate.payload,
      observed_colors: observedColors(duplicate.payload, row.attributes?.colors || row.payload?.color),
    }
    await client.query(`
      UPDATE batch_ai_suggestions SET
        payload=$2::jsonb,
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(affected_product_ids || $3::jsonb)
        )
      WHERE id=$1
    `, [duplicate.id, JSON.stringify(payload), JSON.stringify(row.affected_product_ids || [])])
    duplicate.payload = payload
    await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
  }
}

export async function reconcileKnownAttributeSuggestions(
  client: QueryClient,
  batchId: string,
  knownCodes: Set<string>,
) {
  const result = await client.query(`
    SELECT s.* FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    WHERE r.batch_id=$1 AND s.kind='attribute' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  for (const row of result.rows) {
    const code = canonicalBatchSuggestionKey(row.payload?.code || row.canonical_key, 'attribute')
    if (!code || !knownCodes.has(code) || row.payload?.value === undefined) continue
    await client.query(`
      UPDATE products SET
        attributes=jsonb_set(COALESCE(attributes,'{}'::jsonb),ARRAY[$2]::text[],$3::jsonb,true),
        updated_at=NOW()
      WHERE id=ANY($1::int[])
    `, [
      row.affected_product_ids.map(Number),
      code,
      JSON.stringify(row.payload.value),
    ])
    await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
  }
}

export async function reconcileBatchSubcategorySuggestions(client: QueryClient, batchId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('batch-ai-suggestions:' || $1))", [batchId])
  const closedClothingCategories = await client.query(`
    SELECT canonical_id
    FROM catalog_id_mappings
    WHERE entity_type='category' AND lower(replace(name,'ё','е'))='одежда'
  `)
  const clothingCategoryIds = new Set(closedClothingCategories.rows.map((row) => String(row.canonical_id)))
  const result = await client.query(`
    SELECT s.* FROM batch_ai_suggestions s
    JOIN batch_ai_runs r ON r.id=s.run_id
    WHERE r.batch_id=$1 AND s.kind='subcategory' AND s.status='pending'
    ORDER BY s.created_at
  `, [batchId])
  const firstByFamily = new Map<string, any>()

  for (const row of result.rows) {
    const payload = row.payload || {}
    const familyKey = subcategoryFamilyKey(payload.name || payload.code || row.canonical_key)
    const parentId = String(payload.parent_category_id || '')
    const mappings = await catalogSubcategories(client, parentId)
    const clothingName = canonicalClothingSubcategoryName(payload.name || payload.code || row.canonical_key)
    const clothingMapping = clothingName
      ? mappings.find((mapping) => canonicalClothingSubcategoryName(mapping.name) === clothingName)
      : null
    if (clothingMapping) {
      await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=ANY($2::int[])', [
        String(clothingMapping.canonical_id),
        row.affected_product_ids.map(Number),
      ])
      await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }
    if (clothingCategoryIds.has(parentId)) {
      await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }
    if (redirectsToShoulderBags(payload.name || payload.code || row.canonical_key)) {
      const shoulderBags = shoulderBagsMapping(mappings)
      if (shoulderBags) {
        await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=ANY($2::int[])', [
          String(shoulderBags.canonical_id),
          row.affected_product_ids.map(Number),
        ])
        await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
      }
      continue
    }
    if (isGenericBagsSubcategory(payload.name || payload.code || row.canonical_key)) {
      await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }
    const existing = mappings.find((mapping) => sameSubcategoryFamily(mapping.name, payload.name || payload.code || row.canonical_key))
    if (existing) {
      await client.query('UPDATE products SET subcategory=$1,updated_at=NOW() WHERE id=ANY($2::int[])', [
        String(existing.canonical_id),
        row.affected_product_ids.map(Number),
      ])
      await client.query("UPDATE batch_ai_suggestions SET status='approved',reviewed_at=NOW() WHERE id=$1", [row.id])
      continue
    }

    const familyEntry = [...firstByFamily.entries()].find(([storedKey]) => {
      const [storedParent, ...storedFamily] = storedKey.split(':')
      return storedParent === parentId && sameSubcategoryFamily(storedFamily.join(':'), familyKey)
    })
    const duplicate = familyEntry?.[1]
    if (!duplicate) {
      firstByFamily.set(`${parentId}:${familyKey}`, row)
      continue
    }
    await client.query(`
      UPDATE batch_ai_suggestions SET
        affected_product_ids=(
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(affected_product_ids || $2::jsonb)
        )
      WHERE id=$1
    `, [duplicate.id, JSON.stringify(row.affected_product_ids || [])])
    await client.query("UPDATE batch_ai_suggestions SET status='rejected',reviewed_at=NOW() WHERE id=$1", [row.id])
  }
}

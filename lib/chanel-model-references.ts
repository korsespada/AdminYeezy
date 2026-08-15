export type ChanelModelReference = {
  model_key: string
  model_name: string
  aliases: string[]
  visual_hint: string
  reference_images: string[]
  source_batch_id?: string | null
  source_product_id?: number | null
  enabled?: boolean
}

type ChanelModelDefinition = Omit<ChanelModelReference, 'reference_images' | 'source_batch_id' | 'source_product_id' | 'enabled' | 'aliases'> & {
  patterns: RegExp[]
}

// Specific constructions come before generic words such as "bag" or "flap".
// The photo selected for a reference is always taken from the current export.
export const CHANEL_MODEL_DEFINITIONS: ChanelModelDefinition[] = [
  { model_key: 'vanity_case', model_name: 'Vanity Case', visual_hint: 'Прямоугольный кейс/бокс с верхней ручкой, молнией или жёсткой коробчатой конструкцией.', patterns: [/lp\s*盒子/i, /盒子/i, /饭盒包/i, /vanity/i] },
  { model_key: 'wallet_on_chain', model_name: 'Wallet on Chain', visual_hint: 'Компактный кошелёк с клапаном и длинной цепочкой для ношения через плечо.', patterns: [/\bwoc\b/i, /wallet\s*on\s*chain/i, /链条钱包/i] },
  { model_key: 'passport_holder', model_name: 'Passport Holder', visual_hint: 'Плоская обложка/футляр для паспорта без конструкции полноценной сумки.', patterns: [/护照夹/i, /passport/i] },
  { model_key: 'cardholder', model_name: 'Cardholder', visual_hint: 'Небольшой плоский картхолдер с прорезями или отделениями для карт.', patterns: [/卡包/i, /卡夹/i, /cardholder/i, /card\s*holder/i] },
  { model_key: 'backpack', model_name: 'Backpack', visual_hint: 'Рюкзак с двумя плечевыми лямками.', patterns: [/双肩/i, /书包/i, /背包/i, /backpack/i] },
  { model_key: 'camera_bag', model_name: 'Camera Bag', visual_hint: 'Небольшая компактная сумка-футляр с формой камеры/квадратным корпусом.', patterns: [/相机包/i, /camera\s*bag/i] },
  { model_key: 'bowling_bag', model_name: 'Bowling Bag', visual_hint: 'Продолговатая сумка с двумя верхними ручками и округлыми боками.', patterns: [/保龄球/i, /bowling/i] },
  { model_key: 'dumpling_bag', model_name: 'Dumpling Bag', visual_hint: 'Мягкая округлая сумка-мешок с присборенной формой.', patterns: [/饺子/i, /dumpling/i] },
  { model_key: 'baguette_bag', model_name: 'Baguette Bag', visual_hint: 'Небольшая вытянутая сумка-багет, обычно с короткой ручкой.', patterns: [/法棍/i, /baguette/i] },
  { model_key: 'boy_bag', model_name: 'Boy Bag', visual_hint: 'Прямоугольная сумка Boy с характерной геометричной фурнитурой/цепью.', patterns: [/\bboy\b/i, /le\s*boy/i, /男包/i] },
  { model_key: 'chanel_19', model_name: 'Chanel 19', visual_hint: 'Мягкая стёганая сумка Chanel 19 с объёмной цепью.', patterns: [/19\s*bag/i, /chanel\s*19/i, /19系列/i] },
  { model_key: 'chanel_22', model_name: 'Chanel 22', visual_hint: 'Мягкая вместительная сумка-мешок Chanel 22 с длинными ручками/цепью.', patterns: [/22\s*bag/i, /chanel\s*22/i, /垃圾袋/i, /22bag/i] },
  { model_key: 'chanel_31', model_name: 'Chanel 31', visual_hint: 'Модель Chanel 31 с узнаваемой прямоугольной формой и верхними ручками.', patterns: [/31\s*bag/i, /31nano/i, /chanel\s*31/i] },
  { model_key: '2_55_bag', model_name: '2.55 Bag', visual_hint: 'Классическая прямоугольная сумка 2.55 с цепью и застёжкой Mademoiselle.', patterns: [/2[.,]?55/i, /2\.55/i] },
  { model_key: 'classic_flap', model_name: 'Classic Flap', visual_hint: 'Стёганая сумка с клапаном, фирменной застёжкой CC и цепью.', patterns: [/\bcf(?:mini|20|23|25)?\b/i, /classic\s*flap/i, /口盖/i, /小口盖/i, /大口盖/i] },
  { model_key: 'coco_handle', model_name: 'Coco Handle', visual_hint: 'Структурированная сумка с жёсткой верхней ручкой и ремнём через плечо.', patterns: [/coco\s*handle/i, /cocohandle/i, /牛皮手柄/i, /手柄包/i] },
  { model_key: 'hobo', model_name: 'Hobo', visual_hint: 'Мягкая полукруглая сумка-хобо с одной ручкой или ремнём.', patterns: [/\bhobo\b/i, /流浪包/i, /腋下包/i] },
  { model_key: 'tote_bag', model_name: 'Tote Bag', visual_hint: 'Вместительная сумка-тоут с открытым верхом и двумя ручками.', patterns: [/\btote\b/i, /托特/i, /购物袋/i] },
  { model_key: 'kelly_bag', model_name: 'Kelly Bag', visual_hint: 'Структурированная сумка с верхней ручкой и клапаном.', patterns: [/\bkelly\b/i, /凯莉/i] },
  { model_key: 'mini_handle_bag', model_name: 'Mini Handle Bag', visual_hint: 'Небольшая структурированная сумка с короткой верхней ручкой.', patterns: [/mini\s*handle/i, /迷你手柄/i] },
]

const accessoryExclusions = /(手表|腕表|watch|丝巾扣|发夹|发箍|耳环|项链|戒指|手链|胸针|手机壳|香水|化妆品|钥匙扣|吊坠|眼镜)/i

function sourceText(product: any) {
  const attributes = product?.attributes && typeof product.attributes === 'object' ? product.attributes : {}
  const tags = Array.isArray(attributes.szwego_tags) ? attributes.szwego_tags.join(' ') : String(attributes.szwego_tags || '')
  return [product?.name, product?.description, tags].filter(Boolean).join(' ')
}

export function classifyChanelModel(product: any) {
  const text = sourceText(product)
  if (!text || accessoryExclusions.test(text)) return null
  return CHANEL_MODEL_DEFINITIONS.find((definition) => definition.patterns.some((pattern) => pattern.test(text))) || null
}

function aliasesFor(product: any, definition: ChanelModelDefinition) {
  const text = sourceText(product)
  const aliases = definition.patterns.flatMap((pattern) => text.match(pattern)?.map((value) => value.trim()) || [])
  const attributes = product?.attributes && typeof product.attributes === 'object' ? product.attributes : {}
  const tags: unknown[] = Array.isArray(attributes.szwego_tags) ? attributes.szwego_tags : String(attributes.szwego_tags || '').split(/[,|]/)
  return [...new Set([...aliases, ...tags.map(String).map((value) => value.trim()).filter(Boolean)])].slice(0, 8)
}

function candidateScore(product: any) {
  const photos = Array.isArray(product?.photos) ? product.photos : []
  const description = String(product?.description || '')
  const video = String(product?.attributes?.szwego_video_url || product?.attributes?.video_url || '').trim()
  return (photos.length >= 10 && photos.length <= 14 ? 6 : 0)
    + (photos.length > 0 ? 3 : 0)
    + (video ? 1 : 0)
    + (description.length > 20 ? 1 : 0)
}

export function deriveChanelModelReferences(products: any[], sourceBatchId?: string | null): ChanelModelReference[] {
  const best = new Map<string, { product: any; definition: ChanelModelDefinition; score: number }>()
  for (const product of products) {
    const definition = classifyChanelModel(product)
    const photo = Array.isArray(product?.photos) ? String(product.photos[0] || '').trim() : ''
    if (!definition || !photo) continue
    const score = candidateScore(product)
    const current = best.get(definition.model_key)
    if (!current || score > current.score) best.set(definition.model_key, { product, definition, score })
  }
  return CHANEL_MODEL_DEFINITIONS.flatMap((definition) => {
    const match = best.get(definition.model_key)
    if (!match) return []
    const product = match.product
    return [{
      model_key: definition.model_key,
      model_name: definition.model_name,
      aliases: aliasesFor(product, definition),
      visual_hint: definition.visual_hint,
      reference_images: [String(product.photos[0])],
      source_batch_id: sourceBatchId || null,
      source_product_id: Number.isFinite(Number(product.id)) ? Number(product.id) : null,
      enabled: true,
    }]
  })
}

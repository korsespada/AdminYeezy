import crypto from 'crypto'
import sharp from 'sharp'
import { openRouterChatCompletion } from '@/lib/openrouter'

export const EXPORTS_V2_GROUPING_PROMPT_VERSION = 'grouping-v1'
export const EXPORTS_V2_PRODUCT_PROMPT_VERSION = 'product-v1'
export const EXPORTS_V2_GROUPING_WINDOW = 40
export const EXPORTS_V2_GROUPING_OVERLAP = 5

type OpenRouterUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

export async function runExportsV2AiJson({
  model,
  systemPrompt,
  userPrompt,
  imageDataUrl,
  imageUrls,
}: {
  model: string
  systemPrompt: string
  userPrompt: string
  imageDataUrl?: string | null
  imageUrls?: string[]
}) {
  const content: any[] = [{ type: 'text', text: userPrompt }]
  if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } })
  for (const url of imageUrls || []) {
    if (url) content.push({ type: 'image_url', image_url: { url } })
  }

  const payload = await openRouterChatCompletion(
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    process.env.NEXT_PUBLIC_APP_URL ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL } : {},
  )

  const raw = String(payload?.choices?.[0]?.message?.content || '').trim()
  if (!raw) throw new Error('ИИ вернул пустой ответ')
  const clean = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  let data: any
  try {
    data = JSON.parse(clean)
  } catch {
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Не удалось распарсить JSON от ИИ')
    data = JSON.parse(match[0])
  }
  return { data, usage: (payload?.usage || {}) as OpenRouterUsage }
}

function szwegoThumbnail(source: string, size = 180) {
  if (!source || source.includes('imageMogr2/')) return source
  try {
    const url = new URL(source)
    if (!url.hostname.endsWith('szwego.com')) return source
    const separator = source.includes('?') ? '&' : '?'
    return `${source}${separator}imageMogr2/auto-orient/thumbnail/!${size}x${size}r/quality/68/format/webp`
  } catch {
    return source
  }
}

async function fetchTile(source: string, label: string, size: number) {
  try {
    const response = await fetch(szwegoThumbnail(source, size), { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) throw new Error(`image ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 8 * 1024 * 1024) throw new Error('image too large')
    const image = await sharp(bytes).rotate().resize(size, size, { fit: 'cover' }).png().toBuffer()
    const overlay = Buffer.from(`<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${Math.min(size, 76)}" height="28" rx="4" fill="rgba(2,6,23,.86)"/>
      <text x="7" y="20" font-size="15" font-weight="700" fill="white">${label.replace(/[<>&]/g, '')}</text>
    </svg>`)
    return sharp(image).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer()
  } catch {
    return sharp({ create: { width: size, height: size, channels: 4, background: '#0f172a' } })
      .composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><text x="10" y="30" font-size="16" fill="white">${label.replace(/[<>&]/g, '')}</text><text x="10" y="60" font-size="12" fill="#64748b">нет превью</text></svg>`) }])
      .png()
      .toBuffer()
  }
}

export async function buildExportsV2ContactSheet(albums: Array<{ source_order: number; preview_media?: string | null }>) {
  const tileSize = 180
  const columns = 5
  const rows = Math.max(1, Math.ceil(albums.length / columns))
  const tiles = await Promise.all(albums.map((album) => fetchTile(
    String(album.preview_media || ''),
    `#${album.source_order}`,
    tileSize,
  )))
  const sheet = await sharp({
    create: {
      width: columns * tileSize,
      height: rows * tileSize,
      channels: 4,
      background: '#020617',
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % columns) * tileSize,
    top: Math.floor(index / columns) * tileSize,
  }))).jpeg({ quality: 76 }).toBuffer()
  return `data:image/jpeg;base64,${sheet.toString('base64')}`
}

export function compactExportsV2Examples(rows: Array<{ example: any }>) {
  return rows.slice(0, 10).map((row) => {
    const example = row.example || {}
    return {
      sequence: example.sequence ? {
        direction: example.sequence.direction,
        gaps: example.sequence.gaps,
      } : null,
      albums: (example.albums || []).map((album: any) => ({
        external_id: album.external_id,
        source_position: album.source_position ?? album.source_order,
        role: album.role,
        photo_count: album.photo_count,
        media_count: album.media_count,
        description: String(album.description || '').slice(0, 350),
      })),
    }
  })
}

export function buildExportsV2GroupingPrompts(input: {
  albums: any[]
  examples: any[]
  scriptDescription: string
}) {
  const systemPrompt = `Ты группируешь последовательные исходные альбомы поставщика в товары.
Один товар может состоять из основных фото, дополнительных кадров, фото на модели, текста и таблицы размеров.
Не объединяй альбомы только из-за одинакового времени, внутреннего имени или похожего фона: используй совокупность порядка, текста и изображения.
Не выдумывай отсутствующие альбомы. Сохраняй порядок album_ids таким, каким он указан во входе.
Роли: PRIMARY_MEDIA, ON_MODEL, MEDIA_WITH_TEXT, EXTRA_MEDIA, TEXT_ONLY, SIZE_CHART, COMPARISON_OR_AD, IGNORE.
В каждой товарной группе должен быть ровно один PRIMARY_MEDIA. Реклама и сравнения не входят в товарную группу.
Если данных недостаточно, помести id в uncertain_album_ids вместо рискованного объединения.
Верни только JSON формата {"groups":[{"album_ids":["..."],"roles":{"id":"PRIMARY_MEDIA"},"confidence":0.0,"reason":"..."}],"ignored_album_ids":[],"uncertain_album_ids":[]}.
Каждый album_id может встретиться не более одного раза.`
  const userPrompt = `Описание логики старого скрипта поставщика (это только подсказка, не обязательное правило):
${input.scriptDescription || 'Описание не задано.'}

Подтверждённые примеры этого поставщика:
${JSON.stringify(input.examples)}

Текущий фрагмент ленты. Номер source_order соответствует подписи на плитке:
${JSON.stringify(input.albums.map((album) => ({
    external_id: album.external_id,
    source_order: album.source_order,
    media_count: album.media_count,
    photo_count: album.photo_count,
    has_video: album.has_video,
    name: album.name,
    description: String(album.description || '').slice(0, 600),
  })))}

Определи группы только по этому фрагменту. Плитка содержит по одному первому кадру каждого альбома.`
  return { systemPrompt, userPrompt }
}

export function buildExportsV2ProductPrompts(input: {
  globalRules: string
  supplierInstructions: string
  supplierDefaults: any
  attributeHints: any[]
  lookups: any
  sources: any[]
}) {
  const systemPrompt = `Ты создаёшь карточку товара после того, как оператор подтвердил объединение исходных альбомов.
Верни только JSON: {"name":"","description":"","price":0,"brand":"id|null","category":"id|null","subcategory":"id|null","gender":"male|female|unisex|null","attributes":{}}.
Используй только id из переданных справочников. Не придумывай материал, размеры или бренд без подтверждения в тексте/изображении.
Название короткое: бренд и тип товара. Описание на русском, без китайских иероглифов и служебных фраз.
Атрибуты возвращай только из списка attributeHints. Если значение не подтверждено источниками, полностью пропусти ключ: не возвращай null, пустую строку, "не указано" и не угадывай.
Для атрибутов с допустимыми значениями используй именно эти значения. Размеры возвращай массивом отдельных строк, например ["S","M","L"] или ["38","39","40"].
Цена определяется инструкциями поставщика; если правила нет, используй default_price.
Основные медиа и подписи имеют больший приоритет, SIZE_CHART используется для размеров/OCR.`
  const userPrompt = `Общие правила:
${input.globalRules || 'Нет дополнительных правил.'}

Инструкции поставщика:
${input.supplierInstructions || 'Нет дополнительных инструкций.'}

Значения поставщика по умолчанию:
${JSON.stringify(input.supplierDefaults)}

Разрешённые атрибуты:
${JSON.stringify(input.attributeHints)}

Справочники:
${JSON.stringify(input.lookups)}

Подтверждённые источники товара:
${JSON.stringify(input.sources)}`
  return { systemPrompt, userPrompt }
}

export function exportsV2CacheHash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

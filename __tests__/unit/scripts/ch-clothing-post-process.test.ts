import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

type Album = {
  external_id: string
  source_position: number
  description: string
  photos: string[]
  attributes: Record<string, unknown>
}

function album(overrides: Partial<Album> & { external_id: string; source_position: number }): Album {
  return { description: '', photos: [], attributes: {}, ...overrides }
}

function cover(id: string, count = 4): string[] {
  return Array.from({ length: count }, (_, index) => `${id}-${index + 1}.jpg`)
}

function gallery(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}.jpg`)
}

const SEPARATOR = '➨'
const CHART = '尺码表'
const PACKAGING = '标配：配套YB雪梨纸 手提袋+6'
const DETAIL = '局部细节参考'
const MODEL = '上身图参考'

const CARD_LONG_PANTS =
  'Chrome Hearts ch 克罗心 法兰绒 格子 长裤，男女同款！定织定染高支纯棉法兰绒，格纹色调肌理1:1对标原版。'
const CARD_BAD_SEED =
  '顶级版本Chrome Hearts Bad Seed 克罗心小高领短袖，弹力软糯，贴身不紧绷。插肩剪裁，修饰肩线，短款版型拉高腰线。'

function videoAlbum(position: number, id: string): Album {
  return album({
    external_id: id,
    source_position: position,
    description: '实拍视频',
    photos: [`${id}-poster.jpg`],
    attributes: { szwego_video_url: `https://video/${id}.mp4`, szwego_video_poster_url: `https://video/${id}.webp` },
  })
}

describe('CH Одежда post-process', () => {
  it('keeps photos 1 and 3 of the cover and attaches details, model shots, video and the size chart', async () => {
    const products: Album[] = [
      album({ external_id: 'sep-1', source_position: 0, description: SEPARATOR }),
      album({ external_id: 'size', source_position: 1, description: CHART, photos: ['chart.jpg'] }),
      videoAlbum(2, 'video'),
      album({ external_id: 'model', source_position: 3, description: MODEL, photos: gallery('model', 11) }),
      album({ external_id: 'packaging', source_position: 4, description: PACKAGING, photos: ['bag.jpg'] }),
      album({ external_id: 'detail', source_position: 5, description: DETAIL, photos: gallery('detail', 9) }),
      album({ external_id: 'card', source_position: 6, description: CARD_LONG_PANTS, photos: cover('card') }),
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result).toHaveLength(1)
    expect(result[0].external_id).toBe('card')
    expect(result[0].source_position).toBe(6)
    expect(result[0].photos).toEqual([
      'card-1.jpg', 'card-3.jpg',
      ...gallery('detail', 9),
      ...gallery('model', 11),
      'chart.jpg',
    ])
    expect(result[0].attributes).toMatchObject({
      szwego_video_url: 'https://video/video.mp4',
      szwego_video_poster_url: 'https://video/video.webp',
      album_attached: { detail: 1, model: 1, size: 1, video: 1 },
    })
    expect(result[0].photos).not.toContain('bag.jpg')
    expect(result[0].attributes.album_source_positions).toEqual([1, 2, 3, 5, 6])
    expect(result[0].variant_group_key).toBeNull()
  })

  it('never turns stock, ad, lookbook or single-photo text albums into products', async () => {
    const products: Album[] = [
      album({ external_id: 'sep-1', source_position: 0, description: SEPARATOR }),
      album({ external_id: 'news', source_position: 1, description: '‼️今日份资讯分享‼️', photos: gallery('news', 9) }),
      album({ external_id: 'sep-2', source_position: 2, description: SEPARATOR }),
      album({ external_id: 'stock', source_position: 3, description: '一系列 齐码现货', photos: gallery('stock', 9) }),
      album({ external_id: 'sep-3', source_position: 4, description: SEPARATOR }),
      album({ external_id: 'three-colours', source_position: 5, description: '三色', photos: ['colours.jpg'] }),
      album({ external_id: 'embroidery', source_position: 6, description: '原版级绣花一致', photos: ['embroidery.jpg'] }),
      album({ external_id: 'sep-4', source_position: 7, description: SEPARATOR }),
      album({ external_id: 'lookbook', source_position: 8, description: '女宝上身参考 又舒服又飒', photos: gallery('look', 13) }),
      album({ external_id: 'sep-5', source_position: 9, description: SEPARATOR }),
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result).toEqual([])
  })

  it('attaches a model album that names the brand instead of publishing it as a product', async () => {
    const products: Album[] = [
      album({ external_id: 'sep', source_position: 0, description: SEPARATOR }),
      album({ external_id: 'model-branded', source_position: 1, description: '𝗖𝗵𝗿𝗼𝗺𝗲 𝗛𝗲𝗮𝗿𝘁𝘀上身图参考', photos: gallery('branded', 9) }),
      album({ external_id: 'detail', source_position: 2, description: DETAIL, photos: gallery('detail', 8) }),
      album({ external_id: 'card', source_position: 3, description: CARD_BAD_SEED, photos: cover('card') }),
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result).toHaveLength(1)
    expect(result[0].photos).toEqual([
      'card-1.jpg', 'card-3.jpg',
      ...gallery('detail', 8),
      ...gallery('branded', 9),
    ])
  })

  it('groups the colours of one model inside a block and shares its single video and size chart', async () => {
    const products: Album[] = [
      album({ external_id: 'sep', source_position: 0, description: SEPARATOR }),
      album({ external_id: 'size', source_position: 1, description: CHART, photos: ['chart.jpg'] }),
      videoAlbum(2, 'video'),
      album({ external_id: 'model-a', source_position: 3, description: MODEL, photos: gallery('model-a', 11) }),
      album({ external_id: 'pack-a', source_position: 4, description: PACKAGING, photos: ['bag-a.jpg'] }),
      album({ external_id: 'detail-a', source_position: 5, description: DETAIL, photos: gallery('detail-a', 9) }),
      album({ external_id: 'card-a', source_position: 6, description: CARD_BAD_SEED, photos: cover('card-a') }),
      album({ external_id: 'model-b', source_position: 7, description: 'look', photos: gallery('model-b', 12) }),
      album({ external_id: 'pack-b', source_position: 8, description: PACKAGING, photos: ['bag-b.jpg'] }),
      album({ external_id: 'detail-b', source_position: 9, description: DETAIL, photos: gallery('detail-b', 9) }),
      album({ external_id: 'card-b', source_position: 10, description: CARD_BAD_SEED, photos: cover('card-b') }),
      album({ external_id: 'model-c', source_position: 11, description: MODEL, photos: gallery('model-c', 14) }),
      album({ external_id: 'pack-c', source_position: 12, description: PACKAGING, photos: ['bag-c.jpg'] }),
      album({ external_id: 'detail-c', source_position: 13, description: DETAIL, photos: gallery('detail-c', 6) }),
      album({
        external_id: 'card-c', source_position: 14, photos: cover('card-c'),
        description: `${CARD_BAD_SEED} 黑色 / S M L`,
      }),
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result.map((product: Album) => product.external_id)).toEqual(['card-a', 'card-b', 'card-c'])
    const keys = new Set(result.map((product: { variant_group_key: string | null }) => product.variant_group_key))
    expect(keys.size).toBe(1)
    const [key] = [...keys]
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(result.every((product: { variant_group_name: string }) => product.variant_group_name === '顶级版本Chrome Hearts Bad Seed 克罗心小高领短袖')).toBe(true)
    expect(result.every((product: { attributes: { szwego_video_url?: string } }) => product.attributes.szwego_video_url === 'https://video/video.mp4')).toBe(true)
    expect(result.every((product: { attributes: { size_chart_source_id?: string } }) => product.attributes.size_chart_source_id === 'size')).toBe(true)
    expect(result[1].attributes.album_video_shared).toBe(true)
    expect(result[2].attributes.album_video_shared).toBe(true)
    expect(result[1].photos).toContain('chart.jpg')
  })

  it('groups identical model texts across ➨ blocks but keeps another garment apart', async () => {
    const badSeed = 'Chrome Hearts克罗心女款Bad Seeds吊带背心 面料超级柔软亲肤 ，还原正品1：1版型，Jennie同款全新。'
    const products: Album[] = [
      album({ external_id: 'sep-1', source_position: 0, description: SEPARATOR }),
      album({ external_id: 'detail-shorts', source_position: 1, description: DETAIL, photos: gallery('detail-shorts', 7) }),
      album({
        external_id: 'card-shorts', source_position: 2, photos: cover('card-shorts'),
        description: 'Chrome hearts CH 克罗心 贴布字母刺绣灰色短裤，男女同款。定织定染面料克重高达600克，多股编织。',
      }),
      album({ external_id: 'sep-2', source_position: 3, description: SEPARATOR }),
      album({ external_id: 'detail-pants', source_position: 4, description: DETAIL, photos: gallery('detail-pants', 11) }),
      album({
        external_id: 'card-pants', source_position: 5, photos: cover('card-pants'),
        description: 'Chrome hearts CH 克罗心 贴布字母刺绣灰色长裤男女同款。定织定染面料克重高达600克，多股编织。',
      }),
      album({ external_id: 'sep-3', source_position: 6, description: SEPARATOR }),
      album({ external_id: 'detail-vest-a', source_position: 7, description: DETAIL, photos: gallery('detail-vest-a', 9) }),
      album({ external_id: 'card-vest-a', source_position: 8, description: badSeed, photos: cover('card-vest-a') }),
      album({ external_id: 'sep-4', source_position: 9, description: SEPARATOR }),
      album({ external_id: 'detail-vest-b', source_position: 10, description: DETAIL, photos: gallery('detail-vest-b', 9) }),
      album({ external_id: 'card-vest-b', source_position: 11, description: badSeed, photos: cover('card-vest-b') }),
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result.map((product: Album) => product.external_id)).toEqual([
      'card-shorts', 'card-pants', 'card-vest-a', 'card-vest-b',
    ])
    const byId = new Map(result.map((product: Album) => [product.external_id, product]))
    expect(byId.get('card-shorts')!.variant_group_key).toBeNull()
    expect(byId.get('card-pants')!.variant_group_key).toBeNull()
    const vestKey = byId.get('card-vest-a')!.variant_group_key
    expect(vestKey).toMatch(/^[0-9a-f]{32}$/)
    expect(byId.get('card-vest-b')!.variant_group_key).toBe(vestKey)
  })

  it('is idempotent and keeps its own video when every colour has one', async () => {
    const products: Album[] = [
      album({ external_id: 'sep-1', source_position: 0, description: SEPARATOR }),
      videoAlbum(1, 'video-a'),
      album({ external_id: 'detail-a', source_position: 2, description: DETAIL, photos: gallery('detail-a', 9) }),
      album({ external_id: 'card-a', source_position: 3, description: CARD_BAD_SEED, photos: cover('card-a') }),
      album({ external_id: 'sep-2', source_position: 4, description: SEPARATOR }),
      videoAlbum(5, 'video-b'),
      album({ external_id: 'detail-b', source_position: 6, description: DETAIL, photos: gallery('detail-b', 9) }),
      album({ external_id: 'card-b', source_position: 7, description: CARD_BAD_SEED, photos: cover('card-b') }),
    ]

    const first = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)
    const second = await runSupplierJsonProcess('process_ch_clothing_timeline.py', first)

    expect(first).toHaveLength(2)
    expect(first[0].attributes.szwego_video_url).toBe('https://video/video-a.mp4')
    expect(first[1].attributes.szwego_video_url).toBe('https://video/video-b.mp4')
    expect(first[0].attributes.album_video_shared).toBeUndefined()
    expect(second).toEqual(first)
  })
})

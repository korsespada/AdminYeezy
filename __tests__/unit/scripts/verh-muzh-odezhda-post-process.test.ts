import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

const SCRIPT = 'process_verh_muzh_odezhda.py'

type Card = {
  external_id: string
  description: string
  photos: string[]
  source_position: number
  attributes: Record<string, unknown>
}

function card(source_position: number, description: string, photos: string[] | number, attributes: Record<string, unknown> = {}): Card {
  const list = typeof photos === 'number' ? Array.from({ length: photos }, (_, index) => `p${source_position}-${index}.jpg`) : photos
  return {
    external_id: `ext-${source_position}`,
    description,
    photos: list,
    source_position,
    attributes,
  }
}

describe('Верх Муж Одежда post-process (supplier 71)', () => {
  it('gives every colour of a family the caption, the size chart and one family key', async () => {
    const products = [
      card(0, '-', []),
      card(1, '[Synchronization]', 1),
      card(2, '【size】', ['size-chart.jpg']),
      card(3, '【Black】', 9),
      card(4, '【Green】', 9),
      card(5, '【Red】', 9),
      card(6, '【Blue】', 9),
      card(7, '【White】', 9),
      card(8, '📍 Prada - Down jacket (feather)Size：48-56Color ：White Blue Red Green Black', 5),
      card(9, '-', []),
      card(10, '[Synchronization]', 1),
      card(11, '【Black】', 9),
      card(12, '📍 ZEGNA - First cut wool jacket (wool)Size 48-56Color ：Brown', 2),
    ]

    const result = await runSupplierJsonProcess(SCRIPT, products)

    // Separator, synchronization, size chart and caption albums are not products.
    expect(result).toHaveLength(6)
    const family = result.slice(0, 5)
    const caption = products[8].description
    expect(family.map((product: Card) => product.description)).toEqual(Array(5).fill(caption))
    expect(family.map((product: Card) => product.external_id)).toEqual(['ext-3', 'ext-4', 'ext-5', 'ext-6', 'ext-7'])
    expect(family.map((product: Card) => product.source_position)).toEqual([3, 4, 5, 6, 7])
    expect(family.map((product: Card) => product.photos.length)).toEqual([10, 10, 10, 10, 10])
    for (const product of family) {
      // No colour merges two albums here, so the caption photos are not used as covers.
      expect(product.photos.slice(0, 9)).toEqual(products[product.source_position].photos)
      expect(product.photos[9]).toBe('size-chart.jpg')
    }

    const keys = new Set(family.map((product: any) => product.variant_group_key))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toMatch(/^[0-9a-f]{32}$/)
    for (const product of family as any[]) {
      expect(product.variant_group_name).toBe('Prada - Down jacket (feather)')
      expect(product.attributes.album_family_key).toBe(product.variant_group_key)
      expect(product.attributes.album_colours).toBe(5)
      expect(product.attributes.album_source_positions).toEqual([2, product.source_position])
      expect(product.attributes.colors).toEqual([product.attributes.album_colour])
      expect(product.attributes.size_chart_source_id).toBe('ext-2')
      expect(product.attributes.description_source_id).toBe('ext-8')
      expect(product.attributes.album_sync_source_ids).toBeUndefined()
      expect(product.attributes.album_cover_source_id).toBeUndefined()
      expect(product.attributes.album_merge_version).toBe('verh-muzh-odezhda-albums-2')
    }
    expect(family.map((product: any) => product.attributes.album_colour)).toEqual(['Black', 'Green', 'Red', 'Blue', 'White'])

    // A single-colour family has no colour family to protect, so its
    // [Synchronization] model shot is appended before the size chart.
    const single = result[5] as any
    expect(single.external_id).toBe('ext-11')
    expect(single.variant_group_key).toBeNull()
    expect(single.variant_group_name).toBeNull()
    expect(single.photos).toEqual([...products[11].photos, 'p10-0.jpg'])
    expect(single.attributes.album_family_name).toBe('ZEGNA - First cut wool jacket (wool)')
    expect(single.attributes.album_sync_source_ids).toEqual(['ext-10'])
    expect(single.attributes.description_source_id).toBe('ext-12')
  })

  it('covers a merged suit colour with its caption photo in the reverse feed order', async () => {
    const products = [
      card(0, '【Size】', ['size.jpg']),
      card(1, 'Details of khaki pants', 8),
      card(2, 'Details of khaki jacket', 9),
      card(3, 'Details of Purple Pants', 8),
      card(4, 'Details of Purple Coat', 9),
      // The supplier posts the caption album newest first: its first photo is
      // the purple suit, its second photo the khaki suit.
      card(5, '📍 Brunello Cucinelli - plaid suit setSize ：48-56Color：khaki Purple', ['suit-purple.jpg', 'suit-khaki.jpg']),
    ]

    const result = await runSupplierJsonProcess(SCRIPT, products)

    expect(result).toHaveLength(2)
    const [khaki, purple] = result as any[]
    expect(khaki.external_id).toBe('ext-1')
    expect(khaki.attributes.album_colour).toBe('khaki')
    expect(purple.external_id).toBe('ext-3')
    expect(purple.attributes.album_colour).toBe('Purple')
    expect(khaki.photos[0]).toBe('suit-khaki.jpg')
    expect(purple.photos[0]).toBe('suit-purple.jpg')
    expect(khaki.photos.slice(1)).toEqual([...products[1].photos, ...products[2].photos, 'size.jpg'])
    expect(purple.photos.slice(1)).toEqual([...products[3].photos, ...products[4].photos, 'size.jpg'])
    expect(khaki.photos).toHaveLength(1 + 8 + 9 + 1)
    expect(khaki.attributes.album_source_positions).toEqual([0, 1, 2, 5])
    expect(khaki.attributes.album_cover_source_id).toBe('ext-5')
    expect(khaki.attributes.album_attached).toBe(3)
    expect(khaki.variant_group_key).toBe(purple.variant_group_key)
    expect(khaki.variant_group_name).toBe('Brunello Cucinelli - plaid suit set')
    expect(await runSupplierJsonProcess(SCRIPT, result)).toEqual(result)
  })

  it('does not use a caption photo when it cannot be matched to a colour one by one', async () => {
    const products = [
      card(0, 'Details of khaki pants', 6),
      card(1, 'Details of khaki jacket', 6),
      card(2, 'Details of Blue Pants', 6),
      card(3, 'Details of Blue Coat', 6),
      card(4, 'Details of Grey Purple Pants', 6),
      card(5, '📍 Brunello Cucinelli - Imported 100 Raindew FlaxSize ：48-56', 2),
    ]

    const result = await runSupplierJsonProcess(SCRIPT, products)

    expect(result).toHaveLength(3)
    const [khaki, blue, greyPurple] = result as any[]
    expect(khaki.photos).toEqual([...products[0].photos, ...products[1].photos])
    expect(blue.photos).toEqual([...products[2].photos, ...products[3].photos])
    expect(greyPurple.photos).toEqual(products[4].photos)
    for (const product of result as any[]) {
      expect(product.attributes.album_cover_source_id).toBeUndefined()
      expect(product.attributes.description_source_id).toBe('ext-5')
    }
    expect(khaki.variant_group_key).toBe(greyPurple.variant_group_key)
  })

  it('drops a small hand-made or hand-knitted variant album', async () => {
    const products = [
      card(0, '-', []),
      card(1, '【Hand-knitted 】', 3),
      card(2, '【Blue】', 9),
      card(3, '📍 Bottega Veneta - Imported Genuine LeatherSize ：48-56', 1),
      card(4, '-', []),
      card(5, '【Hand-made】', 9),
      card(6, '【Green】', 9),
      card(7, '📍 Bottega Veneta - Imported Genuine LeatherSize ：48-56', 1),
    ]

    const result = await runSupplierJsonProcess(SCRIPT, products)

    expect(result).toHaveLength(3)
    expect(result.map((product: Card) => product.external_id)).toEqual(['ext-2', 'ext-5', 'ext-6'])
    // Without the three-photo album the first family has a single colour, and a
    // nine-photo hand-made album stays a real product of the second family.
    expect((result[0] as any).attributes.album_colours).toBe(1)
    expect((result[0] as any).variant_group_key).toBeNull()
    expect((result[0] as any).attributes.album_colour).toBe('Blue')
    expect((result[1] as any).attributes.album_colour).toBe('Hand-made')
    expect((result[1] as any).attributes.album_colours).toBe(2)
    expect((result[1] as any).variant_group_key).toBe((result[2] as any).variant_group_key)
  })

  it('keeps the same product identity for merged colour spellings and appends the size chart last', async () => {
    const products = [
      card(0, '-', []),
      card(1, '【Size】', 2),
      card(2, 'Details of dark gray pants', 6),
      card(3, 'Details of Dark Grey Coat', 9),
      card(4, 'Details of khaki pants', 6),
      card(5, 'Details of khaki jacket', 3),
      card(6, '📍 Loro Piana - Wool JacketSize ：48-56', 1),
    ]

    const result = await runSupplierJsonProcess(SCRIPT, products)

    // One caption photo cannot be matched to two colours, so it stays unused.
    expect(result).toHaveLength(2)
    const [gray, khaki] = result as any[]
    expect(gray.external_id).toBe('ext-2')
    expect(gray.photos).toHaveLength(6 + 9 + 2)
    expect(gray.photos.slice(-2)).toEqual(products[1].photos)
    expect(gray.attributes.album_colour_index).toBe(1)
    expect(khaki.attributes.album_colour_index).toBe(2)
    expect(khaki.photos).toHaveLength(6 + 3 + 2)
    expect(khaki.variant_group_key).toBe(gray.variant_group_key)
    expect(gray.attributes.album_family_name).toBe('Loro Piana - Wool Jacket')
  })

  it('handles a family without a size chart or a caption and an empty payload', async () => {
    expect(await runSupplierJsonProcess(SCRIPT, [])).toEqual([])

    const result = await runSupplierJsonProcess(SCRIPT, [
      card(0, '【Blue】', 9),
      card(1, '【Red】', 9),
    ])

    expect(result).toHaveLength(2)
    const [blue, red] = result as any[]
    expect(blue.photos).toHaveLength(9)
    expect(blue.attributes.album_colour).toBe('Blue')
    expect(red.attributes.album_colour).toBe('Red')
    expect(blue.variant_group_key).toBe(red.variant_group_key)
    expect(blue.variant_group_name).toBe('Blue')
    expect(blue.attributes.album_attached).toBe(0)
  })

  it('is idempotent and preserves unrelated fields', async () => {
    const products = [
      card(0, '【Black】', 9, { szwego_timestamp: 1791170217078, szwego_parse_mode: 'all' }),
      card(1, '【White】', 9, {}),
      card(2, '📍 Prada - Down jacket (feather)Size：48-56Color ：White Black', 2, {}),
    ]
    products[0].attributes.szwego_parse_mode = 'all'

    const first = await runSupplierJsonProcess(SCRIPT, products)
    const second = await runSupplierJsonProcess(SCRIPT, first)

    expect(second).toEqual(first)
    expect(first).toHaveLength(2)
    expect((first[0] as any).attributes.szwego_timestamp).toBe(1791170217078)
    expect((first[0] as any).attributes.szwego_parse_mode).toBe('all')
  })
})

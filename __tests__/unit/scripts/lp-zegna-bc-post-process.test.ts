import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

const SCRIPT = 'process_lp_zegna_bc.py'

type Card = {
  external_id: string
  name?: string
  description: string
  photos: string[]
  source_position: number
  attributes: Record<string, unknown>
}

function card(source_position: number, description: string, photos: number | string[], attributes: Record<string, unknown> = {}): Card {
  const list = typeof photos === 'number'
    ? Array.from({ length: photos }, (_, index) => `p${source_position}-${index}.jpg`)
    : photos
  return {
    external_id: `ext-${source_position}`,
    description,
    photos: list,
    source_position,
    attributes,
  }
}

const MAN = '•———• MAN•———• SS26'
const MAN_NEXT_YEAR = '•———• MAN•———• SS27'
const WOMAN = '•———• WOMAN•———• SS26'
const DESC = '▫️Мужская куртка из шерсти. ▫️Размеры: M•L•XL ▫️Цена: 100¥ — опт 200¥ ▫️Код модели: BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装'

describe('LP, Zegna, BC Мужская одежда post-process (supplier 28)', () => {
  it('splits sections by MAN/WOMAN headers and collects colour families', async () => {
    const products = [
      card(0, MAN, 0),
      card(1, DESC, 0),
      card(2, '', 1),
      card(3, '▫️Unpacking МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 0),
      card(4, '▫️Original vs. Our Version МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 6),
      card(5, '▫️The size grid ▫️BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 1),
      card(6, '▫️Price: 1130¥ / 1330¥ ▫️Sizes: M•L•XL ▫️BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 0),
      card(7, '▫️Price: 1130¥ / 1330¥ ▫️Sizes: M•L•XL ▫️BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 1),
      card(8, '▫️Price: 1130¥ / 1330¥ ▫️Sizes: M•L•XL ▫️BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 6),
      card(9, '▫️Price: 1130¥ / 1330¥ ▫️Sizes: M•L•XL ▫️BC0103 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装', 6),
      card(10, MAN_NEXT_YEAR, 0),
      card(11, DESC.replace('BC0103', 'BL2533M'), 0),
      card(12, '▫️Price: 470¥ / 570¥ ▫️Sizes: 39-46 ▫️BL2533M МУЖСКАЯ ОБУВЬ MAN SHOES 男士鞋', 6),
    ]

    const result: Card[] = await runSupplierJsonProcess(SCRIPT, products)

    // Service albums, the header, the description and the group photo are not products.
    expect(result.map((product) => product.external_id)).toEqual(['ext-8', 'ext-9', 'ext-12'])
    const family = result.slice(0, 2)
    expect(new Set(family.map((product) => product.variant_group_key)).size).toBe(1)
    expect(family[0].variant_group_key).toMatch(/^[0-9a-f]{32}$/)
    expect(family.map((product) => product.variant_group_name)).toEqual(['BC0103', 'BC0103'])
    expect(family.map((product) => product.description)).toEqual([DESC, DESC])
    // Size chart is the last photo, after the six product photos.
    expect(family.map((product) => product.photos.length)).toEqual([7, 7])
    expect(family[0].photos[6]).toBe('p5-0.jpg')
    expect((family[0] as any).attributes.size_chart_source_id).toBe('ext-5')
    expect((family[0] as any).attributes.description_source_id).toBe('ext-1')
    expect(family.map((product) => (product as any).name)).toEqual(['Brunello Cucinelli', 'Brunello Cucinelli'])
    expect(family.map((product) => (product as any).category)).toEqual(['lrg3k8cd5bgw3jv', 'lrg3k8cd5bgw3jv'])
    expect(family.map((product) => (product as any).gender)).toEqual(['male', 'male'])

    // The next header starts a new section: Berluti by article, no family for one colour.
    const berluti = result[2] as any
    expect(berluti.name).toBe('Berluti')
    expect(berluti.category).toBe('nzg3vsvajpiv1e8')
    expect(berluti.variant_group_key).toBeUndefined()
    expect(berluti.attributes.model_code).toBe('BL2533M')
  })

  it('takes the Details album as the product and attaches the on-model photos', async () => {
    const detail = '▫️Details МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装'
    const price = '▫️Price: 210¥ / 310¥ ▫️Sizes: M•L•XL ▫️BC0125 МУЖСКАЯ ОДЕЖДА MAN CLOTHES 男士服装'
    const products = [
      card(0, WOMAN, 0),
      card(1, '▫️Женские брюки. ▫️Код модели: KT007 ЖЕНСКАЯ ОДЕЖДА WOMAN CLOTHES 女士服装', 0),
      card(2, '▫️The size grid ЖЕНСКАЯ ОДЕЖДА WOMAN CLOTHES 女士服装', 1),
      card(3, price.replace('BC0125', 'KT007'), 0),
      card(4, price.replace('BC0125', 'KT007'), 1),
      card(5, price.replace('BC0125', 'KT007'), 6),
      card(6, detail, 6),
      card(7, price.replace('BC0125', 'KT007'), 6),
      card(8, detail, 6),
    ]

    const result: Card[] = await runSupplierJsonProcess(SCRIPT, products)

    expect(result.map((product) => product.external_id)).toEqual(['ext-6', 'ext-8'])
    for (const product of result as any[]) {
      expect(product.photos.length).toBe(13)
      expect(product.photos.slice(0, 6)).toEqual(products[product.source_position].photos)
      expect(product.photos[12]).toBe('p2-0.jpg')
      expect(product.gender).toBe('female')
      expect(product.variant_group_key).toMatch(/^[0-9a-f]{32}$/)
      expect(product.attributes.model_code).toBe('KT007')
      expect(product.attributes.model_photos_source_id).toBe(`ext-${product.source_position - 1}`)
    }
  })

  it('keeps hat and scarf runs apart and moves the second photo first for accessories', async () => {
    const description = '▫️Комплект. ▫️Код модели: BCS002 (шарф) BCH002 (шапка) МУЖСКИЕ АКСЕССУАРЫ 男士配饰'
    const hat = '▫️Price: 240¥ / 340¥(hat) ▫️Size: one ▫️BCH002 МУЖСКИЕ АКСЕССУАРЫ 男士配饰'
    const scarf = '▫️Price: 300¥ / 400¥(scarf) ▫️Size: one ▫️BCS002 МУЖСКИЕ АКСЕССУАРЫ 男士配饰'
    const products = [
      card(0, MAN, 0),
      card(1, description, 0),
      card(2, hat, 0),
      card(3, hat, 1),
      card(4, hat, 6),
      card(5, hat, 6),
      card(6, scarf, 6),
      card(7, scarf, 6),
      // A three-photo collage of several goods is not a colour card.
      card(8, '▫️Price: 700¥ / 800¥(set) ▫️Size: one ▫️LPH009/LPS005 МУЖСКИЕ АКСЕССУАРЫ 男士配饰', 3),
    ]

    const result: Card[] = await runSupplierJsonProcess(SCRIPT, products)

    expect(result).toHaveLength(4)
    expect(result.map((product) => product.source_position)).not.toContain(8)
    const hats = result.slice(0, 2) as any[]
    const scarves = result.slice(2) as any[]
    expect(hats[0].variant_group_key).not.toBe(scarves[0].variant_group_key)
    expect(new Set(hats.map((product) => product.variant_group_key)).size).toBe(1)
    expect(new Set(scarves.map((product) => product.variant_group_key)).size).toBe(1)
    for (const product of result as any[]) {
      expect(product.category).toBe('mxyz80e9uti03ia')
      expect(product.photos[0]).toBe(`p${product.source_position}-1.jpg`)
      expect(product.photos[1]).toBe(`p${product.source_position}-0.jpg`)
    }
    expect(hats.map((product) => product.attributes.model_code)).toEqual(['BCH002', 'BCH002'])
    expect(scarves.map((product) => product.attributes.model_code)).toEqual(['BCS002', 'BCS002'])
    expect(hats.map((product) => product.description)).toEqual([description, description])
  })
})

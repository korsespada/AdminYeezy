import { describe, expect, it } from 'vitest'

const {
  finalizeBurberryPostProcess,
  restoreProtectedProducts,
} = require('../../../scripts/lib/burberry-post-process')
const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

function product(overrides: Record<string, unknown>) {
  return {
    external_id: 'product',
    source_position: 0,
    description: 'Burberry product description',
    photos: [],
    attributes: {},
    ...overrides,
  }
}

describe('Burberry post-process finalization', () => {
  it('keeps only substantive albums and extracts the full model code', async () => {
    const good = product({
      external_id: 'good',
      description: 'The latest sloping backpack from B family features a finely woven embroidered knight seal. Size 26.5 x 9 x 18cm. Model 388150 3881',
      photos: Array.from({ length: 6 }, (_, index) => `good-${index}.jpg`),
    })
    const short = product({
      external_id: 'short', description: 'Authentic product image 3881',
      photos: Array.from({ length: 9 }, (_, index) => `short-${index}.jpg`),
    })
    const result = await runSupplierJsonProcess('process_burberry_bags.py', [good, short])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'good',
      attributes: { model_code: '388150' },
    })
    expect(result[0].source_position).toBe(good.source_position)
  })

  it('rejects comparison and multi-size albums even with many photos', async () => {
    const comparison = product({
      external_id: 'comparison',
      description: 'Comparison of large and small sizes. Large 40 x 16 x 30cm. Small 34 x 15 x 23cm. Model 0351',
      photos: Array.from({ length: 9 }, (_, index) => `comparison-${index}.jpg`),
    })
    const regularFourDigitModel = product({
      external_id: 'regular-2463',
      description: 'The small postman gray grid color is a classic color scheme for daily carrying. Size 29 x 20 x 8.5cm. Model 2463',
      photos: Array.from({ length: 9 }, (_, index) => `regular-${index}.jpg`),
    })

    const result = await runSupplierJsonProcess('process_burberry_bags.py', [comparison, regularFourDigitModel])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'regular-2463',
      attributes: { model_code: '2463' },
    })
  })

  it('restores every Rails product removed by the supplier filter', () => {
    const source = [
      product({
        external_id: 'existing-filtered', source_position: 4,
        description: 'Existing album Model 388150',
        photos: ['https://cdn.example/old.jpg'],
      }),
      product({ external_id: 'new-filtered', source_position: 5, photos: ['https://cdn.example/new.jpg'] }),
    ]

    const restored = restoreProtectedProducts([], source, new Set(['existing-filtered']))

    expect(restored.map((item: any) => item.external_id)).toEqual(['existing-filtered'])
    expect(restored[0].source_position).toBe(4)
    expect(restored[0].attributes.model_code).toBe('388150')
  })

  it('keeps all existing external ids and drops only their new repost', () => {
    const sharedDescription = 'The same complete Burberry description with model and size.'
    const items = [
      product({
        external_id: 'existing-a', source_position: 200, description: sharedDescription,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/a.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/b.jpg'],
        attributes: { model_code: '388150' },
      }),
      product({
        external_id: 'existing-b', source_position: 300, description: sharedDescription,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/a.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/c.jpg'],
        attributes: { model_code: '388150' },
      }),
      product({
        external_id: 'new-repost', source_position: 2, description: sharedDescription,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/a.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/b.jpg?new=1'],
        attributes: { model_code: '388150' },
      }),
    ]

    const result = finalizeBurberryPostProcess(items, new Set(['existing-a', 'existing-b']))

    expect(result.map((item: any) => item.external_id)).toEqual(['existing-a', 'existing-b'])
  })

  it('keeps distinct colors of one model and assigns a valid stable family key', () => {
    const sharedDescription = 'The same complete Burberry description with model and size.'
    const items = [
      product({
        external_id: 'black', source_position: 1, description: sharedDescription,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/black-a.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/black-b.jpg'],
        attributes: { model_code: '388150' },
      }),
      product({
        external_id: 'brown', source_position: 2, description: sharedDescription,
        photos: ['https://xcimg.szwego.com/imgHD/account/20251201/brown-a.jpg', 'https://xcimg.szwego.com/imgHD/account/20251201/brown-b.jpg'],
        attributes: { model_code: '388150' },
      }),
    ]

    const first = finalizeBurberryPostProcess(items, new Set())
    const second = finalizeBurberryPostProcess(first, new Set())

    expect(first.map((item: any) => item.external_id)).toEqual(['black', 'brown'])
    expect(first[0].variant_group_key).toMatch(/^[0-9a-f]{32}$/)
    expect(first[0].variant_group_key).toBe(first[1].variant_group_key)
    expect(first[0].variant_group_name).toBe('Burberry 388150')
    expect(second).toEqual(first)
  })

  it('does not merge a transitive one-photo chain of distinct color galleries', () => {
    const description = 'The same complete Burberry description with model and size.'
    const items = [
      product({
        external_id: 'a', source_position: 1, description,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/shared.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/a.jpg'],
        attributes: { model_code: '388150' },
      }),
      product({
        external_id: 'b', source_position: 2, description,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/shared.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/b.jpg'],
        attributes: { model_code: '388150' },
      }),
      product({
        external_id: 'c', source_position: 3, description,
        photos: ['https://xcimg.szwego.com/imgHD/account/20260103/b.jpg', 'https://xcimg.szwego.com/imgHD/account/20260103/c.jpg'],
        attributes: { model_code: '388150' },
      }),
    ]

    const first = finalizeBurberryPostProcess(items, new Set())
    expect(first.map((item: any) => item.external_id)).toEqual(['a', 'b', 'c'])
    expect(finalizeBurberryPostProcess(first, new Set())).toEqual(first)
  })
})

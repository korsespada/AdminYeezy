import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

describe('supplier JSON post-process contract', () => {
  it('preserves UTF-8 and merges neighbouring Chanel albums without CSV artifacts', async () => {
    const products = [
      {
        external_id: 'details',
        description: '经典款 尺寸：25',
        photos: Array.from({ length: 9 }, (_, index) => `detail-${index}`),
        source_position: 0,
        attributes: {},
      },
      {
        external_id: 'cover',
        description: '钱包展示',
        photos: Array.from({ length: 4 }, (_, index) => `cover-${index}`),
        source_position: 1,
        attributes: {},
      },
    ]

    const result = await runSupplierJsonProcess('merge_photos_8_9_11.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'details',
      description: '钱包展示 经典款 尺寸：25',
      source_position: 0,
    })
    expect(result[0].photos).toHaveLength(13)
  })

  it('builds five Szwego timeline products, excludes mosaic tiles, and copies the size chart into each', async () => {
    const timeline = [
      {
        external_id: 'header',
        description: '•———• MAN•———• SS26',
        photos: [],
      },
      {
        external_id: 'description',
        description: 'Полное описание модели из натуральной шерсти с информацией о составе и посадке.',
        photos: [],
      },
      { external_id: 'model-1', description: '', photos: ['model-1.jpg'] },
      { external_id: 'model-2', description: '', photos: ['model-2.jpg'] },
      {
        external_id: 'size-chart',
        description: 'The size grid BC055',
        photos: ['size-chart.jpg'],
      },
      ...Array.from({ length: 5 }, (_, index) => [
        {
          external_id: `price-${index}`,
          description: 'Price: 530¥ / 630¥ Sizes: M•L•XL•2XL•3XL BC055',
          photos: [`color-${index}-1.jpg`, `color-${index}-2.jpg`],
        },
        {
          external_id: `details-${index}`,
          description: 'Details',
          photos: [`details-${index}-1.jpg`, `details-${index}-2.jpg`],
        },
      ]).flat(),
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', timeline)

    expect(result).toHaveLength(5)
    for (let index = 0; index < result.length; index++) {
      expect(result[index]).toMatchObject({
        external_id: `price-${index}`,
        name: 'Brunello Cucinelli',
        brand: 'll73bx30faqq27r',
        category: 'lrg3k8cd5bgw3jv',
        description: 'Полное описание модели из натуральной шерсти с информацией о составе и посадке.',
        variant_group_key: 'BC055',
        attributes: {
          model_code: 'BC055',
          description_source_id: 'description',
          details_source_id: `details-${index}`,
          size_chart_source_id: 'size-chart',
        },
      })
      expect(result[index].photos).toEqual([
        `details-${index}-1.jpg`,
        `details-${index}-2.jpg`,
        `color-${index}-1.jpg`,
        `color-${index}-2.jpg`,
        'size-chart.jpg',
      ])
    }
  })

  it('pairs Details with the following Price row even though Details has no model code', async () => {
    const products = [
      {
        external_id: 'details',
        description: 'Details',
        photos: ['details.jpg'],
        source_position: 0,
        attributes: {},
      },
      {
        external_id: 'price',
        description: 'Price: 800¥ Sizes: M•L•XL ZE2539',
        photos: ['price.jpg'],
        source_position: 1,
        attributes: {},
      },
    ]

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'price',
      name: 'Zegna',
      brand: '8xod4z3cjpbltoa',
      category: 'lrg3k8cd5bgw3jv',
      photos: ['details.jpg', 'price.jpg'],
    })
  })
})

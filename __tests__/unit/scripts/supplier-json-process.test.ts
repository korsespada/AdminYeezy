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

  it('keeps descriptions and size charts with their own model inside one MAN feed', async () => {
    const timeline = [
      {
        external_id: 'header',
        description: '•———• MAN•———• SS26',
        photos: [],
      },
      {
        external_id: 'sneaker-description',
        description: 'Длинное описание кроссовок Nantucket Walk из замши для проверки привязки. Код модели: LP071',
        photos: [],
      },
      {
        external_id: 'sneaker-size',
        description: 'The size grid LP071',
        photos: ['sneaker-size.jpg'],
      },
      {
        external_id: 'sneaker-price',
        description: 'Price: 490¥ Sizes: 39-46 LP071',
        photos: ['sneaker.jpg'],
      },
      {
        external_id: 'sneaker-details',
        description: 'Details',
        photos: ['sneaker-detail.jpg'],
      },
      {
        external_id: 'tshirt-description',
        description: 'Длинное описание мужской футболки Zegna из хлопка для проверки привязки. Код модели: ZE019',
        photos: [],
      },
      { external_id: 'mosaic', description: '', photos: ['mosaic.jpg'] },
      {
        external_id: 'tshirt-size',
        description: 'The size grid ZE019',
        photos: ['tshirt-size.jpg'],
      },
      {
        external_id: 'tshirt-price',
        description: 'Price: 310¥ Sizes: M•L•XL ZE019',
        photos: ['tshirt.jpg'],
      },
      {
        external_id: 'tshirt-details',
        description: 'Details',
        photos: ['tshirt-detail.jpg'],
      },
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', timeline)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      external_id: 'sneaker-price',
      description: timeline[1].description,
      photos: ['sneaker-detail.jpg', 'sneaker.jpg', 'sneaker-size.jpg'],
      attributes: {
        description_source_id: 'sneaker-description',
        size_chart_source_id: 'sneaker-size',
      },
    })
    expect(result[1]).toMatchObject({
      external_id: 'tshirt-price',
      description: timeline[5].description,
      photos: ['tshirt-detail.jpg', 'tshirt.jpg', 'tshirt-size.jpg'],
      attributes: {
        description_source_id: 'tshirt-description',
        size_chart_source_id: 'tshirt-size',
      },
    })
  })

  it('matches model sources when the supplier inconsistently pads the model number', async () => {
    const products = [
      {
        external_id: 'description',
        description: 'Полное описание рубашки из натуральной шерсти. Код модели: BC105',
        photos: [],
      },
      {
        external_id: 'size',
        description: 'The size grid BC0105',
        photos: ['size.jpg'],
      },
      {
        external_id: 'price',
        description: 'Price: 470¥ Sizes: M•L•XL BC0105',
        photos: ['price.jpg'],
      },
      {
        external_id: 'details',
        description: 'Details',
        photos: ['details.jpg'],
      },
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      description: products[0].description,
      photos: ['details.jpg', 'price.jpg', 'size.jpg'],
      attributes: {
        model_code: 'BC0105',
        description_source_id: 'description',
        size_chart_source_id: 'size',
      },
    })
  })

  it('keeps the Price text when the supplier omitted this model description', async () => {
    const products = [
      {
        external_id: 'other-description',
        description: 'Полное описание соседней модели, которое нельзя копировать. Код модели: LP074',
        photos: [],
      },
      {
        external_id: 'size',
        description: 'The size grid BC058',
        photos: ['size.jpg'],
      },
      {
        external_id: 'price',
        description: 'Price: 430¥ Sizes: M•L•XL BC058',
        photos: ['price.jpg'],
      },
      {
        external_id: 'details',
        description: 'Details',
        photos: ['details.jpg'],
      },
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      description: products[2].description,
      photos: ['details.jpg', 'price.jpg', 'size.jpg'],
    })
    expect(result[0].attributes).not.toHaveProperty('description_source_id')
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

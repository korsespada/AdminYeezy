import { describe, expect, it } from 'vitest'

const { runSupplierJsonProcess } = require('../../../scripts/lib/supplier-json-process')

describe('supplier JSON post-process contract', () => {
  it('builds CH clothing products from preceding detail albums and video cards', async () => {
    const products = [
      { external_id: 'separator-1', description: '➨', photos: [], source_position: 0, attributes: { szwego_parse_mode: 'all' } },
      { external_id: 'size', description: '尺码表', photos: ['size.jpg'], source_position: 1, attributes: { szwego_parse_mode: 'all' } },
      {
        external_id: 'video-red', description: '实拍视频 三色', photos: ['video-poster.jpg'], source_position: 2,
        attributes: { szwego_parse_mode: 'all', szwego_video_url: 'https://video/red.mp4', szwego_video_poster_url: 'https://video/red.webp' },
      },
      { external_id: 'model-red', description: '上身图参考 巨美啊', photos: ['model.jpg'], source_position: 3, attributes: { szwego_parse_mode: 'all' } },
      { external_id: 'packaging', description: '标配：配套YB雪梨纸 手提袋+6', photos: ['bag.jpg'], source_position: 4, attributes: { szwego_parse_mode: 'all' } },
      { external_id: 'detail-red', description: '红色局部细节参考', photos: ['detail-1.jpg', 'detail-2.jpg'], source_position: 5, attributes: { szwego_parse_mode: 'all' } },
      { external_id: 'detail-red-2', description: '红色局部细节', photos: ['detail-3.jpg'], source_position: 6, attributes: { szwego_parse_mode: 'all' } },
      {
        external_id: 'red-dress', description: '顶级版本 Chrome Hearts 克罗心 刺绣针织背心裙 面料与原版一致，全码现货。',
        photos: ['red-main-1.jpg', 'red-main-2.jpg'], source_position: 7, attributes: { szwego_parse_mode: 'all' },
      },
      { external_id: 'blue-detail', description: '局部细节参考', photos: ['blue-detail.jpg'], source_position: 8, attributes: { szwego_parse_mode: 'all' } },
      {
        external_id: 'blue-top', description: 'Chrome hearts 克罗心蓝黄撞色 七分袖数字马蹄印花撞色T恤 女款长袖T恤，夏天可以当防晒穿。',
        photos: ['blue-main.jpg'], source_position: 9, attributes: { szwego_parse_mode: 'all' },
      },
      { external_id: 'outfit', description: '配工装裤，随性松弛；搭短裙，甜辣平衡！', photos: ['outfit.jpg'], source_position: 10, attributes: { szwego_parse_mode: 'all' } },
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      external_id: 'red-dress',
      photos: ['red-main-1.jpg', 'red-main-2.jpg', 'detail-1.jpg', 'detail-2.jpg', 'detail-3.jpg'],
      attributes: {
        szwego_video_url: 'https://video/red.mp4',
        szwego_video_poster_url: 'https://video/red.webp',
      },
    })
    expect(result[1]).toMatchObject({
      external_id: 'blue-top',
      photos: ['blue-main.jpg', 'blue-detail.jpg'],
    })
  })

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
        photos: ['sneaker.jpg', 'sneaker-2.jpg', 'sneaker-3.jpg', 'sneaker-4.jpg', 'sneaker-5.jpg'],
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
      photos: ['sneaker-detail.jpg', 'sneaker.jpg', 'sneaker-2.jpg', 'sneaker-3.jpg', 'sneaker-4.jpg', 'sneaker-5.jpg', 'sneaker-size.jpg'],
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

  it('keeps shoe Price cards when the supplier omits Details and lists individual sizes', async () => {
    const timeline = [
      {
        external_id: 'header',
        description: '•———• MAN•———• SS26',
        photos: [],
      },
      {
        external_id: 'shoe-description',
        description: 'Культовые замшевые лоферы для мужчин. Мягкая конструкция, лёгкая подошва и премиальная отделка. Размеры 39 40 41 42 43 44. LP2539',
        photos: [],
      },
      {
        external_id: 'shoe-size',
        description: 'The size grid',
        photos: ['shoe-size.jpg'],
      },
      {
        external_id: 'shoe-video',
        description: 'Video of the original of shoes',
        photos: [],
      },
      {
        external_id: 'shoe-price-1',
        description: 'Price: 450¥ / 550¥ Sizes: 39 40 41 42 43 44 LP2539',
        photos: ['shoe-1-1.jpg', 'shoe-1-2.jpg', 'shoe-1-3.jpg', 'shoe-1-4.jpg', 'shoe-1-5.jpg', 'shoe-1-6.jpg'],
      },
      {
        external_id: 'shoe-price-2',
        description: 'Price: 450¥ / 550¥ Sizes: 39~46 LP2539',
        photos: ['shoe-2-1.jpg', 'shoe-2-2.jpg', 'shoe-2-3.jpg', 'shoe-2-4.jpg', 'shoe-2-5.jpg', 'shoe-2-6.jpg'],
      },
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', timeline)

    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        external_id: 'shoe-price-1',
        category: 'nzg3vsvajpiv1e8',
        description: timeline[1].description,
        photos: ['shoe-1-1.jpg', 'shoe-1-2.jpg', 'shoe-1-3.jpg', 'shoe-1-4.jpg', 'shoe-1-5.jpg', 'shoe-1-6.jpg', 'shoe-size.jpg'],
        attributes: expect.objectContaining({
          shoe_without_details: true,
          description_source_id: 'shoe-description',
          size_chart_source_id: 'shoe-size',
        }),
      }),
      expect.objectContaining({
        external_id: 'shoe-price-2',
        category: 'nzg3vsvajpiv1e8',
        description: timeline[1].description,
        photos: ['shoe-2-1.jpg', 'shoe-2-2.jpg', 'shoe-2-3.jpg', 'shoe-2-4.jpg', 'shoe-2-5.jpg', 'shoe-2-6.jpg', 'shoe-size.jpg'],
      }),
    ]))
  })

  it('drops shoe albums with fewer than six source photos', async () => {
    const timeline = [
      {
        external_id: 'shoe-description',
        description: 'Кроссовки из кожи. Размеры 39 40 41 42 43 44. LP3000',
        photos: [],
      },
      {
        external_id: 'shoe-price-short',
        description: 'Price: 450¥ Sizes: 39 40 41 42 43 44 LP3000',
        photos: ['shoe-1.jpg', 'shoe-2.jpg'],
      },
      {
        external_id: 'shoe-price-long',
        description: 'Price: 450¥ Sizes: 39 40 41 42 43 44 LP3000',
        photos: ['shoe-3.jpg', 'shoe-4.jpg', 'shoe-5.jpg', 'shoe-6.jpg', 'shoe-7.jpg', 'shoe-8.jpg'],
      },
    ].map((product, source_position) => ({
      ...product,
      source_position,
      attributes: { szwego_parse_mode: 'all' },
    }))

    const result = await runSupplierJsonProcess('merge_price_details.py', timeline)

    expect(result).toHaveLength(1)
    expect(result[0].external_id).toBe('shoe-price-long')
    expect(result[0].photos).toHaveLength(6)
  })

  it('keeps a letter suffix in the article and resolves the known brand prefix', async () => {
    const products = [{
      external_id: 'zegna-shoe',
      description: 'Price: 720¥ Sizes: 39-46 ZE2441B',
      photos: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'],
      source_position: 0,
      attributes: { szwego_parse_mode: 'all' },
    }]

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result[0]).toMatchObject({
      name: 'Zegna',
      brand: '8xod4z3cjpbltoa',
      attributes: { model_code: 'ZE2441B', shoe_without_details: true },
    })
  })

  it('keeps an unknown article visible without inventing its brand', async () => {
    const products = [{
      external_id: 'unknown-shoe',
      description: 'Price: 510¥ Sizes: 39-46 ST9999',
      photos: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'],
      source_position: 0,
      attributes: { szwego_parse_mode: 'all' },
    }]

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result[0]).toMatchObject({
      name: 'Модель ST9999',
      attributes: { model_code: 'ST9999', shoe_without_details: true },
    })
    expect(result[0].brand).toBeFalsy()
  })

  it('resolves the second Santoni model article alias', async () => {
    const products = [{
      external_id: 'santoni-shoe-2',
      description: 'Price: 510¥ Sizes: 39-46 ST2545-1M',
      photos: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'],
      source_position: 0,
      attributes: { szwego_parse_mode: 'all' },
    }]

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result[0]).toMatchObject({
      name: 'Santoni',
      brand: '7rwzlqrppoe8hue',
      attributes: { model_code: 'ST2545-1M', shoe_without_details: true },
    })
  })

  it('resolves an explicit model article alias to Santoni', async () => {
    const products = [{
      external_id: 'santoni-shoe',
      description: 'Price: 510¥ Sizes: 39-46 ST2579',
      photos: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg'],
      source_position: 0,
      attributes: { szwego_parse_mode: 'all' },
    }]

    const result = await runSupplierJsonProcess('merge_price_details.py', products)

    expect(result[0]).toMatchObject({
      name: 'Santoni',
      brand: '7rwzlqrppoe8hue',
      attributes: { model_code: 'ST2579', shoe_without_details: true },
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

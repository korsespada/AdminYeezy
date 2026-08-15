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
      { external_id: 'shorts-hardware', description: '原版五金一致 925制银做旧纽扣', photos: ['button.jpg'], source_position: 7, attributes: { szwego_parse_mode: 'all' } },
      {
        external_id: 'red-dress', description: '顶级版本 Chrome Hearts 克罗心 刺绣针织背心裙，配套雪梨纸全套包装，面料与原版一致，全码现货。',
        photos: ['red-main-1.jpg', 'red-main-2.jpg'], source_position: 8, attributes: { szwego_parse_mode: 'all' },
      },
      { external_id: 'blue-detail', description: '局部细节参考', photos: ['blue-detail.jpg'], source_position: 9, attributes: { szwego_parse_mode: 'all' } },
      {
        external_id: 'blue-top', description: 'Chrome hearts 克罗心蓝黄撞色 七分袖数字马蹄印花撞色T恤 女款长袖T恤，夏天可以当防晒穿。',
        photos: ['blue-main.jpg'], source_position: 10, attributes: { szwego_parse_mode: 'all' },
      },
      { external_id: 'outfit', description: '配工装裤，随性松弛；搭短裙，甜辣平衡！', photos: ['outfit.jpg'], source_position: 11, attributes: { szwego_parse_mode: 'all' } },
    ]

    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', products)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      external_id: 'red-dress',
      photos: ['red-main-1.jpg', 'red-main-2.jpg', 'detail-1.jpg', 'detail-2.jpg', 'detail-3.jpg', 'button.jpg'],
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

  it('keeps a main CH item when its description also mentions packaging', async () => {
    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', [
      {
        external_id: 'leather-shorts',
        description: 'Chrome Hearts CH克罗心 羊皮十字架卷轴五金短裤，925制银拉链，版型细节全部还原YB，CH 配套雪梨纸全套包装，全码现货。',
        photos: ['shorts.jpg'], source_position: 0, attributes: { szwego_parse_mode: 'all' },
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].external_id).toBe('leather-shorts')
  })

  it('drops CH promotional and factory albums without dropping a real product that mentions the same material or shipping terms', async () => {
    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', [
      { external_id: 'development-promo', description: '‼️原版开发‼️克罗心 最高版本 750 克 重磅 黑色 短裤 出货‼️', photos: ['promo.jpg'], source_position: 0, attributes: {} },
      { external_id: 'shipping-promo', description: '顶级 长袖 现货 秒发‼️', photos: ['shipping.jpg'], source_position: 1, attributes: {} },
      { external_id: 'stock-promo', description: '发货 发到过年 100个新款 在仓 现货秒发‼️', photos: ['stock.jpg'], source_position: 2, attributes: {} },
      { external_id: 'factory-promo', description: '真正顶级工艺：热固油材质印花‼️', photos: ['factory.jpg'], source_position: 3, attributes: {} },
      { external_id: 'fabric-promo', description: '自然光下 直线距离感受一下 原版暗纹面料‼️', photos: ['fabric.jpg'], source_position: 4, attributes: {} },
      { external_id: 'craft-promo', description: '真正的手工制作工艺 手工热固油‼️ 成本是普通的三倍', photos: ['craft.jpg'], source_position: 5, attributes: {} },
      {
        external_id: 'real-product',
        description: 'Chrome Hearts 克罗心短袖T恤，成衣采用热固油材质印花，尺码 S M L XL，全码现货秒发。',
        photos: ['real-product.jpg'], source_position: 6, attributes: {},
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].external_id).toBe('real-product')
  })

  it('keeps missing CH tank tops and hockey jerseys while dropping marked promo and lifestyle albums', async () => {
    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', [
      { external_id: 'tank-red', description: 'Chrome Hearts 克罗心ch 针织 经典中古款 红色十字架梵文印花背心 红黑撞色很飒 大爆款 面料采用220g螺纹弹性面料，尺码：S M L', photos: ['tank-red.jpg'], source_position: 0, attributes: {} },
      { external_id: 'tank-white', description: 'Chrome Hearts 克罗心ch 针织 经典中古款 爱心蔓藤白色限定款印花背心 大爆款 面料采用220g螺纹弹性面料，尺码：S M L', photos: ['tank-white.jpg'], source_position: 1, attributes: {} },
      { external_id: 'hockey', description: 'chrome hearts ch 克罗心 真正1:1顶级出货 双层网眼运动休闲双面背心，男女同款。定织定染白色网眼面料，双层设计更有质感。', photos: ['hockey.jpg'], source_position: 2, attributes: {} },
      { external_id: 'development', description: '‼️原版开发克罗心最高版本 palo裙 手工缝 925 银扣', photos: ['development.jpg'], source_position: 3, attributes: {} },
      { external_id: 'showcase', description: '这红色就像往脸上打光了一样显白', photos: ['showcase.jpg'], source_position: 4, attributes: {} },
      { external_id: 'mattyboy', description: 'YB展示 Mattyboy最后一次联名', photos: ['mattyboy.jpg'], source_position: 5, attributes: {} },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['tank-red', 'tank-white', 'hockey'])
  })

  it('merges an adjacent long presentation album with its short matching album, without merging ordinary colour cards', async () => {
    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', [
      {
        external_id: 'velvet-presentation',
        description: 'chrome hearts ch 克罗心 丝绒十字架镂空肚兜 面料采用定制原版高端丝绒材质，达到YB 100%相似度。',
        photos: Array.from({ length: 10 }, (_, index) => `presentation-${index}.jpg`), source_position: 0, attributes: {},
      },
      {
        external_id: 'velvet-set',
        description: 'chrome hearts ch 克罗心 丝绒十字架镂空吊带 面料采用定制原版高端丝绒材质，达到YB 100%相似度。',
        photos: Array.from({ length: 4 }, (_, index) => `set-${index}.jpg`), source_position: 1, attributes: {},
      },
      {
        external_id: 'grey-shorts',
        description: 'Chrome Hearts 克罗心 灰色十字架短裤，面料与原版一致。',
        photos: ['grey-1.jpg', 'grey-2.jpg', 'grey-3.jpg', 'grey-4.jpg'], source_position: 2, attributes: {},
      },
      {
        external_id: 'black-shorts',
        description: 'Chrome Hearts 克罗心 黑色十字架短裤，面料与原版一致。',
        photos: ['black-1.jpg', 'black-2.jpg', 'black-3.jpg', 'black-4.jpg'], source_position: 3, attributes: {},
      },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['velvet-presentation', 'grey-shorts', 'black-shorts'])
    expect(result[0].photos).toHaveLength(14)
  })

  it('drops marked stock, factory and model-showcase albums without dropping a plain product card', async () => {
    const result = await runSupplierJsonProcess('process_ch_clothing_timeline.py', [
      { external_id: 'stock', description: '顶级 套装系列 秒发‼️', photos: ['stock.jpg'], source_position: 0, attributes: {} },
      { external_id: 'quality', description: '辅料 质检 三层升级‼️', photos: ['quality.jpg'], source_position: 1, attributes: {} },
      { external_id: 'factory', description: '顶级 生产 实拍素材‼️', photos: ['factory.jpg'], source_position: 2, attributes: {} },
      { external_id: 'fabric', description: '自然光下 直线距离感受一下 原版暗纹面料‼️', photos: ['fabric.jpg'], source_position: 3, attributes: {} },
      { external_id: 'lookbook', description: '暗黑系公主 做内搭都完美', photos: ['model.jpg'], source_position: 4, attributes: {} },
      { external_id: 'real', description: 'Chrome Hearts 克罗心长袖T恤，定织纯棉面料，黑色荧光绿刺绣图案，尺码 S M L。', photos: ['real.jpg'], source_position: 5, attributes: {} },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['real'])
  })

  it('builds a Chanel gallery as main, matching details, then packaging, and attaches the nearby video', async () => {
    const products = [
      {
        external_id: 'packaging',
        description: '包装展示',
        photos: ['bundle-1.jpg'],
        source_position: 0,
        attributes: { szwego_tags: ['26a 口盖小波点'] },
      },
      {
        external_id: 'video',
        description: '实拍视频',
        photos: ['video-poster.jpg'],
        source_position: 1,
        attributes: {
          szwego_tags: ['26a 口盖小波点'],
          szwego_video_url: 'https://video/chanel.mp4',
          szwego_video_poster_url: 'https://video/chanel.webp',
        },
      },
      {
        external_id: 'main',
        description: '26a 口盖小波点 托斯卡纳羊皮 黑色波点很有复古氛围',
        photos: Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`),
        source_position: 2,
        attributes: { szwego_tags: ['26a 口盖小波点'] },
      },
      {
        external_id: 'details',
        description: '26a 口盖小波点 款号 AS6513 尺寸：15x25.5x6.5cm',
        photos: ['main-0.jpg', 'detail-1.jpg', 'detail-2.jpg', 'detail-3.jpg'],
        source_position: 3,
        attributes: { szwego_tags: ['26a 口盖小波点'] },
      },
      {
        external_id: 'junk',
        description: '合集 26a 多个不相干款式',
        photos: ['junk.jpg'],
        source_position: 4,
        attributes: {},
      },
    ]

    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', products)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'main',
      description: '26a 口盖小波点 托斯卡纳羊皮 黑色波点很有复古氛围\n\n26a 口盖小波点 款号 AS6513 尺寸：15x25.5x6.5cm',
      source_position: 2,
      attributes: {
        szwego_video_url: 'https://video/chanel.mp4',
        szwego_video_poster_url: 'https://video/chanel.webp',
      },
    })
    expect(result[0].photos).toEqual([
      ...Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`),
      'detail-1.jpg',
      'detail-2.jpg',
      'detail-3.jpg',
      'bundle-1.jpg',
    ])
  })

  it('uses exact Szwego tags for a one-photo Chanel accessory without requiring a detail album', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      {
        external_id: 'other-packaging', description: '包装展示', photos: ['other-bundle.jpg'], source_position: 0,
        attributes: { szwego_tags: ['другая модель'] },
      },
      {
        external_id: 'accessory-packaging', description: '包装展示 翻盖卡包', photos: ['cardholder-bundle.jpg'], source_position: 1,
        attributes: { szwego_tags: ['翻盖卡包'] },
      },
      {
        external_id: 'accessory-video', description: '翻盖卡包 视频', photos: [], source_position: 2,
        attributes: { szwego_tags: ['翻盖卡包'], szwego_video_url: 'https://video/cardholder.mp4' },
      },
      {
        external_id: 'cardholder', description: '翻盖卡包 黑金色，尺寸：7.5x11.3x2.1cm', photos: ['cardholder-main.jpg'], source_position: 3,
        attributes: { szwego_tags: ['翻盖卡包'] },
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      external_id: 'cardholder',
      photos: ['cardholder-main.jpg', 'cardholder-bundle.jpg'],
      attributes: {
        szwego_tags: ['翻盖卡包'],
        szwego_video_url: 'https://video/cardholder.mp4',
      },
    })
  })

  it('never merges unrelated cards from a shared generic Chinese phrase when tags are unavailable', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      {
        external_id: 'main', description: '26a 黑色口盖包 整体包型和五金细节清晰',
        photos: Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`), source_position: 0, attributes: {},
      },
      {
        external_id: 'other', description: '26b 白色链条包 整体包型和五金细节需要调整',
        photos: ['other-1.jpg', 'other-2.jpg', 'other-3.jpg'], source_position: 1, attributes: {},
      },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['main', 'other'])
    expect(result[0].photos).toHaveLength(9)
  })

  it('does not treat a missing structured tag as the shared string none', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      {
        external_id: 'main', description: '26a 黑色口盖包',
        photos: Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`), source_position: 0,
        attributes: { szwego_tags: null },
      },
      {
        external_id: 'other', description: '26b 白色链条包',
        photos: ['other-1.jpg', 'other-2.jpg'], source_position: 1,
        attributes: {},
      },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['main', 'other'])
  })

  it('keeps only the first matching detail album and drops later lookbook shots on another background', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      {
        external_id: 'main', description: 'cf23 球纹 黑金',
        photos: Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`), source_position: 0,
        attributes: { szwego_tags: ['cf23 球纹'] },
      },
      {
        external_id: 'details', description: 'cf23 球纹 五金细节',
        photos: ['detail-1.jpg', 'detail-2.jpg', 'detail-3.jpg', 'detail-4.jpg'], source_position: 1,
        attributes: { szwego_tags: ['cf23 球纹'] },
      },
      {
        external_id: 'lookbook', description: 'cf23 球纹',
        photos: ['model-background-1.jpg', 'model-background-2.jpg', 'model-background-3.jpg'], source_position: 2,
        attributes: { szwego_tags: ['cf23 球纹'] },
      },
      {
        external_id: 'next-main', description: 'cf25 黑金 主图',
        photos: Array.from({ length: 9 }, (_, index) => `next-${index}.jpg`), source_position: 3,
        attributes: { szwego_tags: ['cf25'] },
      },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['main', 'next-main'])
    expect(result[0].photos).toEqual([
      ...Array.from({ length: 9 }, (_, index) => `main-${index}.jpg`),
      'detail-1.jpg', 'detail-2.jpg', 'detail-3.jpg', 'detail-4.jpg',
    ])
  })

  it('puts the richer following product album before its preceding close-up detail album', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      {
        external_id: 'closeups', description: '26a 口盖小波点 款号：AS6513 尺寸：15x25.5x6.5cm',
        photos: Array.from({ length: 9 }, (_, index) => `closeup-${index}.jpg`), source_position: 0,
        attributes: { szwego_tags: ['26a 口盖小波点'] },
      },
      {
        external_id: 'main', description: '26a 口盖小波点 托斯卡纳羊皮搭配黑色波点，毛绒手感柔软，复古氛围浓郁。',
        photos: ['main-1.jpg', 'main-2.jpg', 'main-3.jpg', 'main-4.jpg'], source_position: 1,
        attributes: { szwego_tags: ['26a 口盖小波点'] },
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].photos).toEqual([
      'main-1.jpg', 'main-2.jpg', 'main-3.jpg', 'main-4.jpg',
      ...Array.from({ length: 9 }, (_, index) => `closeup-${index}.jpg`),
    ])
    expect(result[0].description.startsWith('26a 口盖小波点 托斯卡纳羊皮')).toBe(true)
  })

  it('drops Chanel first-version and material-progress posts instead of listing them as products', async () => {
    const result = await runSupplierJsonProcess('process_chanel_bags_timeline.py', [
      { external_id: 'first-version', description: '26a 链条法棍鹿棕已出首版 与zp高度相似，下一版继续调整', photos: ['a.jpg'], source_position: 0, attributes: {} },
      { external_id: 'progress', description: '26b 双c小鹿棕【对皮进度】原厂麂皮，避免阳光直晒', photos: ['b.jpg'], source_position: 1, attributes: {} },
      { external_id: 'main', description: '26a 黑色链条包 日常通勤可单肩斜挎', photos: ['main.jpg'], source_position: 2, attributes: {} },
    ])

    expect(result.map((product: { external_id: string }) => product.external_id)).toEqual(['main'])
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

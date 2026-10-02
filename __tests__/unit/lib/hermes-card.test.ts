import { describe, expect, it } from 'vitest'
import { parseHermesCardFacts, hermesColourDisplay, parseHermesColour } from '@/lib/hermes-card-facts'
import { buildHermesCardProposal, extractHermesModel, extractHermesSizeToken } from '@/lib/hermes-card-build'
import { buildHermesCardSlug, colourSlugValue, hardwareSlugValue, materialSlugValue } from '@/lib/hermes-card-slug'

/**
 * Примеры взяты из реальных карточек поставщика Hermes: старая карточка с блоком
 * «Описание:», карточка с фурнитурой внутри текста, обувь с размерным рядом.
 */

const LINDY = `Стиль: Lindy

Цвет: 18/etoupe

Материал: Clemence

Размер: 26*18*12cm

Описание: Сумка Lindy 26, цвет "слоновая кость", изготовлена из французской импортной натуральной кожи TC, с золотой фурнитурой. Высококачественная, полностью ручная работа, эксклюзивная кастомизация. Фотографии реального заказа клиента.`

const BIRKIN = `Стиль: Birkin
Цвет: 89/Noir
Материал: Swift
Размер: 25*20*13cm
Описание: Из Франции. Фурнитура: серебро. Платина 25см, черный, французская импортная оригинальная коровья кожа Togo, серебряная пряжка, эксклюзивная индивидуальная настройка высшего класса, полностью ручная работа!! Реальные фотографии по заказу клиента`

const OASIS = `Стиль: Высокие босоножки-слайдеры Oasis.
Цвет: Абрикосовый.
Материал: Верх из кожи ящерицы. Кожа ящерицы импортирована из Франции, изначально из Южной Африки.
Размер: Доступны размеры от 34 до 41, включая полуразмеры. Данный продукт изготовлен из редкой кожи ящерицы, поэтому возврату и обмену не подлежит.
Описание: Изделие полностью изготовлено вручную.`

describe('parseHermesCardFacts', () => {
  it('разбирает старую карточку с блоком «Описание»', () => {
    const facts = parseHermesCardFacts(LINDY)
    expect(facts.style).toBe('Lindy')
    expect(facts.colourCode).toBe('18')
    expect(facts.colourName).toBe('etoupe')
    expect(facts.colourDisplay).toBe('18/Etoupe')
    expect(facts.material).toBe('Clemence')
    expect(facts.sizeNumbers).toEqual([26, 18, 12])
    expect(facts.sizeKind).toBe('dimensions')
    expect(facts.hasFieldBlock).toBe(true)
    expect(facts.body).toContain('французской импортной')
  })

  it('берёт фурнитуру из текста, когда отдельного ключа нет', () => {
    expect(parseHermesCardFacts(LINDY).hardwareKind).toBe('gold')
  })

  it('предпочитает явный ключ «Фурнитура:» внутри текста', () => {
    const facts = parseHermesCardFacts(BIRKIN)
    expect(facts.hardwareRaw).toBe('серебро')
    expect(facts.hardwareKind).toBe('silver')
    expect(facts.hardwareConflict).toBe(false)
  })

  it('не угадывает фурнитуру, когда в тексте и золото, и серебро', () => {
    const facts = parseHermesCardFacts(`Стиль: Kelly
Цвет: 89/noir
Размер: 28*22*10cm
Описание: Золотая фурнитура, серебряная пряжка и ручная гравировка.`)
    expect(facts.hardwareKind).toBeNull()
    expect(facts.hardwareConflict).toBe(true)
  })

  it('различает размерный ряд обуви и габариты сумки', () => {
    const shoes = parseHermesCardFacts(OASIS)
    expect(shoes.sizeRange).toEqual({ from: 34, to: 41 })
    expect(shoes.sizeKind).toBe('range')
    expect(shoes.sizeNumbers).toEqual([34, 41])
  })

  it('берёт внутренний цвет Hermes из скобок и убирает перевод', () => {
    const shoes = parseHermesCardFacts(`Стиль: CHYPRE SANDAL Цвет: Черный (ck89/noir) Материал: Замша Размер: 34-42 Описание: Сандалии ручной работы.`)
    expect(shoes.colourDisplay).toBe('ck89/Noir')
    expect(shoes.colourGloss).toBe('Черный')
    expect(shoes.material).toBe('Замша')
    expect(shoes.sizeRange).toEqual({ from: 34, to: 42 })

    const russianGloss = parseHermesCardFacts(`Стиль: Oran Цвет: Raisin (виноградный фиолетовый) Материал: Шерсть Размер: 34-41`)
    expect(russianGloss.colourDisplay).toBe('Raisin')
    expect(russianGloss.colourGloss).toBe('виноградный фиолетовый')

    const codeOnly = parseHermesCardFacts(`Стиль: Oran Цвет: Золотисто-коричневый (CK37) Материал: Страусиная кожа Размер: 34-41`)
    expect(codeOnly.colourDisplay).toBe('Золотисто-коричневый (CK37)')

    const latinWithCode = parseHermesCardFacts(`Стиль: Oran Цвет: Blue izmir (7W) Материал: Крокодилья кожа Размер: 34-41`)
    expect(latinWithCode.colourDisplay).toBe('7W/Blue Izmir')
  })

  it('обрезает значение поля по встроенному ключу блока', () => {
    const facts = parseHermesCardFacts(`Стиль: Обувь Цвет: Red Материал: Кожа Размер: Описание: Эксклюзивные товары в наличии.`)
    expect(facts.colourRaw).toBe('Red')
    expect(facts.material).toBe('Кожа')
    expect(facts.sizeRaw).toBeNull()
    expect(facts.style).toBe('Обувь')
  })

  it('берёт цвет из свободного текста, когда поля «Цвет» нет', () => {
    expect(parseHermesCardFacts('Кабинный чемодан выполнен в бордовом цвете с серебристой фурнитурой.').colourDisplay).toBe('Бордовый')
    expect(parseHermesCardFacts('Чемодан выполнен в сером цвете, вес около 4 кг.').colourDisplay).toBe('Серый')
    // Сложные формулировки не угадываем: остаётся предупреждение и решение оператора.
    expect(parseHermesCardFacts('Модель в зелёно-бежевой гамме дополнена ручкой.').colourDisplay).toBeNull()
  })

  it('распознаёт код и имя цвета Hermes', () => {
    expect(parseHermesColour('89/Noir')).toEqual({ code: '89', name: 'Noir' })
    expect(parseHermesColour('Etoupe')).toEqual({ code: null, name: 'Etoupe' })
    expect(parseHermesColour('i2/Nata')).toEqual({ code: 'i2', name: 'Nata' })
    expect(hermesColourDisplay('0V', 'gris ciment')).toBe('0V/Gris Ciment')
    expect(hermesColourDisplay(null, 'Pebble Beige')).toBe('Pebble Beige')
  })
})

describe('extractHermesModel', () => {
  it('убирает размер и тип изделия', () => {
    expect(extractHermesModel('Birkin 25')).toBe('Birkin')
    expect(extractHermesModel('Kelly Mini 19*12*5.5')).toBe('Kelly Mini')
    expect(extractHermesModel('Bouncing Кроссовки')).toBe('Bouncing')
    expect(extractHermesModel('Высокие босоножки-слайдеры Oasis')).toBe('Oasis')
    expect(extractHermesModel('625 Bouncing')).toBe('Bouncing')
  })

  it('сохраняет номер поколения модели', () => {
    expect(extractHermesModel('Kelly Mini 2')).toBe('Kelly Mini 2')
  })

  it('сохраняет составную модель с цифрами и слэшем', () => {
    expect(extractHermesModel('24/24 Mini')).toBe('24/24 Mini')
    expect(extractHermesModel('24/24')).toBe('24/24')
  })

  it('не считает моделью русский тип изделия', () => {
    expect(extractHermesModel('Дел-тренер кроссовки')).toBeNull()
  })
})

describe('extractHermesSizeToken', () => {
  it('берёт размер из названия, иначе ширину габаритов', () => {
    expect(extractHermesSizeToken('Lindy 26', parseHermesCardFacts(LINDY), 'Lindy')).toBe('26')
    const constance = parseHermesCardFacts(`Стиль: Constance
Цвет: Y9/Dorè
Размер: 12.4*10.2*3cm
Описание: Ручная работа.`)
    expect(extractHermesSizeToken('Constance Slim', constance, 'Constance Slim')).toBeNull()
  })

  it('не подставляет размер, если его не было в названии', () => {
    const facts = parseHermesCardFacts(`Стиль: 24/24
Размер: 29 x 20 x 14 см
Описание: Ручная работа.`)
    // 24/24 — модель, а не размер; 29 см — ширина габаритов, её в название не берём.
    expect(extractHermesSizeToken('24/24', facts, '24/24')).toBeNull()
  })

  it('берёт размер из названия и не путает его с моделью', () => {
    const facts = parseHermesCardFacts('Стиль: Birkin\nРазмер: 25 x 20 x 13 см\nОписание: Ручная работа.')
    expect(extractHermesSizeToken('Birkin 25', facts, 'Birkin')).toBe('25')
  })
})

describe('buildHermesCardSlug', () => {
  it('собирает адрес как бренд-модель-размер-цвет-фурнитура-материал-артикул', () => {
    const result = buildHermesCardSlug({
      brandSlug: 'hermes',
      article: 'HER-46911',
      modelName: 'Birkin',
      sizeToken: '25',
      colour: '89/Noir',
      hardwareKind: 'silver',
      material: 'Swift',
      kind: 'bag',
    })
    expect(result.slug).toBe('hermes-birkin-25-89-noir-silver-swift-her-46911')
    expect(result.warnings).toEqual([])
  })

  it('у обуви размера в адресе нет, а каблук в адрес не входит', () => {
    const result = buildHermesCardSlug({
      brandSlug: 'hermes',
      article: 'HER-21092',
      modelName: 'Jet',
      sizeToken: '39',
      colour: 'Черный',
      hardwareKind: null,
      material: 'Козья кожа, замша',
      kind: 'shoe',
    })
    expect(result.slug).toBe('hermes-jet-chernyy-goat-leather-suede-her-21092')
  })

  it('берёт латинское значение материала из описания', () => {
    expect(materialSlugValue('Кожа Swift, кожа матового аллигатора (крокодил) из Франции.')).toBe('swift')
    expect(materialSlugValue('Импортный аллигатор из Франции / Родом из Миссисипи.')).toBe('alligator')
    expect(materialSlugValue('chèvre From France')).toBe('chèvre')
    expect(materialSlugValue('Кожа ящерицы')).toBe('lizard')
    expect(materialSlugValue('натуральная кожа ягненка')).toBe('lambskin')
    expect(materialSlugValue('Козья кожа, замша')).toBe('goat-leather-suede')
  })

  it('пишет фурнитуру латиницей, включая палладий', () => {
    expect(hardwareSlugValue('silver', 'серебро')).toBe('silver')
    expect(hardwareSlugValue('silver', 'Палладий')).toBe('palladium')
    expect(hardwareSlugValue('gold', 'золотая фурнитура')).toBe('gold')
    expect(hardwareSlugValue('rose', 'розовое золото')).toBe('rose-gold')
  })

  it('в адрес берёт только первый код и первое имя цвета', () => {
    expect(colourSlugValue('37/Gold/2S/Sesame')).toBe('37-gold')
    expect(colourSlugValue('D2/New Blue Jean/B4/Sun')).toBe('d2-new-blue-jean')
    expect(colourSlugValue('89/Noir')).toBe('89-noir')
    expect(colourSlugValue('Абрикосовый')).toBe('abrikosovyy')
    const result = buildHermesCardSlug({
      brandSlug: 'hermes',
      article: 'HER-15013',
      modelName: 'Kelly To Go Tressage',
      sizeToken: '20',
      colour: '37/Gold/2S/Sesame',
      hardwareKind: 'silver',
      material: 'Epsom',
      kind: 'bag',
    })
    expect(result.slug).toBe('hermes-kelly-to-go-tressage-20-37-gold-silver-epsom-her-15013')
  })

  it('обрезает адрес до 160 знаков, сохраняя артикул', () => {
    const result = buildHermesCardSlug({
      brandSlug: 'hermes',
      article: 'HER-46911',
      modelName: 'Kelly Colormatic Tressage Limited Edition',
      sizeToken: '25',
      colour: 'i2/Nata',
      hardwareKind: 'gold',
      material: 'Импортный аллигатор из Франции Родом из Миссисипи',
      kind: 'bag',
    })
    expect(result.slug.length).toBeLessThanOrEqual(160)
    expect(result.slug.endsWith('her-46911')).toBe(true)
  })
})

describe('buildHermesCardProposal', () => {
  it('собирает название с моделью, размером и цветом и характеристики для сумки', () => {
    const proposal = buildHermesCardProposal({
      name: 'Lindy 26',
      description: LINDY,
      attributes: {
        colors: { display_value: 'etoupe' },
        materials: { display_value: 'Clemence' },
        model_name: { value: 'Lindy' },
      },
      mediaCount: 3,
      kind: 'bag',
      categoryName: 'Сумки на плечо',
      brandSlug: 'hermes',
      article: 'HER-10993',
    })

    expect(proposal.name).toBe('Сумка Lindy 26 см Clemence 18/Etoupe')
    expect(proposal.typeWord).toBe('Сумка')
    expect(proposal.slug).toBe('hermes-lindy-26-18-etoupe-gold-clemence-her-10993')
    expect(proposal.modelName).toBe('Lindy')
    expect(proposal.kind).toBe('bag')
    expect(proposal.attributePatch).toMatchObject({
      model_name: 'Lindy',
      dimensions: '26 × 18 × 12 см',
      bag_width_cm: 26,
      bag_height_cm: 18,
      hardware_color: 'Золотистая',
    })
    // Существующие цвета и материалы сохраняются как есть.
    expect(proposal.attributes.colors).toEqual({ display_value: 'etoupe' })
    expect(proposal.attributes.materials).toEqual({ display_value: 'Clemence' })
    expect(proposal.attributePatch.supplier_color).toBe('18/Etoupe')
    expect(proposal.photoAlts).toEqual(['Сумка Lindy 26 см Clemence 18/Etoupe', 'Сумка Lindy 26 см Clemence 18/Etoupe', 'Сумка Lindy 26 см Clemence 18/Etoupe'])
    expect(proposal.warnings).toEqual([])
  })

  it('переносит габариты с дробной глубиной в формате каталога', () => {
    const proposal = buildHermesCardProposal({
      name: 'Constance Slim',
      description: `Стиль: Constance
Цвет: Y9/Dorè
Кожа: Chèvre
Размер: 12.4*10.2*3cm
Фурнитура: Gold
Описание: Ручная работа.`,
      attributes: { model_name: { value: 'Constance' } },
      mediaCount: 1,
      kind: 'bag',
    })
    expect(proposal.name).toBe('Constance Slim Chèvre Y9/Dorè')
    expect(proposal.attributePatch.dimensions).toBe('12,4 × 10,2 × 3 см')
    expect(proposal.attributePatch.hardware_color).toBe('Золотистая')
    // Размера в исходном названии нет — в новое название он не подставляется.
    expect(proposal.warnings).not.toContain('размер в названии не найден')
  })

  it('для обуви не пишет габариты, заполняет материалы и размерный ряд', () => {
    const proposal = buildHermesCardProposal({
      name: 'Oasis High Босоножки',
      description: OASIS,
      attributes: {
        model_name: { value: 'Oasis' },
      },
      kind: 'auto',
      categoryName: 'Шлепанцы и тапочки',
      gender: 'Для женщин',
      brandSlug: 'hermes',
      article: 'HER-16926',
    })
    expect(proposal.kind).toBe('shoe')
    expect(proposal.name).toBe('Сандалии Oasis High кожа абрикосовые')
    expect(proposal.slug).toBe('hermes-oasis-high-abrikosovyy-lizard-her-16926')
    expect(proposal.attributePatch.dimensions).toBeUndefined()
    expect(proposal.attributePatch.bag_width_cm).toBeUndefined()
    expect(proposal.attributePatch.materials).toEqual(['Кожа ящерицы'])
    expect(proposal.attributePatch.upper_material).toBe('Кожа ящерицы')
    expect(proposal.attributePatch.colors).toEqual(['Абрикосовый'])
    expect(proposal.attributePatch.size_system).toBe('EU')
    expect(proposal.attributePatch.sizes).toEqual({
      groups: [{ system: 'EU', values: ['34', '35', '36', '37', '38', '39', '40', '41'], audience: 'female' }],
      values: ['34', '35', '36', '37', '38', '39', '40', '41'],
    })
    expect(proposal.warnings).toEqual([])
  })

  it('не пишет размерный ряд, если он уже есть в характеристиках', () => {
    const proposal = buildHermesCardProposal({
      name: 'Oasis High Босоножки',
      description: OASIS,
      attributes: { sizes: { values: ['34', '41'] }, model_name: { value: 'Oasis' } },
      kind: 'shoe',
      categoryName: 'Шлепанцы и тапочки',
    })
    expect(proposal.attributePatch.sizes).toBeUndefined()
    expect(proposal.attributes.sizes).toEqual({ values: ['34', '41'] })
  })

  it('собирает материал из свободного текста, когда блока «Материал» нет', () => {
    const proposal = buildHermesCardProposal({
      name: 'R.M.S Cabin чемодан 20 дюймов',
      description: `Стиль: R.M.S Cabin
Цвет: Коричневый
Размер: 35 × 57 × 20 см
Описание: Корпус выполнен из кожи taurillon Regate и холста H canvas, дополнен серебристой фурнитурой.`,
      attributes: { model_name: { value: 'R.M.S Cabin' } },
      kind: 'bag',
      categoryName: 'Чемоданы',
    })
    expect(proposal.attributePatch.materials).toEqual(['Кожа Taurillon Regate', 'Холст H canvas'])
    expect(proposal.warnings).toContain('материал собран из текста описания')
    expect(proposal.name).toBe('Чемодан R.M.S Cabin 20 см Taurillon Regate коричневый')
  })

  it('собирает материал из карточек без блока характеристик', () => {
    const proposal = buildHermesCardProposal({
      name: 'Чемодан из кожи и холста',
      description: 'Чемодан для ручной клади размером 35,1 × 20 × 56,9 см. Конструкция сочетает кожу taurillon Regate и холст H canvas: коричневые кожаные панели дополнены светлыми текстильными вставками.',
      attributes: {},
      kind: 'bag',
      categoryName: 'Чемоданы',
    })
    expect(proposal.attributePatch.materials).toEqual(['Кожа Taurillon Regate', 'Холст H canvas'])
  })

  it('вытаскивает подошву, подкладку и каблук из текста обуви', () => {
    const proposal = buildHermesCardProposal({
      name: 'Bouncing Кроссовки',
      description: `Стиль: 625 Bouncing
Цвет: Черный
Материал: Козья кожа, замша
Размер: 35-40
Описание: Спортивные кроссовки с верхом из козьей кожи и замши. Внутренняя подошва и подкладка выполнены из козьей кожи. Высота каблука составляет 4 см.`,
      attributes: { model_name: { value: 'Bouncing' } },
      kind: 'auto',
      categoryName: 'Кроссовки и кеды',
    })
    expect(proposal.name).toBe('Кроссовки Bouncing кожа черные')
    expect(proposal.attributePatch.upper_material).toBe('Козья кожа, замша')
    expect(proposal.attributePatch.heel_height).toBe(4)
    // Кожа подошвой не бывает: «внутренняя подошва» — это стелька.
    expect(proposal.attributePatch.sole_material).toBeUndefined()
    expect(proposal.attributePatch.lining_material).toBe('Кожа')
  })

  it('подошву пишет только по не-кожаному материалу', () => {
    const proposal = buildHermesCardProposal({
      name: 'Chypre Сандалии',
      description: `Стиль: CHYPRE SANDAL
Цвет: Черный (ck89/noir)
Материал: Замша
Размер: 34-42
Описание: Сандалии с кожаной стелькой. Подошва — из резины.`,
      attributes: { model_name: { value: 'Chypre' } },
      kind: 'shoe',
      categoryName: 'Шлепанцы и тапочки',
    })
    expect(proposal.attributePatch.colors).toEqual(['Черный'])
    expect(proposal.attributePatch.supplier_color).toBe('ck89/Noir')
    expect(proposal.attributePatch.sole_material).toBe('Резина')
  })

  it('принимает модель из цифр и символов', () => {
    const proposal = buildHermesCardProposal({
      name: '24/24',
      description: `Стиль: 24/24
Цвет: 18/Etoupe
Кожа: Evercolor
Размер: 29 x 20 x 14 см
Фурнитура: Серебро
Материалы: Кожа, металл`,
      attributes: {},
      kind: 'bag',
    })
    expect(proposal.modelName).toBe('24/24')
    expect(proposal.name).toBe('24/24 Evercolor 18/Etoupe')
    expect(proposal.attributePatch.hardware_color).toBe('Серебристая')
  })

  it('переливает старое поле hardware в hardware_color и удаляет его', () => {
    const proposal = buildHermesCardProposal({
      name: 'Kelly 28',
      description: `Стиль: Kelly
Цвет: 89/noir
Материал: Box
Размер: 28*22*10cm
Описание: Полностью ручная работа.`,
      attributes: { hardware: { value: 'silver', display_value: 'Серебро' }, model_name: { value: 'Kelly' } },
      kind: 'bag',
    })
    expect(proposal.attributePatch.hardware_color).toBe('Серебристая')
    expect(proposal.attributes.hardware).toBeUndefined()
    expect(proposal.warnings).toContain('фурнитура взята из старого поля hardware')
  })

  it('предупреждает, когда цвета в карточке нет', () => {
    const proposal = buildHermesCardProposal({
      name: 'Birkin 30',
      description: `Стиль: Birkin
Материал: Togo
Размер: 30*25*18cm
Описание: Ручная работа.`,
      attributes: { model_name: { value: 'Birkin 30' } },
      kind: 'bag',
    })
    expect(proposal.name).toBe('Birkin 30 см Togo')
    expect(proposal.warnings).toContain('цвет в карточке не указан')
  })

  it('сохраняет код цвета Hermes в названии', () => {
    const proposal = buildHermesCardProposal({
      name: 'Kelly Colormatic 25',
      description: `Стиль: Kelly
Цвет: i2/Nata
Материал: Swift
Размер: 25*17*7cm
Описание: Ручная работа.`,
      attributes: { model_name: { value: 'Kelly Colormatic' } },
      kind: 'bag',
    })
    expect(proposal.name).toBe('Kelly Colormatic 25 см Swift i2/Nata')
    expect(proposal.modelName).toBe('Kelly Colormatic')
  })
})

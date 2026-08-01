export type CatalogAttributeValueType = 'text' | 'number' | 'enum' | 'multi_enum' | 'size'

export interface CatalogAttributeDictionaryValue {
  id: string
  attribute_code: string
  filter_value: string
  canonical_value: string
  aliases: string[]
  sort_order: number
  active: boolean
}

export interface CatalogAttributeDefinition {
  code: string
  label: string
  category_scope: string
  value_type: CatalogAttributeValueType
  show_as_characteristic: boolean
  use_as_filter: boolean
  use_as_variant_dimension: boolean
  parser_rules: string[]
  aliases: string[]
  values?: string[]
  dictionary_values?: CatalogAttributeDictionaryValue[]
  unit?: string
  sort_order: number
  active: boolean
}

type CategoryRule = {
  category: string
  attributes: string[]
  subcategories?: Record<string, string[]>
}

const COMMON_ATTRIBUTE_CODES = ['colors', 'model_name']

export const CATALOG_ATTRIBUTE_DEFINITIONS: CatalogAttributeDefinition[] = [
  definition('colors', 'Цвет', 'Все категории', 'multi_enum', 10, {
    filter: true,
    aliases: ['color', 'цвет', 'цвета'],
    values: ['Чёрный', 'Белый', 'Бежевый', 'Коричневый', 'Серый', 'Синий', 'Красный', 'Розовый', 'Зелёный', 'Фиолетовый', 'Бордовый', 'Жёлтый', 'Оранжевый', 'Золотой', 'Серебристый'],
    rules: ['Цвет: чёрный', 'black / noir', 'бордовый'],
  }),
  definition('model_name', 'Модель', 'Все категории', 'text', 20, {
    aliases: ['model', 'модель', 'артикул модели'],
    rules: ['Модель: Samba', 'model: Speed'],
  }),
  definition('sizes', 'Размеры', 'Одежда, обувь и отдельные аксессуары', 'size', 30, {
    filter: true,
    variant: true,
    aliases: ['size', 'clothing_sizes', 'shoe_sizes', 'размер', 'размеры'],
    values: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5', '39', '39.5', '40', '40.5', '41', '41.5', '42', '43', '44', '45'],
    rules: ['Размеры: XS–XL', 'Размеры: 35–41', 'EU 38', '38, 39, 40'],
  }),
  definition('size_system', 'Размерная система', 'Одежда и обувь', 'enum', 40, {
    aliases: ['shoe_size_system', 'система размеров'],
    values: ['EU', 'IT', 'RU', 'US', 'UK', 'International'],
    rules: ['EU', 'US', 'UK', 'IT', 'RU'],
  }),
  definition('materials', 'Материал / состав', 'Одежда, сумки и аксессуары', 'multi_enum', 50, {
    filter: true,
    aliases: ['material', 'composition', 'материал', 'материалы', 'состав'],
    values: ['Кожа', 'Замша', 'Текстиль', 'Хлопок', 'Шерсть', 'Кашемир', 'Шёлк', 'Лён', 'Деним', 'Полиэстер', 'Нейлон', 'Металл', 'Пластик'],
    rules: ['Состав: 100% хлопок', 'Материал: кожа'],
  }),
  definition('fit', 'Посадка', 'Одежда', 'enum', 60, {
    filter: true,
    aliases: ['крой', 'посадка'],
    values: ['Облегающая', 'Обычная', 'Свободная', 'Oversize'],
  }),
  definition('measurements', 'Замеры', 'Одежда', 'text', 70, {
    aliases: ['clothing_measurements', 'замеры одежды', 'замеры'],
    rules: [
      'Таблица замеров по размерам: размер, длина, обхват груди, плечи, рукав',
      'Не смешивать замеры разных товаров и не вычислять отсутствующие значения',
    ],
  }),
  definition('upper_material', 'Материал верха', 'Обувь', 'multi_enum', 80, {
    filter: true,
    aliases: ['верх', 'материал верха', 'upper material'],
    values: ['Кожа', 'Замша', 'Текстиль', 'Сетка', 'Резина', 'Пластик'],
  }),
  definition('lining_material', 'Материал подкладки', 'Обувь', 'multi_enum', 90, {
    aliases: ['подкладка', 'материал подкладки', 'lining'],
    values: ['Кожа', 'Текстиль', 'Мех', 'Без подкладки'],
  }),
  definition('sole_material', 'Материал подошвы', 'Обувь', 'multi_enum', 100, {
    aliases: ['подошва', 'материал подошвы', 'sole'],
    values: ['Резина', 'Кожа', 'EVA', 'Полиуретан'],
  }),
  definition('heel_height', 'Высота каблука', 'Обувь', 'number', 110, {
    filter: true,
    aliases: ['каблук', 'высота каблука', 'heel height'],
    unit: 'см',
  }),
  definition('dimensions', 'Габариты', 'Сумки, аксессуары и багаж', 'text', 120, {
    aliases: ['bag_dimensions', 'габариты', 'размеры сумки'],
    rules: ['30 × 20 × 10 см'],
  }),
  definition('strap_length', 'Длина ремня', 'Сумки и аксессуары', 'number', 130, {
    aliases: ['длина ремня', 'длина ручки'],
    unit: 'см',
  }),
  definition('capacity', 'Вместимость', 'Сумки и багаж', 'number', 140, {
    aliases: ['bag_capacity', 'luggage_capacity', 'объём', 'вместимость'],
    unit: 'л',
  }),
  definition('hardware_color', 'Цвет фурнитуры', 'Сумки', 'enum', 145, {
    filter: true,
    aliases: ['цвет фурнитуры', 'hardware color', 'hardware_colour', 'metal fittings color'],
    values: ['Золотистая', 'Серебристая', 'Палладиевая', 'Розовое золото', 'Чёрная', 'Графитовая', 'Бронзовая'],
    rules: ['Золотистая фурнитура', 'Palladium hardware', 'Silver-tone hardware'],
  }),
  definition('watch_movement', 'Механизм часов', 'Часы', 'enum', 150, {
    filter: true,
    aliases: ['механизм часов', 'movement'],
    values: ['Кварцевый', 'Механический', 'Автоматический'],
  }),
  definition('watch_case_size', 'Размер корпуса', 'Часы', 'number', 160, {
    filter: true,
    aliases: ['case_size', 'диаметр корпуса', 'размер часов'],
    unit: 'мм',
  }),
  definition('watch_case_material', 'Материал корпуса', 'Часы', 'multi_enum', 170, {
    filter: true,
    aliases: ['case_material', 'материал корпуса'],
    values: ['Сталь', 'Золото', 'Титан', 'Керамика', 'Пластик'],
  }),
  definition('strap_material', 'Материал ремешка', 'Часы', 'multi_enum', 180, {
    filter: true,
    aliases: ['материал ремешка', 'браслет'],
    values: ['Кожа', 'Сталь', 'Золото', 'Титан', 'Каучук', 'Текстиль', 'Керамика'],
  }),
  definition('dial_color', 'Цвет циферблата', 'Часы', 'enum', 190, {
    filter: true,
    aliases: ['цвет циферблата', 'циферблат'],
  }),
  definition('water_resistance', 'Водозащита', 'Часы', 'text', 200, {
    filter: true,
    aliases: ['водозащита', 'водонепроницаемость', 'water resistance'],
  }),
  definition('bag_width_cm', 'Ширина сумки', 'Сумки', 'number', 121, {
    aliases: ['bag_width', 'ширина сумки'],
    unit: 'см',
    show: false,
  }),
  definition('bag_height_cm', 'Высота сумки', 'Сумки', 'number', 122, {
    aliases: ['bag_height', 'высота сумки'],
    unit: 'см',
    show: false,
  }),
  definition('size_class', 'Размерный класс', 'Сумки', 'enum', 123, {
    aliases: ['bag_size_class', 'размерный класс'],
    values: ['small', 'medium', 'large'],
    show: false,
  }),
  definition('glass_material', 'Стекло', 'Часы', 'enum', 202, {
    filter: true,
    values: ['Сапфировое', 'Минеральное', 'Акриловое', 'Hardlex'],
  }),
  definition('clasp_type', 'Тип застёжки', 'Часы, ювелирные изделия и бижутерия', 'enum', 204, {
    filter: true,
    aliases: ['застёжка', 'тип застёжки', 'clasp'],
  }),
  definition('power_reserve', 'Запас хода', 'Часы', 'number', 206, { unit: 'ч' }),
  definition('jewelry_metal', 'Ювелирный металл', 'Ювелирные изделия и бижутерия', 'multi_enum', 210, {
    filter: true,
    aliases: ['metal', 'металл украшения'],
    values: ['Жёлтое золото', 'Белое золото', 'Розовое золото', 'Серебро', 'Платина', 'Сталь', 'Латунь'],
  }),
  definition('stones', 'Камни', 'Ювелирные изделия и бижутерия', 'multi_enum', 220, {
    filter: true,
    aliases: ['камень', 'камни', 'вставки'],
  }),
  definition('metal_purity', 'Проба металла', 'Ювелирные изделия', 'enum', 222, {
    filter: true,
    values: ['375 проба', '585 проба', '750 проба', '916 проба', '925 проба', '950 проба', '999 проба'],
  }),
  definition('stone_origin', 'Происхождение камней', 'Ювелирные изделия и бижутерия', 'multi_enum', 224, {
    filter: true,
    values: ['Натуральные', 'Выращенные'],
  }),
  definition('jewelry_size', 'Размер украшения', 'Кольца и браслеты', 'size', 230, {
    variant: true,
    aliases: ['ring_size', 'bracelet_size', 'размер кольца', 'размер браслета'],
  }),
  definition('jewelry_length', 'Длина украшения', 'Украшения на шею и браслеты', 'number', 240, {
    aliases: ['chain_length', 'длина цепочки', 'длина браслета'],
    unit: 'см',
  }),
  definition('weight', 'Вес', 'Украшения и багаж', 'number', 250, {
    aliases: ['вес', 'масса'],
    unit: 'г',
  }),
  definition('wheel_count', 'Количество колёс', 'Чемоданы', 'enum', 260, {
    filter: true,
    values: ['2', '4'],
  }),
  definition('lock_type', 'Тип замка', 'Чемоданы', 'enum', 270, {
    filter: true,
    values: ['Без замка', 'Кодовый', 'TSA'],
  }),
  definition('luggage_size', 'Размер багажа', 'Чемоданы', 'enum', 280, {
    filter: true,
    values: ['Ручная кладь', 'Средний', 'Большой'],
  }),
  definition('luggage_case_material', 'Материал корпуса', 'Чемоданы', 'multi_enum', 290, {
    aliases: ['luggage material', 'shell material', 'материал чемодана', 'материал корпуса чемодана'],
    values: ['Алюминий', 'Поликарбонат', 'Полипропилен', 'ABS-пластик', 'Композит', 'Карбон', 'Канвас с покрытием', 'Кожа', 'Текстиль'],
    rules: ['Указывать только материал основной оболочки/корпуса, не материал ручки, отделки, подкладки или фурнитуры.'],
  }),
]

export const CATEGORY_ATTRIBUTE_RULES: CategoryRule[] = [
  {
    category: 'Одежда',
    attributes: ['sizes', 'size_system', 'materials', 'fit', 'measurements'],
  },
  {
    category: 'Обувь',
    attributes: ['sizes', 'size_system', 'upper_material', 'lining_material', 'sole_material', 'heel_height'],
  },
  {
    category: 'Сумки',
    attributes: ['materials', 'dimensions', 'bag_width_cm', 'bag_height_cm', 'size_class', 'strap_length', 'capacity', 'hardware_color'],
  },
  {
    category: 'Часы',
    attributes: ['watch_movement', 'watch_case_size', 'watch_case_material', 'strap_material', 'dial_color', 'water_resistance', 'glass_material', 'clasp_type', 'power_reserve'],
  },
  {
    category: 'Ювелирные изделия',
    attributes: ['jewelry_metal', 'metal_purity', 'stones', 'stone_origin', 'weight', 'clasp_type'],
    subcategories: {
      Кольца: ['jewelry_size'],
      Браслеты: ['jewelry_size', 'jewelry_length'],
      'Украшения на шею': ['jewelry_length'],
    },
  },
  {
    category: 'Бижутерия',
    attributes: ['materials', 'jewelry_metal', 'stones', 'stone_origin', 'clasp_type'],
    subcategories: {
      Кольцо: ['jewelry_size'],
      Браслет: ['jewelry_size', 'jewelry_length'],
      Колье: ['jewelry_length'],
      Чокер: ['jewelry_length'],
    },
  },
  {
    category: 'Аксессуары',
    attributes: ['materials', 'dimensions'],
    subcategories: {
      'Головные уборы': ['sizes'],
      Перчатки: ['sizes'],
      Ремни: ['sizes'],
      Чемоданы: ['sizes', 'capacity', 'weight', 'wheel_count', 'lock_type', 'luggage_size', 'luggage_case_material'],
    },
  },
]

const definitionsByCode = new Map(CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => [item.code, item]))
const aliasesToCode = new Map<string, string>()

for (const item of CATALOG_ATTRIBUTE_DEFINITIONS) {
  aliasesToCode.set(normalizeKey(item.code), item.code)
  item.aliases.forEach((alias) => aliasesToCode.set(normalizeKey(alias), item.code))
}

export function getCatalogAttributeDefinition(code: string) {
  return definitionsByCode.get(resolveCatalogAttributeCode(code))
}

export function resolveCatalogAttributeCode(value: unknown) {
  return aliasesToCode.get(normalizeKey(String(value || ''))) || String(value || '').trim()
}

export function getCatalogAttributeDefinitionsForCategory(categoryName?: string | null, subcategoryName?: string | null) {
  const category = findRule(categoryName)
  const codes = new Set(COMMON_ATTRIBUTE_CODES)
  category?.attributes.forEach((code) => codes.add(code))

  if (category?.subcategories && subcategoryName) {
    const normalizedSubcategory = normalizeName(subcategoryName)
    for (const [name, attributes] of Object.entries(category.subcategories)) {
      if (normalizeName(name) === normalizedSubcategory) attributes.forEach((code) => codes.add(code))
    }
    if (normalizedSubcategory === normalizeName('Чемоданы')) codes.delete('materials')
  }

  return CATALOG_ATTRIBUTE_DEFINITIONS.filter((item) => codes.has(item.code) && item.active)
}

export function resolveSupplierAttributeCodes(
  selected: unknown,
  categoryName?: string | null,
  subcategoryName?: string | null,
) {
  const explicit = normalizeCatalogAttributeCodes(selected)
  return explicit.length > 0
    ? explicit
    : getCatalogAttributeDefinitionsForCategory(categoryName, subcategoryName).map((item) => item.code)
}

export function normalizeCatalogAttributeCodes(value: unknown): string[] {
  let raw = value
  if (typeof raw === 'string') {
    const text = raw
    try {
      raw = JSON.parse(text)
    } catch {
      raw = text.split(',').map((item) => item.trim())
    }
  }
  if (!Array.isArray(raw)) return []

  return [...new Set(raw
    .map(resolveCatalogAttributeCode)
    .filter((code) => definitionsByCode.has(code)))]
}

export function categoryNames() {
  return CATEGORY_ATTRIBUTE_RULES.map((item) => item.category)
}

function findRule(categoryName?: string | null) {
  const normalized = normalizeName(categoryName || '')
  return CATEGORY_ATTRIBUTE_RULES.find((item) => normalizeName(item.category) === normalized)
}

function normalizeName(value: string) {
  return value.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim()
}

function normalizeKey(value: string) {
  return normalizeName(value).replace(/[\s-]+/g, '_')
}

function definition(
  code: string,
  label: string,
  categoryScope: string,
  valueType: CatalogAttributeValueType,
  sortOrder: number,
  options: {
    filter?: boolean
    variant?: boolean
    aliases?: string[]
    values?: string[]
    rules?: string[]
    unit?: string
    show?: boolean
  } = {},
): CatalogAttributeDefinition {
  return {
    code,
    label,
    category_scope: categoryScope,
    value_type: valueType,
    show_as_characteristic: options.show !== false,
    use_as_filter: Boolean(options.filter),
    use_as_variant_dimension: Boolean(options.variant),
    parser_rules: options.rules || [],
    aliases: options.aliases || [],
    values: options.values,
    unit: options.unit,
    sort_order: sortOrder,
    active: true,
  }
}

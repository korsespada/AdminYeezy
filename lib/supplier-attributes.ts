export type SupplierAttributeDefinition = {
  code: string
  label: string
  group: string
  description: string
}

/**
 * Attribute hints are deliberately a small, stable vocabulary. They are
 * prompts for parsing/AI, not values written to products by themselves.
 */
export const SUPPLIER_ATTRIBUTE_DEFINITIONS: SupplierAttributeDefinition[] = [
  { code: 'sizes', label: 'Размеры', group: 'Общие', description: 'Размерная сетка, доступные размеры и формат измерений.' },
  { code: 'colors', label: 'Цвета', group: 'Общие', description: 'Основной цвет и сочетания цветов.' },
  { code: 'materials', label: 'Материалы', group: 'Общие', description: 'Материалы, состав и фактура.' },
  { code: 'model_name', label: 'Модель', group: 'Общие', description: 'Название модели, артикул или линейка.' },
  { code: 'season', label: 'Сезон', group: 'Общие', description: 'Сезонность и коллекция.' },
  { code: 'fit', label: 'Посадка', group: 'Одежда', description: 'Силуэт, крой и особенности посадки.' },
  { code: 'clothing_measurements', label: 'Замеры одежды', group: 'Одежда', description: 'Длина, ширина, обхваты и другие замеры.' },
  { code: 'sole_material', label: 'Материал подошвы', group: 'Обувь', description: 'Материал и особенности подошвы.' },
  { code: 'upper_material', label: 'Материал верха', group: 'Обувь', description: 'Кожа, замша, текстиль и другие материалы верха.' },
  { code: 'lining_material', label: 'Материал подкладки', group: 'Обувь', description: 'Материал внутренней подкладки и стельки.' },
  { code: 'heel_height', label: 'Высота каблука', group: 'Обувь', description: 'Высота и форма каблука или платформы.' },
  { code: 'shoe_size_system', label: 'Система размеров', group: 'Обувь', description: 'EU, US, UK, CN и другие системы размеров.' },
  { code: 'bag_dimensions', label: 'Размеры сумки', group: 'Сумки', description: 'Ширина, высота, глубина и формат сумки.' },
  { code: 'bag_capacity', label: 'Вместимость', group: 'Сумки', description: 'Что помещается внутрь и формат отделений.' },
  { code: 'strap_length', label: 'Длина ремня', group: 'Сумки и аксессуары', description: 'Длина ручки, плечевого ремня или цепочки.' },
  { code: 'watch_movement', label: 'Механизм часов', group: 'Часы', description: 'Механика, кварц, автоматический или другой механизм.' },
  { code: 'water_resistance', label: 'Водозащита', group: 'Часы', description: 'ATM, bar, meters и текстовые обозначения водозащиты.' },
  { code: 'case_material', label: 'Материал корпуса', group: 'Часы', description: 'Материал корпуса часов.' },
  { code: 'strap_material', label: 'Материал ремешка', group: 'Часы', description: 'Материал браслета или ремешка.' },
  { code: 'dial_color', label: 'Цвет циферблата', group: 'Часы', description: 'Цвет и оформление циферблата.' },
  { code: 'country_of_origin', label: 'Страна производства', group: 'Общие', description: 'Страна изготовления, если она указана.' },
]

const definitionsByCode = new Map(SUPPLIER_ATTRIBUTE_DEFINITIONS.map((item) => [item.code, item]))

export function normalizeSupplierAttributeCodes(value: unknown): string[] {
  let raw = value
  if (typeof raw === 'string') {
    const text = raw
    try {
      raw = JSON.parse(text)
    } catch {
      raw = text.split(',').map((item) => item.trim()).filter(Boolean)
    }
  }
  if (!Array.isArray(raw)) return []

  return [...new Set(raw
    .map((item) => String(item || '').trim())
    .filter((code) => definitionsByCode.has(code)))]
}

export function getSupplierAttributeDefinition(code: string) {
  return definitionsByCode.get(code)
}

export function getSupplierAttributeLabel(code: string) {
  return definitionsByCode.get(code)?.label || code
}

// Семейный AI-шаг. Карточки цветов ИИ обрабатывает по одной и не видит других
// цветов семьи, поэтому основа названия расходится («вязаный» и «трикотажный»),
// а близкие оттенки получают одно название. Шаг смотрит на главное фото каждого
// цвета сразу и возвращает единую основу, уникальные оттенки и, если в семье
// оказались разные материалы (кожа и замша), разбивку на отдельные семьи.

export const BATCH_AI_FAMILY_NAMING_SYSTEM_PROMPT = 'Ты редактор каталога. Ты сравниваешь цвета одной модели товара по фотографиям и выдаёшь согласованные публичные названия. Не выдумывай материалы и детали, которых не видно. Верни строго запрошенный JSON.'

export const FAMILY_BASE_COLORS = [
  'Чёрный', 'Белый', 'Серый', 'Бежевый', 'Коричневый', 'Синий', 'Голубой', 'Зелёный',
  'Красный', 'Розовый', 'Фиолетовый', 'Жёлтый', 'Оранжевый', 'Разноцветный',
]

export type FamilyNamingMember = {
  productId: number
  color: string
  baseColor: string
  name: string
  nameEn: string
  duplicateOfProductId: number | null
}

export type FamilyNamingGroup = {
  baseName: string
  baseNameEn: string
  material: string
  members: FamilyNamingMember[]
}

function text(value: unknown, max = 250) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function comparable(value: unknown) {
  return text(value, 1000).normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
}

/** Фото для contact sheet: по одному главному на цвет, номер совпадает с номером товара. */
export function familyNamingPhotoUrls(products: any[]) {
  // Якорь у URL нужен, чтобы одинаковые фото двух цветов не схлопнулись в одно.
  return products.map((product) => `${String(product.photos?.[0] || '')}#family-${product.id}`)
}

export function buildBatchAiFamilyNamingPrompt(products: any[], description = '') {
  const candidates = products.map((product, index) => ({
    index: index + 1,
    name: product.name || '',
    current_color: product.attributes?.colors || [],
    materials: product.attributes?.materials || [],
    upper_material: product.attributes?.upper_material || '',
    model_name: product.attributes?.model_name || '',
  }))
  return [
    'Все товары ниже поставщик опубликовал как цвета одной модели. Каждый товар обрабатывали отдельно, поэтому названия у них написаны по-разному. Номер товара совпадает с номером его главной фотографии на contact sheet.',
    'Задача — согласовать публичные названия внутри семьи. Пользователь не будет переименовывать товары вручную.',
    'Сначала проверь, одна ли это модель. Раздели товары на группы, только если на фото явно различается материал верха (например, гладкая кожа и замша, нубук и кожа) или тип изделия (высокие ботинки и низкие полуботинки, кардиган и джемпер). Разный цвет, оттенок фурнитуры, ракурс и фон не повод делить. При сомнении оставь одну группу.',
    'Для каждой группы дай base_name — общую основу русского названия без бренда, артикула и цвета, со строчной буквы, в именительном падеже множественного или единственного числа так, как будет в названии: например «кожаные ботинки с меховой подкладкой», «кашемировая водолазка». Основа одинаковая у всех товаров группы слово в слово. base_name_en — та же основа по-английски. material — основной материал верха группы по-русски.',
    'Для каждого товара дай color — точное русское название оттенка. Внутри группы оттенки обязаны быть разными: если общий цвет одинаковый, различи по светлоте и подтону («Коричневый» и «Тёмно-коричневый», «Синий» и «Тёмно-синий», «Серый» и «Графитовый», «Белый» и «Молочный», «Бежевый» и «Песочный»). Не используй номера и слова «вариант», «оттенок 1».',
    'name — полное русское название товара: прилагательное цвета, согласованное по роду и числу с основой, и затем base_name без изменений. Например, color «Тёмно-коричневый» и base_name «кожаные ботинки с меховой подкладкой» дают name «Тёмно-коричневые кожаные ботинки с меховой подкладкой». name_en — то же по-английски: «Dark brown leather boots with shearling lining».',
    `base_color — общий цвет для фильтра каталога, строго один из: ${FAMILY_BASE_COLORS.join(', ')}.`,
    'duplicate_of_index указывай только если два фото показывают один и тот же оттенок без видимой разницы (повторная публикация). Тогда name и color у дубля совпадают с оригиналом. Разные оттенки дублями не являются.',
    'Верни каждый товар ровно один раз. Верни строго JSON вида {"groups":[{"base_name":"","base_name_en":"","material":"","members":[{"product_index":1,"color":"","base_color":"","name":"","name_en":"","duplicate_of_index":null}]}]}.',
    ...(description ? [`Описание модели от поставщика: ${text(description, 1200)}`] : []),
    `Товары: ${JSON.stringify(candidates)}`,
  ].join('\n\n')
}

/**
 * Проверяет ответ ИИ. Ошибка означает, что ответ нельзя применять: товар
 * пропущен или повторён, название не содержит основу группы, у разных цветов
 * группы одинаковое название.
 */
export function normalizeBatchAiFamilyNamingOutput(raw: any, products: any[]): FamilyNamingGroup[] {
  const groups = Array.isArray(raw?.groups) ? raw.groups : []
  if (groups.length === 0) throw new Error('ИИ не вернул группы семьи')
  const seen = new Set<number>()
  const normalized = groups.map((group: any) => {
    const baseName = text(group?.base_name)
    if (!baseName) throw new Error('ИИ не вернул основу названия семьи')
    const members = (Array.isArray(group?.members) ? group.members : []).map((member: any) => {
      const index = Number(member?.product_index)
      const product = products[index - 1]
      if (!Number.isInteger(index) || !product) throw new Error(`ИИ вернул несуществующий товар ${member?.product_index}`)
      if (seen.has(index)) throw new Error(`ИИ вернул товар ${index} дважды`)
      seen.add(index)
      const name = text(member?.name)
      const color = text(member?.color, 100)
      if (!name || !color) throw new Error(`ИИ не вернул название или цвет товара ${index}`)
      if (!comparable(name).includes(comparable(baseName))) {
        throw new Error(`Название товара ${index} «${name}» не содержит основу «${baseName}»`)
      }
      const duplicateIndex = Number(member?.duplicate_of_index)
      const baseColor = text(member?.base_color, 40)
      return {
        index,
        productId: Number(product.id),
        color,
        baseColor: FAMILY_BASE_COLORS.find((value) => comparable(value) === comparable(baseColor)) || '',
        name: name.charAt(0).toUpperCase() + name.slice(1),
        nameEn: text(member?.name_en),
        duplicateIndex: Number.isInteger(duplicateIndex) && duplicateIndex !== index && products[duplicateIndex - 1] ? duplicateIndex : null,
      }
    })
    if (members.length === 0) throw new Error('ИИ вернул пустую группу семьи')
    const byName = new Map<string, number[]>()
    for (const member of members) {
      if (member.duplicateIndex) continue
      const key = comparable(member.name)
      byName.set(key, [...(byName.get(key) || []), member.index])
    }
    const repeated = [...byName.values()].find((indexes) => indexes.length > 1)
    if (repeated) throw new Error(`У товаров ${repeated.join(', ')} одинаковое название, оттенки нужно различить`)
    return {
      baseName,
      baseNameEn: text(group?.base_name_en),
      material: text(group?.material, 80),
      members: members.map((member: any): FamilyNamingMember => ({
        productId: member.productId,
        color: member.color,
        baseColor: member.baseColor,
        name: member.name,
        nameEn: member.nameEn,
        duplicateOfProductId: member.duplicateIndex ? Number(products[member.duplicateIndex - 1].id) : null,
      })),
    }
  })
  const missing = products.map((_, index) => index + 1).filter((index) => !seen.has(index))
  if (missing.length) throw new Error(`ИИ не вернул товары ${missing.join(', ')}`)
  return normalized
}

import { SHOE_TAXONOMY_AI_RULES } from '@/lib/shoe-taxonomy'
import { CLOTHING_TAXONOMY_AI_RULES } from '@/lib/clothing-taxonomy'

export type BatchAiCategoryRule = {
  categoryName: string
  title: string
  description: string
  rules: string
}

const BAG_RULES = `Правила классификации категории «Сумки»:
- Итоговая подкатегория «Сумки» запрещена: обязательно выбери более конкретную существующую подкатегорию из справочника.
- Не предлагай и не назначай «Сумки-косметички», «Сумки-кейсы», «Сумки с клапаном», «Сумки-багет», «Мини-сумки», «Сумки-боулинг» и «Пляжные сумки». Такие товары назначай в существующую подкатегорию «Сумки на плечо».
- Сумку, основной способ ношения которой — одна или две короткие верхние ручки, назначай в «Сумки с верхней ручкой». Съёмный длинный ремень не отменяет эту конструкцию.
- Кросс-боди, сумки-багет, сумки с клапаном и сумки-ведро назначай в «Сумки на плечо». Кросс-боди не является поясной сумкой. Портфели назначай в «Сумки-мессенджеры».
- Caviar, кавьяровая и зернистая кожа описывают фактуру кожи, а не отдельный материал и не новый атрибут. В materials записывай «Кожа», а фактуру при необходимости указывай в описании.
- «Кожа ягнёнка» и «Телячья кожа» являются самостоятельными материалами: сохраняй их, только если вид кожи подтверждён источником или фотографиями.
- Эти правила важнее инструкции отдельного поставщика.`

const ACCESSORY_RULES = `Правила классификации категории «Аксессуары»:
- Вязаные зимние шапки и бини назначай в «Шапки».
- Кепки, бейсболки и модели с козырьком назначай в «Кепки и бейсболки».
- Не создавай общую подкатегорию «Головные уборы» и не дели головные уборы по полу.
- Эти правила важнее инструкции отдельного поставщика.`

export const BATCH_AI_CATEGORY_RULES: BatchAiCategoryRule[] = [
  {
    categoryName: 'Одежда',
    title: 'Одежда: единая классификация',
    description: 'Глобальное распределение типов одежды, включая китайские названия.',
    rules: CLOTHING_TAXONOMY_AI_RULES,
  },
  {
    categoryName: 'Сумки',
    title: 'Сумки: подкатегории и материалы',
    description: 'Запрещённые узкие подкатегории, обязательная конкретная классификация и нормализация кожи.',
    rules: BAG_RULES,
  },
  {
    categoryName: 'Обувь',
    title: 'Обувь: единая классификация',
    description: 'Закрытый список подкатегорий, различение конструкций, размеров и model_name.',
    rules: SHOE_TAXONOMY_AI_RULES,
  },
  {
    categoryName: 'Аксессуары',
    title: 'Аксессуары: головные уборы',
    description: 'Разделение шапок и моделей с козырьком.',
    rules: ACCESSORY_RULES,
  },
]

function normalizedCategoryName(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

export function batchAiCategoryRuleFor(value: unknown) {
  const categoryName = normalizedCategoryName(value)
  return BATCH_AI_CATEGORY_RULES.find((rule) => normalizedCategoryName(rule.categoryName) === categoryName) || null
}

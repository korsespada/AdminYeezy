import { SHOE_TAXONOMY_AI_RULES } from '@/lib/shoe-taxonomy'

export type BatchAiCategoryRule = {
  categoryName: string
  title: string
  description: string
  rules: string
}

const BAG_RULES = `Правила классификации категории «Сумки»:
- Итоговая подкатегория «Сумки» запрещена: обязательно выбери более конкретную существующую подкатегорию из справочника.
- Не предлагай и не назначай «Сумки-косметички», «Сумки-кейсы», «Сумки с клапаном», «Сумки-багет», «Мини-сумки», «Сумки-боулинг» и «Пляжные сумки». Такие товары назначай в существующую подкатегорию «Сумки на плечо».
- Caviar, кавьяровая и зернистая кожа описывают фактуру кожи, а не отдельный материал и не новый атрибут. В materials записывай «Кожа», а фактуру при необходимости указывай в описании.
- «Кожа ягнёнка» и «Телячья кожа» являются самостоятельными материалами: сохраняй их, только если вид кожи подтверждён источником или фотографиями.
- Эти правила важнее инструкции отдельного поставщика.`

export const BATCH_AI_CATEGORY_RULES: BatchAiCategoryRule[] = [
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
]

function normalizedCategoryName(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

export function batchAiCategoryRuleFor(value: unknown) {
  const categoryName = normalizedCategoryName(value)
  return BATCH_AI_CATEGORY_RULES.find((rule) => normalizedCategoryName(rule.categoryName) === categoryName) || null
}

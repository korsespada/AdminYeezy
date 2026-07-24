import { scrapingQuery } from '@/lib/db'
import {
  CATALOG_ATTRIBUTE_DEFINITIONS,
  type CatalogAttributeDictionaryValue,
  type CatalogAttributeDefinition,
  type CatalogAttributeValueType,
} from '@/lib/catalog-attribute-schema'

export type { CatalogAttributeDictionaryValue, CatalogAttributeDefinition, CatalogAttributeValueType }
export const DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS = CATALOG_ATTRIBUTE_DEFINITIONS

let registryReady: Promise<void> | null = null

const DEFAULT_VALUE_ALIASES: Record<string, Record<string, string[]>> = {
  colors: {
    'Чёрный': ['черный', 'black', 'noir'],
    'Белый': ['white', 'blanc'],
    'Бежевый': ['beige', 'camel'],
    'Коричневый': ['brown', 'marron'],
    'Серый': ['gray', 'grey', 'графитовый'],
    'Синий': ['blue', 'navy', 'голубой'],
    'Красный': ['red', 'rouge'],
    'Розовый': ['pink', 'rose'],
    'Зелёный': ['зеленый', 'green', 'vert'],
    'Фиолетовый': ['purple', 'violet'],
    'Бордовый': ['burgundy', 'bordeaux'],
    'Жёлтый': ['желтый', 'yellow'],
    'Оранжевый': ['orange'],
    'Золотой': ['gold'],
    'Серебристый': ['silver'],
  },
  sizes: {
    XXS: ['xxs'],
    XS: ['xs'],
    S: ['s'],
    M: ['m'],
    L: ['l'],
    XL: ['xl'],
    XXL: ['xxl', '2xl'],
  },
  size_system: {
    EU: ['eur', 'европейская'],
    IT: ['italy', 'итальянская'],
    RU: ['rus', 'российская'],
    US: ['usa', 'американская'],
    UK: ['british', 'британская'],
    International: ['INT', 'международная'],
  },
  fit: {
    'Облегающая': ['slim', 'skinny', 'приталенная'],
    'Обычная': ['regular', 'classic'],
    'Свободная': ['loose', 'relaxed'],
    Oversize: ['oversized', 'оверсайз'],
  },
  watch_movement: {
    'Кварцевый': ['quartz', 'кварц'],
    'Механический': ['mechanical', 'механика'],
    'Автоматический': ['automatic', 'автоподзавод'],
  },
  lock_type: {
    'Без замка': ['none'],
    'Кодовый': ['combination', 'код'],
    TSA: ['tsa lock'],
  },
}

const MATERIAL_VALUE_ALIASES: Record<string, string[]> = {
  'Кожа': ['leather', 'натуральная кожа'],
  'Замша': ['suede'],
  'Текстиль': ['textile', 'fabric', 'ткань'],
  'Хлопок': ['cotton'],
  'Шерсть': ['wool'],
  'Кашемир': ['cashmere'],
  'Шёлк': ['шелк', 'silk'],
  'Лён': ['лен', 'linen'],
  'Деним': ['denim'],
  'Полиэстер': ['polyester'],
  'Нейлон': ['nylon', 'полиамид'],
  'Металл': ['metal'],
  'Пластик': ['plastic'],
  'Сетка': ['mesh'],
  'Резина': ['rubber'],
  'Мех': ['fur'],
  'Сталь': ['steel'],
  'Золото': ['gold'],
  'Серебро': ['silver'],
  'Платина': ['platinum'],
  'Титан': ['titanium'],
  'Керамика': ['ceramic'],
  'Каучук': ['rubber'],
  EVA: ['этиленвинилацетат'],
  'Полиуретан': ['polyurethane', 'PU'],
}

for (const code of [
  'materials',
  'upper_material',
  'lining_material',
  'sole_material',
  'watch_case_material',
  'strap_material',
  'jewelry_metal',
]) {
  DEFAULT_VALUE_ALIASES[code] = MATERIAL_VALUE_ALIASES
}

async function ensureRegistryTable() {
  if (!registryReady) {
    registryReady = scrapingQuery(`
      CREATE TABLE IF NOT EXISTS catalog_attribute_definitions (
        code TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        category_scope TEXT NOT NULL DEFAULT 'Все категории',
        value_type TEXT NOT NULL DEFAULT 'text',
        show_as_characteristic BOOLEAN NOT NULL DEFAULT TRUE,
        use_as_filter BOOLEAN NOT NULL DEFAULT FALSE,
        use_as_variant_dimension BOOLEAN NOT NULL DEFAULT FALSE,
        parser_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => scrapingQuery(`
      CREATE TABLE IF NOT EXISTS catalog_attribute_values (
        id BIGSERIAL PRIMARY KEY,
        attribute_code TEXT NOT NULL REFERENCES catalog_attribute_definitions(code) ON DELETE CASCADE,
        canonical_value TEXT NOT NULL,
        aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (attribute_code, canonical_value)
      )
    `)).then(async () => {
      for (const definition of DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS) {
        await scrapingQuery(
          `INSERT INTO catalog_attribute_definitions
             (code, label, category_scope, value_type, show_as_characteristic, use_as_filter,
              use_as_variant_dimension, parser_rules, aliases, sort_order, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
           ON CONFLICT (code) DO UPDATE SET
             label=EXCLUDED.label,
             category_scope=EXCLUDED.category_scope,
             value_type=EXCLUDED.value_type,
             parser_rules=EXCLUDED.parser_rules,
             aliases=EXCLUDED.aliases,
             sort_order=EXCLUDED.sort_order`,
          [
            definition.code,
            definition.label,
            definition.category_scope,
            definition.value_type,
            definition.show_as_characteristic,
            definition.use_as_filter,
            definition.use_as_variant_dimension,
            JSON.stringify(definition.parser_rules),
            JSON.stringify(definition.aliases),
            definition.sort_order,
            definition.active,
          ],
        )
      }
      const defaultValues = DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.flatMap((definition) => (
        (definition.values || []).map((canonicalValue, index) => ({
          attribute_code: definition.code,
          canonical_value: canonicalValue,
          aliases: DEFAULT_VALUE_ALIASES[definition.code]?.[canonicalValue] || [],
          sort_order: (index + 1) * 10,
        }))
      ))
      if (defaultValues.length > 0) {
        await scrapingQuery(
          `INSERT INTO catalog_attribute_values
             (attribute_code, canonical_value, aliases, sort_order, active)
           SELECT attribute_code, canonical_value, aliases, sort_order, TRUE
             FROM jsonb_to_recordset($1::jsonb)
               AS value(attribute_code text, canonical_value text, aliases jsonb, sort_order integer)
           ON CONFLICT (attribute_code, canonical_value) DO NOTHING`,
          [JSON.stringify(defaultValues)],
        )
      }
    }).then(() => undefined)
  }
  return registryReady
}

export async function getCatalogAttributeDefinitions(): Promise<CatalogAttributeDefinition[]> {
  try {
    await ensureRegistryTable()
    const [result, valuesResult] = await Promise.all([
      scrapingQuery(
      `SELECT code, label, category_scope, value_type, show_as_characteristic, use_as_filter,
              use_as_variant_dimension, parser_rules, aliases, sort_order, active
         FROM catalog_attribute_definitions
        WHERE code = ANY($1::text[])
        ORDER BY sort_order ASC, label ASC`,
      [DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => item.code)],
      ),
      scrapingQuery(
        `SELECT id::text, attribute_code, canonical_value, aliases, sort_order, active
           FROM catalog_attribute_values
          WHERE attribute_code = ANY($1::text[])
          ORDER BY attribute_code, sort_order, canonical_value`,
        [DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => item.code)],
      ),
    ])
    const schemaByCode = new Map(DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => [item.code, item]))
    const valuesByCode = new Map<string, CatalogAttributeDictionaryValue[]>()
    for (const row of valuesResult.rows as CatalogAttributeDictionaryValue[]) {
      const current = valuesByCode.get(row.attribute_code) || []
      current.push(row)
      valuesByCode.set(row.attribute_code, current)
    }
    return result.rows.map((row) => {
      const dictionaryValues = valuesByCode.get(row.code) || []
      return {
        ...schemaByCode.get(row.code),
        ...row,
        values: dictionaryValues.filter((item) => item.active).map((item) => item.canonical_value),
        dictionary_values: dictionaryValues,
      }
    }) as CatalogAttributeDefinition[]
  } catch (error) {
    console.warn('[catalog-attribute-registry] fallback to defaults:', error)
    return DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS
  }
}

export async function upsertCatalogAttributeDictionaryValue(input: {
  id?: string
  attribute_code: string
  canonical_value: string
  aliases: string[]
  active: boolean
}) {
  await ensureRegistryTable()
  const aliases = [...new Set(input.aliases.map((item) => item.trim()).filter(Boolean))]
  const params = [
    input.attribute_code,
    input.canonical_value.trim(),
    JSON.stringify(aliases),
    Boolean(input.active),
  ]
  const result = input.id
    ? await scrapingQuery(
      `UPDATE catalog_attribute_values
          SET canonical_value=$2, aliases=$3::jsonb, active=$4, updated_at=NOW()
        WHERE id=$5::bigint AND attribute_code=$1
        RETURNING id::text, attribute_code, canonical_value, aliases, sort_order, active`,
      [...params, input.id],
    )
    : await scrapingQuery(
      `INSERT INTO catalog_attribute_values
         (attribute_code, canonical_value, aliases, sort_order, active)
       VALUES (
         $1,$2,$3::jsonb,
         COALESCE((SELECT MAX(sort_order) + 10 FROM catalog_attribute_values WHERE attribute_code=$1), 10),
         $4
       )
       RETURNING id::text, attribute_code, canonical_value, aliases, sort_order, active`,
      params,
    )
  return result.rows[0] as CatalogAttributeDictionaryValue | undefined
}

export async function updateCatalogAttributeDefinition(
  code: string,
  patch: Pick<CatalogAttributeDefinition, 'show_as_characteristic' | 'use_as_filter' | 'use_as_variant_dimension' | 'active'>,
) {
  await ensureRegistryTable()
  const result = await scrapingQuery(
    `UPDATE catalog_attribute_definitions
        SET show_as_characteristic=$2, use_as_filter=$3, use_as_variant_dimension=$4, active=$5, updated_at=NOW()
      WHERE code=$1
      RETURNING code, label, category_scope, value_type, show_as_characteristic, use_as_filter,
                use_as_variant_dimension, parser_rules, aliases, sort_order, active`,
    [code, patch.show_as_characteristic, patch.use_as_filter, patch.use_as_variant_dimension, patch.active],
  )
  return result.rows[0] as CatalogAttributeDefinition | undefined
}

import { scrapingQuery } from '@/lib/db'

export type CatalogAttributeValueType = 'text' | 'number' | 'enum' | 'multi_enum' | 'size'

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
  sort_order: number
  active: boolean
}

export const DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS: CatalogAttributeDefinition[] = [
  {
    code: 'sizes',
    label: 'Размеры',
    category_scope: 'Обувь',
    value_type: 'size',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: true,
    parser_rules: ['Размеры: 35–41', 'EU 38', 'US 9 / UK 8', '38, 39, 40'],
    aliases: ['размер', 'размеры', 'size', 'sizes', 'eu', 'us', 'uk'],
    sort_order: 10,
    active: true,
  },
  {
    code: 'shoe_size_system',
    label: 'Система размеров',
    category_scope: 'Обувь',
    value_type: 'enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['EU', 'US', 'UK', 'IT', 'RU'],
    aliases: ['система размеров', 'size system'],
    sort_order: 20,
    active: true,
  },
  {
    code: 'colors',
    label: 'Цвет',
    category_scope: 'Все категории',
    value_type: 'multi_enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Цвет: чёрный', 'black / noir', 'бордовый'],
    aliases: ['цвет', 'цвета', 'color', 'colors'],
    sort_order: 30,
    active: true,
  },
  {
    code: 'upper_material',
    label: 'Материал верха',
    category_scope: 'Обувь',
    value_type: 'enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Верх: телячья кожа', 'upper: leather', 'замша'],
    aliases: ['верх', 'материал верха', 'upper material'],
    sort_order: 40,
    active: true,
  },
  {
    code: 'lining_material',
    label: 'Материал подкладки',
    category_scope: 'Обувь',
    value_type: 'enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Подкладка: кожа', 'lining: textile'],
    aliases: ['подкладка', 'материал подкладки', 'lining'],
    sort_order: 50,
    active: true,
  },
  {
    code: 'sole_material',
    label: 'Материал подошвы',
    category_scope: 'Обувь',
    value_type: 'enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Подошва: резина', 'sole: rubber'],
    aliases: ['подошва', 'материал подошвы', 'sole'],
    sort_order: 60,
    active: true,
  },
  {
    code: 'heel_height',
    label: 'Высота каблука',
    category_scope: 'Обувь',
    value_type: 'number',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Каблук 7 см', 'heel height: 70 mm'],
    aliases: ['каблук', 'высота каблука', 'heel height'],
    sort_order: 70,
    active: true,
  },
  {
    code: 'season',
    label: 'Сезон',
    category_scope: 'Обувь и одежда',
    value_type: 'enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['сезон: демисезон', 'лето', 'зима'],
    aliases: ['сезон', 'season'],
    sort_order: 80,
    active: true,
  },
  {
    code: 'model_name',
    label: 'Модель',
    category_scope: 'Все категории',
    value_type: 'text',
    show_as_characteristic: true,
    use_as_filter: false,
    use_as_variant_dimension: false,
    parser_rules: ['Модель: Triple S', 'model: Speed'],
    aliases: ['модель', 'model', 'артикул модели'],
    sort_order: 90,
    active: true,
  },
  {
    code: 'materials',
    label: 'Материалы',
    category_scope: 'Одежда и аксессуары',
    value_type: 'multi_enum',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Состав: 100% хлопок', 'Материал: кожа'],
    aliases: ['материал', 'материалы', 'состав', 'material', 'materials'],
    sort_order: 100,
    active: true,
  },
  {
    code: 'water_resistance',
    label: 'Водозащита',
    category_scope: 'Часы',
    value_type: 'text',
    show_as_characteristic: true,
    use_as_filter: true,
    use_as_variant_dimension: false,
    parser_rules: ['Водозащита: 100 м', 'water resistant 10 ATM'],
    aliases: ['водозащита', 'водонепроницаемость', 'water resistance'],
    sort_order: 110,
    active: true,
  },
]

let registryReady: Promise<void> | null = null

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
    `).then(async () => {
      for (const definition of DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS) {
        await scrapingQuery(
          `INSERT INTO catalog_attribute_definitions
             (code, label, category_scope, value_type, show_as_characteristic, use_as_filter,
              use_as_variant_dimension, parser_rules, aliases, sort_order, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
           ON CONFLICT (code) DO NOTHING`,
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
    }).then(() => undefined)
  }
  return registryReady
}

export async function getCatalogAttributeDefinitions(): Promise<CatalogAttributeDefinition[]> {
  try {
    await ensureRegistryTable()
    const result = await scrapingQuery(
      `SELECT code, label, category_scope, value_type, show_as_characteristic, use_as_filter,
              use_as_variant_dimension, parser_rules, aliases, sort_order, active
         FROM catalog_attribute_definitions
        ORDER BY sort_order ASC, label ASC`,
    )
    return result.rows as CatalogAttributeDefinition[]
  } catch (error) {
    console.warn('[catalog-attribute-registry] fallback to defaults:', error)
    return DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS
  }
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

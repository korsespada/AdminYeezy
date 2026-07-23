import { scrapingQuery } from '@/lib/db'
import {
  CATALOG_ATTRIBUTE_DEFINITIONS,
  type CatalogAttributeDefinition,
  type CatalogAttributeValueType,
} from '@/lib/catalog-attribute-schema'

export type { CatalogAttributeDefinition, CatalogAttributeValueType }
export const DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS = CATALOG_ATTRIBUTE_DEFINITIONS

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
        WHERE code = ANY($1::text[])
        ORDER BY sort_order ASC, label ASC`,
      [DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => item.code)],
    )
    const schemaByCode = new Map(DEFAULT_CATALOG_ATTRIBUTE_DEFINITIONS.map((item) => [item.code, item]))
    return result.rows.map((row) => ({ ...schemaByCode.get(row.code), ...row })) as CatalogAttributeDefinition[]
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
